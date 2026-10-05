# Portrait prompts

The band draws each member at 40, 32, 24, 20 and 16 pixels square. Good portraits have:

- a square image, head and shoulders, facing the viewer, the face centred and large
- a plain, dark, uncluttered background
- strong contrast and clear shapes: a distinctive silhouette, hair, headwear or props
- the same style, lighting and framing across the whole cast

## The neutral portrait

Fill in the brackets and keep the style sentence identical for every member:

> A portrait of [who they are: age, build, face, hair, clothing, one or two signature
> details], [their usual expression]. Style: [the cast's shared style, e.g. "detailed
> painterly dark-fantasy character portrait with rich colour and dramatic rim light"],
> head and shoulders, facing the viewer, centred, plain dark background. Square image.

Generate a few, pick one together, and save it as `art/<member>/neutral.png`.

## Animation frames

Make each frame by **editing** the neutral image (attach it, or use the tool's edit or
"vary region" feature), not by generating from scratch. A fresh generation moves the head
and the frames will jitter.

> An exact redraw of the attached portrait (same character, framing, crop, pose, head
> position, lighting, palette and style), changing only one thing: [the change]. Keep
> everything else identical so it can be used as an animation frame.

| Frame | The change |
|---|---|
| `blink` | their eyes are fully closed, mid-blink |
| `talk_a` | their lips are slightly parted as if mid-word |
| `talk_b` | their mouth is open as if speaking a word |
| an expression | e.g. "a slow, knowing smirk, one corner of the mouth raised", "a furious roar, mouth wide" |

Small additions keep frames in character: "the tips of her fangs showing", "above the
fan she holds", "behind the mirrored goggles".

## When frames drift

Image models never redraw perfectly. The bake script keeps only the areas that differ
from neutral, which hides most drift. If a frame still smears or shifts, give the member
`eyes`, `mouth` and `face` regions in `art/bake.json` so each frame can only change
where it should, then bake again and compare the preview sheet.

## Without an image model

Any square images work: commissioned art, drawings, or photos of masks and puppets you
own. Hand-made frames only need the same framing as neutral.
