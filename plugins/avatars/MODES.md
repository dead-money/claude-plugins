# Mode format

A mode is a folder. Built-in modes live in the plugin's `modes/`. Your own go in
`~/.claude/avatars/modes/<name>/`; one with the same name as a built-in replaces it.
The folder name is the mode's name: lowercase letters, digits, `-` and `_`.

```
~/.claude/avatars/modes/pirates/
  mode.json         who speaks and how (required)
  portraits.json    baked portraits for the band (cast modes; made by bin/bake-portraits.py)
  ring.pcm          a sound before each call (optional)
  art/              your source images and bake.json (only the bake script reads these)
```

To change only voices, not a whole mode, use `~/.claude/avatars/voices.json`:
`{ "coven": { "ankhara": "<voice id>" } }` (single-voice modes use the key `voice`).
`/avatar recast <character> <voice id>` writes this file for the current mode.

After editing, run `/avatar reload` (or ask Claude to check the mode, which reloads too).

There are two kinds of mode:

- **Single-voice.** One voice reads a short spoken version of each reply. It needs
  `title`, `description`, `voice`, `sample` and `demos`, and optionally `persona` and `audio`.
- **Cast.** Sonnet writes each reply as a short scene of `NAME:` lines, and each line plays
  in its speaker's voice. It adds `call`, plus `band` and `portraits.json` for the animated
  portraits above the prompt.

## Fields

| Field | What it does |
|---|---|
| `title` | Shown in menus. |
| `description` | One line shown under the mode picker. |
| `voice` | Single-voice modes: the default ElevenLabs voice id. People can pick another. |
| `voiceOwner` | That voice's library owner id, as `libraryOwner` is for a cast member. |
| `persona` | Single-voice modes: text added to Sonnet's instructions, e.g. a character to speak as. |
| `personaTags` | Extra persona guidance that is used only with v3/v4 voice models, which perform `[audio tags]`. |
| `call` | Makes it a cast mode. See below. |
| `band` | The band's look. Needs `call` and `portraits.json`. |
| `audio.filter` | An ffmpeg `-filter_complex` graph applied to every line (mono, 22050 Hz). |
| `audio.effects` | Post effects on the dry voice, planned fresh for every line, ahead of the pitch and `filter`. See below. |
| `audio.ring` | `{ "file": "ring.pcm", "ms": 1300 }`: raw s16le mono 22050 Hz audio played before a call's first line, and its length. |
| `sample` | Lines played when someone switches to the mode. |
| `demos` | Arrays of lines played by `/avatar test`. |
| `scenarios` | `{ "key": { "title": "...", "script": [lines] } }`: longer scripted calls for `/avatar scenario key`. |

In cast modes, lines are written as `NAME: [tag] text`. Tags only work with v3/v4 models,
and the plugin strips them for other models.

### `call`

| Field | What it does |
|---|---|
| `premise` | What the scene is: who is present, who did the work, who is always there. Sonnet reads this first. |
| `host` | The member always in the band's left frame. |
| `fallback` | Who speaks a reply that came back without `NAME:` lines. |
| `cast` | Members by key, in the order Sonnet reads them. |
| `extras` | Extra cast notes, e.g. a pet that never speaks. |
| `style` | A paragraph on tone. |
| `turns` | Who trades lines with whom, and when others may cut in. |
| `accuracy` | What must survive the character voice, on top of the outcome and any question for the user. |
| `distinct` | Completes "Keep each voice distinct: ...". |
| `reporters` | Weighted picks for who reports each time: `[{ "weight": 3, "text": "whoever fits best." }]`. |
| `kinds` | Weighted kinds of scene, picked per reply: `[{ "weight": 2, "text": "A report: ...", "note": "Nobody else speaks." }]`. |

Each reply gets a randomly picked `<call>` block containing a reporter, a kind of scene and
a length based on the reply's size. This keeps the scenes from all sounding the same.

### A cast member

