#!/usr/bin/env python3
# generate_icons.py
# Génère toutes les icônes nécessaires pour l'app
# Usage: python3 generate_icons.py

from PIL import Image, ImageDraw
import os

sizes = [72, 96, 128, 144, 152, 192, 384, 512]
badge_sizes = [72]

os.makedirs('icons', exist_ok=True)

def draw_icon(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Fond rond sombre
    margin = int(size * 0.05)
    draw.rounded_rectangle(
        [margin, margin, size - margin, size - margin],
        radius=int(size * 0.22),
        fill=(17, 17, 17, 255)
    )

    # Point accent vert
    dot_r = int(size * 0.12)
    cx = size // 2
    cy = size // 2
    draw.ellipse(
        [cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r],
        fill=(110, 231, 183, 255)
    )

    return img

def draw_badge(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    draw.ellipse([0, 0, size, size], fill=(110, 231, 183, 255))

    return img

for s in sizes:
    icon = draw_icon(s)
    icon.save(f'icons/icon-{s}.png', 'PNG')
    print(f'Created icons/icon-{s}.png')

badge = draw_badge(72)
badge.save('icons/badge-72.png', 'PNG')
print('Created icons/badge-72.png')

print('\nDone! All icons generated in ./icons/')