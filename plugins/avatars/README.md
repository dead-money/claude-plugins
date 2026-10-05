# Avatars

Claude reads its replies aloud. After each reply, Sonnet writes a short spoken version
and ElevenLabs voices it, either as a single narrator or as a small scene with a cast of
characters. Cast modes show animated portraits above the prompt that blink, talk and react.

![The Coven reporting a fixed test in Claude Code](docs/screenshot.png)

## Modes

- **The Coven:** an ancient vampire queen and her catty ladies, who report your work to
  her with innuendo (suggestive, never explicit).
- **Skrap-Vox:** two orks and their grot on a crackling scrap-built vox.
- **Narrator:** one voice of your choice, with no portraits.

To make your own, ask Claude to *create an avatars mode*. Its guide walks you through the
characters, dialogue, voices, portrait art and sound.

## Install

```
/plugin marketplace add dead-money/claude-plugins
/plugin install avatars@dead-money
```

You need:

- **An ElevenLabs API key** with text-to-speech and voices access. Claude Code asks for
  it when you enable the plugin and keeps it in secure storage; `ELEVENLABS_API_KEY`
  works too. You pay ElevenLabs for the audio, and the spoken rewrite uses your Claude usage.
- **ffmpeg:** `brew install ffmpeg` on macOS, `winget install Gyan.FFmpeg` on Windows, or
  your package manager on Linux. Linux playback uses `pw-play`, `paplay` or `aplay`.

Run `/avatar doctor` to check the setup.

## Use

`/avatar` opens a menu for choosing the mode, voice and model, testing them, and saving
your choice as the default. Changes apply to the current session unless you save them.

| Command | |
|---|---|
| `/avatar mode <name\|off>` | Switch mode |
| `/avatar on` / `off` | Turn spoken replies on or off |
| `/avatar test [n\|name]` | Play a demo scene |
| `/avatar replay` / `stop` | Repeat the last reply, or stop speaking |
| `/avatar voice <id>` / `model <id>` | Set the narrator voice or the ElevenLabs model |
| `/avatar scenario [name]` | Play a longer scripted scene |
| `/avatar doctor` | Check the key, ffmpeg and voices |

Only the main conversation speaks. Subagents and `claude -p` runs stay quiet. Portraits
need a terminal at least 90 columns wide, and subtitles need about 140.

## Your own modes

A mode is a folder in `~/.claude/avatars/modes/` holding a `mode.json` (cast,
personalities, voices, sound), baked portraits and an optional ring sound.
[MODES.md](MODES.md) documents the format, and the built-in [modes](modes) are complete
examples. Modes are easy to share as folders.

Each reply's text is sent to Anthropic for the rewrite and to ElevenLabs for the audio.