| Field | What it does |
|---|---|
| `name` | How Sonnet writes them before a line, in capitals. |
| `aliases` | Other names Sonnet might use ("queen", "boss"). |
| `voice` | Their ElevenLabs voice id. Shared modes need public library voices: voices you made yourself only work with your key. |
| `pitch` | Shifts their voice's pitch, keeping its speed: `0.95` is 5% lower. Dropped when you recast them. |
| `libraryOwner` | The library voice's owner id (`search_voices` shows it), so the plugin can add the voice to an account that needs it first. |
| `ink` | Their name colour in the band, `#rrggbb`. |
| `persona` | How they talk: tics, forms of address, dialect, attitude, relationships. |
| `speaksAbout` | What kind of work brings them into a scene. |
| `tags` | Audio tags that suit them. |
| `idle` | `[{ "frame": "smirk", "weight": 1, "ms": [1500, 3000] }]`: looks shown while others talk. |
| `accent` | `{ "frame": "roar", "when": "shout\|furious" }`: a frame mixed into talking when a line's tags match (a case-insensitive regex). |
| `frequency` | Codec layout only: the frequency the panel shows while they are on the line, e.g. `"141.12"`. |

### `band`

```json
"band": {
  "title": "T H E   C O V E N",
  "frame": "#5a0f1c", "frameLit": "#c8a050", "corner": "#e0c080", "subtitle": "#f2e6e8",
  "meter": { "label": "THIRST", "glyph": "♥", "lit": "#d0203c", "dim": "#3c1018" }
}
```

`frameLit` is the frame colour of whoever is talking. The meter glyph must be one terminal
cell wide. The band needs about 90 columns to show both portraits, and about 140 to show
the centre panel with the subtitles.

`"layout": "codec"` draws a radio-call band instead, sized like the court: whoever is on the
line on the left, the host on the right, and a panel between them with signal bars and a
seven-segment frequency display above the subtitles. `title` labels the panel's top rule and
the meter's `label` its bottom rule; the meter's `lit` and `dim` colour the display, and the
glyph is unused. `frequency` is the default frequency, which a member's own `frequency`
overrides. Whoever is not talking is dimmed. Portraits may be taller than wide, but every
member must be the same size. Below 12 rows the display makes way for the subtitles and the
frequency moves into the top rule.

`"layout": "solo"` draws one member alone: the host's portrait centred in falling glyph rain
that quickens while they speak, the title and meter over the left rain and the subtitles over
the right. `glyphs` sets the characters the rain falls in (each one cell wide). A solo mode is
a cast of one: give `call.cast` a single member who is both `host` and `fallback`.

## Audio effects

`audio.effects` is a list of effects run on the voice in order, before any pitch shift and
the mode's `filter`. Each line gets its own random timing, planned from its text.

```json
"effects": [
  { "type": "stutter", "perSecond": 0.35, "repeats": [1, 3], "ms": [60, 120], "reverse": 0.15, "rush": 0.6, "rushRate": 1.2 },
  { "type": "dropouts", "perSecond": 1.1, "ms": [30, 140], "static": 0.6, "hiss": 0.004 }
]
```

- `stutter` replays a short fragment (`ms` long, `repeats` times, sometimes reversed) about
  `perSecond` times a second. A share of stutters (`rush`) speed up into the word and slow
  back out, faster and higher like tape, peaking at `rushRate`.
- `dropouts` cuts the voice for `ms` about `perSecond` times a second, to static (a `static`
  share of cuts) or near silence, with a little `hiss` under everything.

A filter that names its input `[0]` still works: it reads the effects' output.

## Portraits

Put images in `art/<member>/`: `neutral.png`, `blink.png`, `talk_a.png`, `talk_b.png`, plus
any expression frames that `idle` or `accent` name. Every frame should be the same picture
as `neutral`, with only the eyes, mouth or expression changed. Then run:

```
python3 bin/bake-portraits.py ~/.claude/avatars/modes/<name> --preview sheet.png
```

`art/bake.json` can set the head crop and the regions where each frame may differ from
neutral. The script's header explains both.

## Ring sounds

Convert any short sound with ffmpeg:

```
ffmpeg -i ring.wav -f s16le -ar 22050 -ac 1 ring.pcm
```

`ms` is the file size in bytes divided by 44.1.

The built-in `coven` mode is a complete example of a cast, and `prototype` of a solo mode
with audio effects.
