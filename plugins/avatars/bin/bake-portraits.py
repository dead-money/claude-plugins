#!/usr/bin/env python3
"""Bakes a mode's portrait art into portraits.json for the band above the prompt.

Usage: bake-portraits.py <mode folder> [--preview sheet.png]

Reads <mode>/art/<member>/<frame>.png for every member in mode.json's cast.
Each member needs neutral.png; blink.png, talk_a.png and talk_b.png animate
them, and any other frame (smirk.png, roar.png) can be named by the member's
"idle" or "accent" entries in mode.json. Frames should be the same picture as
neutral with only the eyes, mouth or expression changed.

Optional <mode>/art/bake.json tunes each member:
  {
    "ankhara": {
      "crop":  [0.26, 0.12, 0.74, 0.60],   head box, fractions of the image (l, t, r, b)
      "eyes":  [0.18, 0.38, 0.82, 0.54],   where blink may differ, fractions of the crop
      "mouth": [0.32, 0.64, 0.68, 0.86],   where talk_a / talk_b may differ
      "face":  [0.18, 0.30, 0.82, 0.92]    where other frames may differ
    }
  }
Without a crop the centred square of the image is used. Without regions,
each frame keeps only the areas that actually differ from neutral, which
already hides most redraw drift.

Writes <mode>/portraits.json: per member, per band height in terminal rows
(20, 16, 12, 10, 8), a square portrait two pixels per row, frames as base64
RGB. --preview writes a contact sheet of every frame at 20 rows, scaled up.

Needs Pillow and numpy: pip install pillow numpy
"""
import base64
import json
import os
import sys

try:
    import numpy as np
    from PIL import Image, ImageEnhance, ImageFilter
except ImportError:
    sys.exit('bake-portraits needs Pillow and numpy: pip install pillow numpy')

ROWS = [20, 16, 12, 10, 8]
REGION_OF = {'blink': 'eyes', 'talk_a': 'mouth', 'talk_b': 'mouth'}


def centred_square(w, h):
    side = min(w, h)
    return ((w - side) / 2 / w, (h - side) / 2 / h, (w + side) / 2 / w, (h + side) / 2 / h)


def masked_to_changes(frame, neutral):
    """Keeps only where the frame differs from neutral, feathered."""
    a = np.asarray(frame, float)
    b = np.asarray(neutral, float)
    diff = Image.fromarray(np.clip(np.abs(a - b).mean(2) * 3, 0, 255).astype(np.uint8))
    d = np.asarray(diff.filter(ImageFilter.GaussianBlur(max(2, neutral.size[0] / 70))), float)
    m = np.clip((d - 18) / 30, 0, 1)
    m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(max(1, neutral.size[0] / 170))), float)[..., None] / 255
    return Image.fromarray((b * (1 - m) + a * m).clip(0, 255).astype(np.uint8))


def confined(frame, neutral, box, size):
    """Keeps the frame only inside box (fractions), feathered."""
    m = Image.new('L', (size, size), 0)
    m.paste(255, (round(box[0] * size), round(box[1] * size), round(box[2] * size), round(box[3] * size)))
    m = np.asarray(m.filter(ImageFilter.GaussianBlur(size / 40)), float)[..., None] / 255
    return Image.fromarray((np.asarray(neutral, float) * (1 - m) + np.asarray(frame, float) * m).astype(np.uint8))


def crisp(im, crop, size):
    """Crops to the head and downscales without turning to mud."""
    w, h = im.size
    im = im.crop((int(crop[0] * w), int(crop[1] * h), int(crop[2] * w), int(crop[3] * h)))
    im = ImageEnhance.Contrast(ImageEnhance.Color(im).enhance(0.9)).enhance(1.12)
    im = im.resize((size * 4, size * 4), Image.LANCZOS).filter(ImageFilter.UnsharpMask(3, 70, 2))
    return im.resize((size, size), Image.LANCZOS)


def bake_member(art_dir, who, tune):
    folder = os.path.join(art_dir, who)
    neutral_path = os.path.join(folder, 'neutral.png')
    if not os.path.exists(neutral_path):
        sys.exit(f'{who}: missing {neutral_path}')
    neutral = Image.open(neutral_path).convert('RGB')
    frames = {'neutral': neutral}
    for name in sorted(os.listdir(folder)):
        stem, ext = os.path.splitext(name)
        if ext.lower() != '.png' or stem == 'neutral':
            continue
        frame = Image.open(os.path.join(folder, name)).convert('RGB').resize(neutral.size, Image.LANCZOS)
        frames[stem] = masked_to_changes(frame, neutral)
    crop = tune.get('crop') or centred_square(*neutral.size)
    sizes = {}
    for rows in ROWS:
        size = rows * 2
        base = crisp(neutral, crop, size)
        baked = {}
        for name, im in frames.items():
            q = base if name == 'neutral' else crisp(im, crop, size)
            box = tune.get(REGION_OF.get(name, 'face'))
            if name != 'neutral' and box:
                q = confined(q, base, box, size)
            baked[name] = q
        sizes[rows] = baked
    missing = [f for f in ('blink', 'talk_a', 'talk_b') if f not in frames]
    return sizes, missing


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    preview = sys.argv[sys.argv.index('--preview') + 1] if '--preview' in sys.argv else None
    if preview in args:
        args.remove(preview)
    if len(args) != 1:
        sys.exit(__doc__)
    mode_dir = os.path.abspath(args[0])
    mode = json.load(open(os.path.join(mode_dir, 'mode.json')))
    cast = (mode.get('call') or {}).get('cast') or {}
    if not cast:
        sys.exit('mode.json has no call.cast: portraits are for cast modes')
    art_dir = os.path.join(mode_dir, 'art')
    bake_path = os.path.join(art_dir, 'bake.json')
    tuning = json.load(open(bake_path)) if os.path.exists(bake_path) else {}

    out, sheet_rows = {}, []
    for who in cast:
        sizes, missing = bake_member(art_dir, who, tuning.get(who, {}))
        if missing:
            print(f'{who}: no {", ".join(missing)} frame(s); that part of the animation stays still')
        out[who] = {
            str(rows): {
                'w': rows * 2,
                'h': rows * 2,
                'frames': {name: base64.b64encode(np.asarray(im).tobytes()).decode() for name, im in frames.items()},
            }
            for rows, frames in sizes.items()
        }
        sheet_rows.append(list(sizes[20].values()))

    path = os.path.join(mode_dir, 'portraits.json')
    with open(path, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'wrote {path} ({os.path.getsize(path) // 1024} KB, {len(out)} members)')

    if preview:
        scale, cell = 6, 40 * 6
        cols = max(len(r) for r in sheet_rows)
        sheet = Image.new('RGB', (cols * (cell + 8), len(sheet_rows) * (cell + 8)), (16, 16, 16))
        for y, row in enumerate(sheet_rows):
            for x, im in enumerate(row):
                sheet.paste(im.resize((cell, cell), Image.NEAREST), (x * (cell + 8), y * (cell + 8)))
        sheet.save(preview)
        print(f'wrote {preview}: one row per member, frames in order {", ".join(sizes[20])}')


if __name__ == '__main__':
    main()
