// supabase/functions/send-push/index.ts
// Edge Function Supabase — déclenche les push vers l'autre personne
// Déploiement: supabase functions deploy send-push

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Implémentation Web Push (VAPID) sans lib externe ──
// On utilise l'API Web Crypto de Deno natif

const VAPID_PUBLIC_KEY  = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT     = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── CORS headers ──
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Helper: base64url ──
function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64urlToUint8Array(b64: string): Uint8Array {
  const padding = "=".repeat((4 - b64.length % 4) % 4);
  const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ── Générer JWT VAPID ──
async function generateVapidJWT(audience: string): Promise<string> {
  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: VAPID_SUBJECT,
  };

  const headerB64  = base64url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const keyData = base64urlToUint8Array(VAPID_PRIVATE_KEY);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

// ── Envoyer un push vers une souscription ──
async function sendPushNotification(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const endpoint = new URL(subscription.endpoint);
    const audience = `${endpoint.protocol}//${endpoint.host}`;

    const jwt = await generateVapidJWT(audience);

    // Chiffrement ECDH + AES-GCM du payload (Web Push Protocol RFC 8291)
    const payloadBytes = new TextEncoder().encode(payload);

    // Clé publique du client
    const clientPublicKey = base64urlToUint8Array(subscription.keys.p256dh);
    const authSecret = base64urlToUint8Array(subscription.keys.auth);

    // Générer une paire de clés éphémères
    const serverKeyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"]
    );

    const serverPublicKey = await crypto.subtle.exportKey("raw", serverKeyPair.publicKey);
    const serverPublicKeyBytes = new Uint8Array(serverPublicKey);

    // Importer la clé publique du client
    const clientKey = await crypto.subtle.importKey(
      "raw",
      clientPublicKey,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );

    // Dériver le secret partagé
    const sharedSecret = await crypto.subtle.deriveBits(
      { name: "ECDH", public: clientKey },
      serverKeyPair.privateKey,
      256
    );

    // HKDF pour dériver les clés de chiffrement
    const salt = crypto.getRandomValues(new Uint8Array(16));

    const ikm = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveBits"]);

    // PRK (pseudo-random key)
    const prk = await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: authSecret,
        info: (() => {
          const enc = new TextEncoder();
          const info = new Uint8Array(enc.encode("Content-Encoding: auth\0").length + 1);
          info.set(enc.encode("Content-Encoding: auth\0"));
          return info;
        })()
      },
      ikm,
      256
    );

    const prkKey = await crypto.subtle.importKey("raw", prk, "HKDF", false, ["deriveBits"]);

    // Content Encryption Key
    const cekInfo = (() => {
      const context = new Uint8Array([
        ...new TextEncoder().encode("Content-Encoding: aesgcm\0"),
        0, 65,
        ...clientPublicKey,
        0, 65,
        ...serverPublicKeyBytes
      ]);
      return context;
    })();

    const cek = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info: cekInfo },
      prkKey,
      128
    );

    // Nonce
    const nonceInfo = (() => {
      const context = new Uint8Array([
        ...new TextEncoder().encode("Content-Encoding: nonce\0"),
        0, 65,
        ...clientPublicKey,
        0, 65,
        ...serverPublicKeyBytes
      ]);
      return context;
    })();

    const nonce = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info: nonceInfo },
      prkKey,
      96
    );

    // Chiffrer le payload
    const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
    const paddedPayload = new Uint8Array(payloadBytes.length + 2);
    paddedPayload.set(payloadBytes, 2); // 2 bytes de padding (0,0)

    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      aesKey,
      paddedPayload
    );

    // Assembler le body (salt + server public key + encrypted)
    const body = new Uint8Array(salt.length + 4 + 1 + serverPublicKeyBytes.length + encrypted.byteLength);
    let offset = 0;
    body.set(salt, offset); offset += salt.length;
    // Record size (4096)
    new DataView(body.buffer).setUint32(offset, 4096, false); offset += 4;
    body[offset++] = serverPublicKeyBytes.length;
    body.set(serverPublicKeyBytes, offset); offset += serverPublicKeyBytes.length;
    body.set(new Uint8Array(encrypted), offset);

    // Headers
    const vapidHeader = `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`;
    const cryptoKeyHeader = `dh=${base64url(serverPublicKeyBytes)}`;

    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        "Authorization": vapidHeader,
        "Crypto-Key": cryptoKeyHeader,
        "Content-Encoding": "aesgcm",
        "Encryption": `salt=${base64url(salt)}`,
        "Content-Type": "application/octet-stream",
        "TTL": "86400",
      },
      body: body
    });

    if (response.status === 410 || response.status === 404) {
      return { ok: false, status: response.status, error: "subscription_expired" };
    }

    return { ok: response.ok, status: response.status };
  } catch(e) {
    return { ok: false, error: String(e) };
  }
}

// ── Handler principal ──
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { room_id, sender, content } = await req.json();

    if (!room_id || !sender || !content) {
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE);

    // Récupérer les souscriptions de l'autre personne (pas l'expéditeur)
    const { data: subs, error } = await sb
      .from("push_subscriptions")
      .select("*")
      .eq("room_id", room_id)
      .neq("sender_name", sender);

    if (error) {
      console.error("DB error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: "No subscribers" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const payload = JSON.stringify({
      sender,
      content: content.length > 100 ? content.slice(0, 97) + "…" : content,
      room_id,
      timestamp: Date.now()
    });

    const results = await Promise.allSettled(
      subs.map(async (row: any) => {
        const result = await sendPushNotification(row.subscription, payload);

        // Supprimer les souscriptions expirées
        if (result.status === 410 || result.status === 404) {
          await sb.from("push_subscriptions").delete().eq("id", row.id);
        }

        return result;
      })
    );

    const sent = results.filter(r => r.status === "fulfilled" && (r.value as any).ok).length;

    return new Response(JSON.stringify({ sent, total: subs.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch(e) {
    console.error("Function error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});