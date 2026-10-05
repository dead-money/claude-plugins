---
name: create-mode
description: Guides someone through making their own avatars mode, a cast of characters or a single voice that speaks Claude's replies. Covers the concept, personalities, dialogue, ElevenLabs voices, portrait images, baking, colours, sound and testing. Use when the user wants a new avatar, mode, character, cast or voice persona for the avatars plugin, or wants to change one.
---

# Creating an avatars mode

You are helping someone make a mode for the avatars plugin. They may never have written a
character prompt, picked a synthetic voice, or generated animation frames before. Teach as
you go: at each step, say in a sentence or two what the step is for and why it matters,
then do the work together. Make the creative decisions with them. Offer concrete options
and a recommendation, and don't decide their characters for them.

Work in order, but let them skip ahead or come back. Write files as soon as there is
something worth saving, so progress is never lost. Check in after each step before moving on.

## Step 0: Get set up

1. Call `mcp__avatars__paths` to find the user's modes folder, the example modes, the
   format reference and the bake script. Read `MODES.md` and one example `mode.json`
   (`coven` for a cast, `narrator` for a single voice) before writing anything.
2. Ask them to run `/avatar doctor`, or check its output with them. They need an
   ElevenLabs API key (the plugin's options or `ELEVENLABS_API_KEY`) and ffmpeg.
3. Ask what they can use to make images: an image model in a chat app (ChatGPT, Gemini),
   a command-line generator, Midjourney, local Stable Diffusion, an artist, or their own
   drawings. Portraits are only needed for cast modes with a band. A single-voice mode
   needs no art at all.

## Step 1: The concept

Explain: a mode is who talks to them after every reply. Single-voice modes are one
character reading a short spoken summary. Cast modes turn each reply into a tiny scene
where one character did the work and reports it to another.

Settle with them:
- **Single voice or cast?** A cast needs two to four members, voices for each, and
  portraits if they want the band.
- **The premise.** Who is in the scene, who did the work, and who is always there? Good
  premises have a built-in dynamic: a boss and a nervous underling, a queen and rival
  courtiers, a ship's captain and crew.
- **The tone and its limits.** For example: funny, menacing, cosy, spicy but never explicit.
- **Originality.** If they might share the mode, the characters, names, art and voices
  should be their own. Characters inspired by a genre are fine; copying a franchise's
  characters, artwork or a real actor's voice is not.
- **A name.** This becomes the folder name: lowercase letters, digits, `-` or `_`.

Create the folder `<modes folder>/<name>/` and a first `mode.json` with `title`,
`description` and the `premise`.

## Step 2: Personalities

Explain: Sonnet reads every member's persona before writing each scene. Personas work
best when they describe how someone talks, not just what they are like. "Stammers on the
first word when scared and squeaks the result out quickly" gives Sonnet more to work with
than "nervous".

For each member, draft with them:
- **Who they are**, in one line.
- **How they talk:** sentence length, verbal tics, forms of address ("my sweet", "boss"),
  dialect words, catchphrase-like habits (their own, not borrowed ones), and what they
  call the host and the user.
- **Attitude and relationships:** who they flatter, mock, fear or protect. Friction
  between members makes scenes fun.
- **`speaksAbout`:** what kind of work brings them in. Sonnet uses this to cast the
  right member, e.g. tests go to the precise one and big refactors to the show-off.
- **`name`** in capitals and a few **`aliases`** Sonnet might write instead.

Then write `distinct`, a single sentence contrasting all the voices, and `turns`, who
trades lines and when others may cut in. Add `style` if the tone needs spelling out, and
`accuracy` for anything that has to survive the character voice, e.g. "keep file names
recognisable".

## Step 3: Dialogue variety

Explain: the plugin picks a random kind of scene for each reply, so it doesn't repeat
itself. The `kinds` list is the menu it picks from.

Write four to six `kinds` with weights, e.g. the ordinary report (most common), an
over-excited info-dump, an argument between members, trouble when something failed, and
a good day. Use `note` for who joins in ("Snikkit is on the call."). If several members
can report, add weighted `reporters`, including one entry for "whichever member fits the
work best".

Write a `sample` (two lines, played when someone switches to the mode) and three to five
`demos` (short scenes covering different kinds). Demos double as Sonnet-free test material.

## Step 4: Voices

Explain: each member needs an ElevenLabs voice. The voice carries most of the character,
so audition before committing.

- Search the shared library with `mcp__avatars__search_voices`, using descriptive
  queries ("gravelly old sea captain", "haughty french aristocrat woman") and filters for
  gender, age and accent. `mcp__avatars__my_voices` lists voices they already own.
- Audition two or three candidates per member with `mcp__avatars__audition`, using a
  line in character with tags (e.g. `[gruff] Report, now.`). Ask what they think after
  each one.
- If nothing fits, they can design a voice from a text description in the ElevenLabs
  website (Voices, then Voice Design) and give you its id.
- Tags such as `[whispering]` or an accent tag can pull some voices away from their
  natural accent. If a voice changes character with a tag, drop that tag from the
  member's `tags` and say why in the persona file.
- Tags work only with v3/v4 models (the plugin default is `eleven_v4_turbo`).

Record each member's `voice` id, its `libraryOwner` from the search results, and a
`tags` list that suited them in auditions. Voices they designed or cloned themselves work
only with their own key: if the mode is for sharing, use library voices in `mode.json`
and keep their own in `~/.claude/avatars/voices.json` (`/avatar recast` writes it).

## Step 5: Portraits (cast modes with a band)

Explain: the band shows each member as a small animated portrait, only 40 by 40 pixels
at its largest. Bold, high-contrast faces read well at that size; fine detail does not.

Work through [image-prompts.md](image-prompts.md). In short:

1. **Pick a style together** and use it for the whole cast, e.g. painterly, comic ink, or
   16-bit pixel art. Make it square, head and shoulders, facing the viewer, the face
   centred, on a plain dark background.
2. **Generate `neutral.png` first** for each member and get their approval. Every other
   frame is made from it.
3. **Make each frame as an edit of neutral with one change:** `blink` (eyes closed),
   `talk_a` (lips slightly parted), `talk_b` (mouth open mid-word), and one expression
   that fits them (a smirk, a sneer, a roar). Edits keep the framing identical, which is
   what makes the animation work.
4. Save them as `art/<member>/<frame>.png`.
5. **Bake:** `python3 <bake script> <mode folder> --preview <mode folder>/art/sheet.png`,
   then look at the sheet with them. If the head is off-centre or a frame smears, add a
   crop or regions to `art/bake.json` (the script's header explains them) and bake again.
6. Set each member's `idle` (expression frames shown while others talk) and optionally
   `accent` (a frame mixed into talking when a line's tags match, e.g. a roar on shouted lines).

If they have no image tool, skip the band. The mode still works without one.

## Step 6: The band's look

Explain: the band is the strip above the prompt, with the host on the left, whoever is
talking on the right, and a panel between them with the title, the speaker and subtitles.

Choose with them:
- `title`: spaced capitals look best ("T H E   C O V E N").
- `frame`, `frameLit` (the talking member's frame), `corner` and `subtitle` colours.
- A `meter` with a label and a one-cell glyph that fits the theme (`♥`, `▼`, `*`), plus
  lit and dim colours.
- Each member's `ink`, the colour of their name.

## Step 7: Sound

Explain: an ffmpeg filter puts every line in a space, such as a radio, a stone hall or a
phone. A ring sound plays before each scene starts.

- Try filters with `mcp__avatars__audition`'s `filter` parameter. Starting points:
  - Radio: `highpass=f=300,lowpass=f=3400,acompressor=threshold=-20dB:ratio=6,volume=4dB`
  - Chamber: `aecho=0.8:0.55:45|90:0.16|0.08,volume=2dB`
  - Phone: `highpass=f=400,lowpass=f=3000,acrusher=bits=10:mix=0.3`
- Keep `alimiter=limit=0.95` at the end of anything that adds volume.
- For a ring, convert any short sound they have the rights to:
  `ffmpeg -i in.wav -f s16le -ar 22050 -ac 1 ring.pcm`, then set
  `"ring": { "file": "ring.pcm", "ms": <bytes / 44.1> }`.

## Step 8: Check and try it

1. Call `mcp__avatars__check_mode` with the folder. It validates the files, checks that
   their key can use every voice, and reloads the modes.
2. Have them run `/avatar mode <name>` (this plays the sample), then `/avatar test` a few
   times. `/avatar test <member>` plays a demo with that member in it.
3. Then do some real work and listen to a few replies. Tune personas, kinds and tags
   from what they hear. Most of the fun is found in this loop.

## Sharing

A mode is a self-contained folder, so they can zip it or put it in a git repository and
others can drop it into their own `~/.claude/avatars/modes/`. To share several modes, or
carry their own between machines, they can publish a mode pack (MODES.md, "Mode packs"):
a plugin repository with the modes under `avatars/modes/`. Remind them that voices made
in their own ElevenLabs account work for others only if they share them to the voice library.
