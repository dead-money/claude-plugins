// The codec band, a court layout in the style of a 1998 stealth game's radio:
// whoever is on the line on the left, the host on the right, and a panel
// between with signal bars and the frequency on a seven-segment display above
// the subtitles. Sized exactly like the court. Colours come from the mode's
// band: `frame` and `frameLit` for the borders, the meter's `lit` and `dim`
// for the display.

import { cellSafe, clamp01, courtPanel, courtPixels, fade, GAP, packCells, wrapRows, type CourtState, type CourtTheme } from './court'

const DEFAULT_FREQUENCY = '140.85'
/** The display's box, in pixels from the top: room for the bars and a digit, at every band of 12 rows or more. */
const BOX_TOP = 2
const BOX_BOTTOM = 15
/** Below this the display gives its rows to the subtitles and the frequency moves into the top rule. */
const DISPLAY_MIN_ROWS = 12

/** Seven segments on a 5x9 pixel grid: [x, y] pixels per segment a..g. */
const SEGMENTS: Array<Array<[number, number]>> = [
  [[1, 0], [2, 0], [3, 0]],
  [[4, 1], [4, 2], [4, 3]],
  [[4, 5], [4, 6], [4, 7]],
  [[1, 8], [2, 8], [3, 8]],
  [[0, 5], [0, 6], [0, 7]],
  [[0, 1], [0, 2], [0, 3]],
  [[1, 4], [2, 4], [3, 4]],
]
const DIGIT_W = 5
const DIGIT_H = 9
const DIGIT_SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg',
  '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
}

