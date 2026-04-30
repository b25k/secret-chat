-- ════════════════════════════════════════════
--  SUPABASE SETUP — colle ça dans l'SQL Editor
-- ════════════════════════════════════════════

-- 1. Table des messages
create table if not exists messages (
  id          uuid        default gen_random_uuid() primary key,
  room_id     text        not null,
  content     text        not null check (char_length(content) <= 2000),
  sender      text        not null check (char_length(sender) <= 20),
  created_at  timestamptz default now() not null
);

-- Index pour charger les messages d'une salle rapidement
create index if not exists messages_room_created
  on messages (room_id, created_at asc);

-- 2. Table des souscriptions push
create table if not exists push_subscriptions (
  id           uuid        default gen_random_uuid() primary key,
  room_id      text        not null,
  sender_name  text        not null,
  subscription jsonb       not null,
  created_at   timestamptz default now() not null,
  unique (room_id, sender_name)
);

-- 3. Activer Row Level Security (RLS)
alter table messages            enable row level security;
alter table push_subscriptions  enable row level security;

-- 4. Policies — accès public (la sécurité = le code de salle secret)
create policy "messages_select" on messages
  for select using (true);

create policy "messages_insert" on messages
  for insert with check (true);

create policy "push_select" on push_subscriptions
  for select using (true);

create policy "push_insert" on push_subscriptions
  for insert with check (true);

create policy "push_update" on push_subscriptions
  for update using (true);

create policy "push_delete" on push_subscriptions
  for delete using (true);

-- 5. Activer Realtime sur la table messages
-- Va dans Database > Replication > Tables et active "messages"
-- OU exécute :
alter publication supabase_realtime add table messages;

-- 6. Nettoyage automatique (optionnel)
-- Supprime les messages de plus de 30 jours automatiquement
-- create extension if not exists pg_cron;
-- select cron.schedule('clean-old-messages', '0 3 * * *',
--   $$delete from messages where created_at < now() - interval '30 days'$$);