#!/usr/bin/env bash
# Streams one ElevenLabs line to the speakers (macOS and Linux).
#
# stdin: a curl config (url, the key header, the request body), so the key
# never appears in an argument list or the environment.
# AVATAR_FILTER  an ffmpeg -filter_complex graph, or empty for the dry voice
# AVATAR_RING    a raw s16le mono 22050 Hz file played first, or empty
# AVATAR_FFMPEG  the ffmpeg to use (default: ffmpeg on PATH)
set -o pipefail
ff="${AVATAR_FFMPEG:-ffmpeg}"
raw=(-f s16le -ar 22050 -ac 1)
# Without these ffmpeg reads about five seconds of a piped input before it starts.
live=(-probesize 32 -analyzeduration 0 -fflags nobuffer)

# Raw s16le mono 22050 Hz on stdin to the speakers.
play_raw() {
  if [ "$(uname -s)" = Darwin ]; then
    if "$ff" -hide_banner -devices </dev/null 2>/dev/null | grep -q audiotoolbox; then
      "$ff" -hide_banner -loglevel error "${live[@]}" "${raw[@]}" -i - -f audiotoolbox -
    else
      "$ff" -hide_banner -loglevel error "${live[@]}" "${raw[@]}" -i - -f wav - | ffplay -hide_banner -nodisp -autoexit -loglevel error "${live[@]}" -f wav -i -
    fi
  elif command -v pw-play >/dev/null; then
    pw-play --raw --format s16 --rate 22050 --channels 1 -
  elif command -v paplay >/dev/null; then
    paplay --raw --format=s16le --rate=22050 --channels=1
  elif command -v aplay >/dev/null; then
    aplay -q -t raw -f S16_LE -r 22050 -c 1
  else
    "$ff" -hide_banner -loglevel error "${live[@]}" "${raw[@]}" -i - -f wav - | ffplay -hide_banner -nodisp -autoexit -loglevel error "${live[@]}" -f wav -i -
  fi
}

effects() {
  if [ -z "$AVATAR_FILTER" ]; then
    cat
  else
    "$ff" -hide_banner -loglevel error "${live[@]}" "${raw[@]}" -i - -filter_complex "$AVATAR_FILTER" "${raw[@]}" -
  fi
}

if [ -n "$AVATAR_RING" ]; then
  play_raw < "$AVATAR_RING"
fi
curl -sSf -K - | effects | play_raw