/** A codec band's cells for one frame, `rows` tall. */
export const codecCells = (theme: CourtTheme, columns: number, rows: number, state: CourtState) => {
  const H = rows * 2
  const pixels: Array<number | undefined> = Array.from({ length: columns * H }, () => undefined)
  const dot = (x: number, y: number, color: number) => {
    if (x >= 0 && x < columns && y >= 0 && y < H) pixels[y * columns + x] = color
  }
  const text = new Map<number, [string, number]>()
  const write = (x: number, y: number, s: string, fg: number) =>
    [...s].forEach((c, i) => {
      if (x + i >= 0 && x + i < columns && y >= 0 && y < rows) text.set(y * columns + x + i, [c, fg])
    })
  const mid = fade(theme.frame, theme.frameLit, 0.5)
  const { lit, dim } = theme.meter
  // Every frame is as wide as the host's portrait, so a new caller never moves the layout.
  const slot = theme.portraits[theme.host]![rows]!.w

  // A portrait centred in its frame: lit while talking, dimmed while the other talks.
  const portrait = (who: string, x0: number, face: string) => {
    const { art, rgb } = courtPixels(theme, who, rows, face)
    const pad = Math.floor((slot - art.w) / 2)
    const isTalking = state.speaker === who
    const k = state.speaker && !isTalking ? 0.5 : 1
    for (let y = 0; y < Math.min(art.h, H); y++) {
      for (let x = Math.max(0, -pad); x < Math.min(art.w, slot - pad); x++) {
        const i = (y * art.w + x) * 3
        dot(x0 + 1 + pad + x, y, (Math.round((rgb[i] ?? 0) * k) << 16) | (Math.round((rgb[i + 1] ?? 0) * k) << 8) | Math.round((rgb[i + 2] ?? 0) * k))
      }
    }
    const border = isTalking ? theme.frameLit : theme.frame
    for (let y = 0; y < H; y++) {
      dot(x0, y, border)
      dot(x0 + slot + 1, y, border)
    }
    for (let x = x0; x <= x0 + slot + 1; x++) {
      dot(x, 0, border)
      dot(x, H - 1, border)
    }
  }

  const frameWidth = slot + 2
  const panel = courtPanel(theme, rows, columns)
  const px0 = frameWidth + GAP
  portrait(state.contact, 0, state.faces.contact)
  portrait(theme.host, panel ? px0 + panel + GAP : frameWidth + 1, state.faces.host)
  if (!panel) return packCells(columns, rows, pixels, text)

  const frequency = theme.frequencies?.[state.contact] ?? DEFAULT_FREQUENCY
  const hasDisplay = rows >= DISPLAY_MIN_ROWS
  const centred = (y: number, s: string, fg: number) => write(px0 + Math.floor((panel - [...s].length) / 2), y, s, fg)
  const label = (y: number, name: string) => {
    write(px0, y, '─'.repeat(panel), theme.frame)
    centred(y, ` ${name} `, state.speaker ? mid : theme.frame)
  }
  label(0, hasDisplay ? theme.title : `${theme.title}   ${frequency}`)
  label(rows - 1, theme.meter.label)
  write(px0 - 2, Math.floor(rows / 2), '<', theme.frame)
  write(px0 + panel + 1, Math.floor(rows / 2), '>', theme.frame)

  if (hasDisplay) {
    const boxLeft = px0 + 2
    const boxRight = px0 + panel - 3
    for (let x = boxLeft; x <= boxRight; x++) {
      dot(x, BOX_TOP, mid)
      dot(x, BOX_BOTTOM, mid)
    }
    for (let y = BOX_TOP; y <= BOX_BOTTOM; y++) {
      dot(boxLeft, y, mid)
      dot(boxRight, y, mid)
    }
    const screen = fade(dim, 0, 0.7)
    for (let y = BOX_TOP + 1; y < BOX_BOTTOM; y++) for (let x = boxLeft + 1; x < boxRight; x++) dot(x, y, screen)

    // Signal bars lengthening downward; the voice lights them from the bottom.
    const barTop = BOX_TOP + 2
    const bars = Math.floor((BOX_BOTTOM - 2 - barTop + 1) / 2)
    const litBars = Math.round(clamp01(state.level) * bars)
    for (let i = 0; i < bars; i++) {
      const length = Math.round(2 + 3 * ((i + 1) / bars) ** 0.6)
      for (let x = 0; x < length; x++) dot(boxLeft + 2 + x, barTop + i * 2, bars - i <= litBars ? lit : dim)
    }

    // The caller's frequency, unlit segments ghosted.
    const digits = [...frequency].filter(c => c !== '.').length
    const digitTop = Math.round((BOX_TOP + BOX_BOTTOM - DIGIT_H) / 2)
    let x = boxRight - 1 - (digits * (DIGIT_W + 1) + 2)
    for (const ch of frequency) {
      if (ch === '.') {
        dot(x, digitTop + DIGIT_H - 1, lit)
        x += 2
        continue
      }
      const on = DIGIT_SEGMENTS[ch] ?? ''
      SEGMENTS.forEach((segment, s) => {
        for (const [sx, sy] of segment) dot(x + sx, digitTop + sy, on.includes('abcdefg'[s] ?? '') ? lit : dim)
      })
      x += DIGIT_W + 1
    }
  }

  // Who speaks and what, centred in the rows the display leaves.
  const by = state.speaker ?? state.captionBy
  if (state.caption) {
    const first = hasDisplay ? Math.ceil((BOX_BOTTOM + 1) / 2) : 1
    const space = rows - 1 - first
    const gap = space >= 5 ? 1 : 0
    const lines = wrapRows(cellSafe(state.caption), panel - 4, Math.max(1, space - (by ? 1 + gap : 0)))
    const top = first + Math.max(0, Math.floor((space - lines.length - (by ? 1 + gap : 0)) / 2))
    if (by) {
      const ink = theme.ink[by] ?? theme.subtitle
      centred(top, theme.names[by] ?? by.toUpperCase(), state.speaker ? ink : fade(ink, 0, 0.35))
    }
    lines.forEach((line, i) => centred(top + (by ? 1 + gap : 0) + i, line, theme.subtitle))
  }

  return packCells(columns, rows, pixels, text)
}
