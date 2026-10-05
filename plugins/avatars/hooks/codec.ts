// The codec band, a court layout in the style of a 1998 stealth game's radio:
// whoever is on the line on the left, the host on the right, a panel between
// with signal bars and the frequency on a seven-segment display, and the
// subtitles beside the host. Colours come from the mode's band: `frame` and
// `frameLit` for the borders, the meter's `lit` and `dim` for the display.

import { cellSafe, clamp01, courtPixels, fade, GAP, packCells, wrapRows, type CourtState, type CourtTheme } from './court'

const CODEC_ROWS = [20, 16, 12, 10, 8]
const PANEL = 48
const CAPTION_MIN = 24
const CAPTION_MAX = 70
const SPARE = 4
/** Below this the panel is not worth shrinking the portraits for, unless the band can't be taller anyway. */
const PANEL_MIN_ROWS = 12
const DEFAULT_FREQUENCY = '140.85'

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

/** The left frame is as wide as the widest caller, so a new caller never moves the layout. */
const slotOf = (theme: CourtTheme, rows: number) => {
  const others = Object.keys(theme.portraits).filter(who => who !== theme.host)
  const widths = (others.length ? others : [theme.host]).map(who => theme.portraits[who]?.[rows]?.w ?? 0)
  return Math.max(...widths)
}

type Layout = { slot: number; host: number; panel: boolean; caption: number }

/** What fits at this size: frames always, then the subtitles, then the panel. */
const layoutAt = (theme: CourtTheme, rows: number, columns: number): Layout | undefined => {
  const host = theme.portraits[theme.host]?.[rows]?.w
  if (host === undefined) return undefined
  const slot = slotOf(theme, rows)
  const frames = slot + 2 + 1 + host + 2
  if (frames > columns) return undefined
  const room = (used: number) => Math.min(columns - used - GAP - 1, CAPTION_MAX)
  const withPanel = room(slot + 2 + GAP + PANEL + GAP + host + 2)
  if (withPanel >= CAPTION_MIN) return { slot, host, panel: true, caption: withPanel }
  const plain = room(frames)
  return { slot, host, panel: false, caption: plain >= CAPTION_MIN ? plain : 0 }
}

const codecLastRows = new Map<string, number | undefined>()

/**
 * The tallest band with the panel and subtitles, while that is at least PANEL_MIN_ROWS tall;
 * else the tallest with subtitles; else the tallest that fits.
 */
export const codecRowsFor = (theme: CourtTheme, maxRows: number, columns: number, preferRows: number) => {
  const best = (spare: number) => {
    const sizes = CODEC_ROWS.filter(r => r <= Math.min(maxRows, preferRows)).map(r => [r, layoutAt(theme, r, columns - spare)] as const)
    const fitting = sizes.filter(([, l]) => l !== undefined)
    const tallest = fitting[0]?.[0] ?? 0
    const panelled = fitting.find(([r, l]) => l!.panel && r >= Math.min(PANEL_MIN_ROWS, tallest))
    return (panelled ?? fitting.find(([, l]) => l!.caption > 0) ?? fitting[0])?.[0]
  }
  // Hysteresis, as for the court: a width hovering at a threshold must not flip the band between sizes.
  const last = codecLastRows.get(theme.title)
  const now = best(0)
  const roomy = best(SPARE)
  const keep = last !== undefined && now !== undefined && last <= now && (roomy ?? 0) <= last
  const rows = keep ? last : (roomy ?? now)
  codecLastRows.set(theme.title, rows)
  return rows
}

/** A codec band's cells for one frame, `rows` tall. */
export const codecCells = (theme: CourtTheme, columns: number, rows: number, state: CourtState) => {
  const layout = layoutAt(theme, rows, columns)
  const H = rows * 2
  const pixels: Array<number | undefined> = Array.from({ length: columns * H }, () => undefined)
  if (!layout) return packCells(columns, rows, pixels, new Map())
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

  // A portrait centred in its frame: lit while talking, dimmed while the other talks.
  const portrait = (who: string, x0: number, slot: number, face: string) => {
    const { art, rgb } = courtPixels(theme, who, rows, face)
    const pad = Math.floor((slot - art.w) / 2)
    const isTalking = state.speaker === who
    const k = state.speaker && !isTalking ? 0.5 : 1
    for (let y = 0; y < Math.min(art.h, H); y++) {
      for (let x = 0; x < art.w; x++) {
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
    return x0 + slot + 2
  }

  const afterLeft = portrait(state.contact, 0, layout.slot, state.faces.contact)
  const px0 = afterLeft + GAP
  const afterRight = portrait(theme.host, layout.panel ? px0 + PANEL + GAP : afterLeft + 1, layout.host, state.faces.host)

  if (layout.panel) {
    // The title above and the meter's label below, each on a rule; a lit screen between.
    const label = (y: number, name: string) => {
      write(px0, y, '─'.repeat(PANEL), theme.frame)
      write(px0 + Math.floor((PANEL - name.length - 2) / 2), y, ` ${name} `, state.speaker ? mid : theme.frame)
    }
    label(0, theme.title)
    label(rows - 1, theme.meter.label)
    write(px0 - 2, Math.floor(rows / 2), '<', theme.frame)
    write(px0 + PANEL + 1, Math.floor(rows / 2), '>', theme.frame)

    const boxTop = rows >= 12 ? 3 : 2
    const boxBottom = H - 1 - boxTop
    const boxLeft = px0 + 2
    const boxRight = px0 + PANEL - 3
    for (let x = boxLeft; x <= boxRight; x++) {
      dot(x, boxTop, mid)
      dot(x, boxBottom, mid)
    }
    for (let y = boxTop; y <= boxBottom; y++) {
      dot(boxLeft, y, mid)
      dot(boxRight, y, mid)
    }
    const screen = fade(dim, 0, 0.7)
    for (let y = boxTop + 1; y < boxBottom; y++) for (let x = boxLeft + 1; x < boxRight; x++) dot(x, y, screen)

    // Signal bars lengthening downward; the voice lights them from the bottom.
    const barTop = boxTop + 2
    const bars = Math.floor((boxBottom - 2 - barTop + 1) / 2)
    const litBars = Math.round(clamp01(state.level) * bars)
    for (let i = 0; i < bars; i++) {
      const length = Math.round(2 + 4 * ((i + 1) / bars) ** 0.6)
      for (let x = 0; x < length; x++) dot(boxLeft + 2 + x, barTop + i * 2, bars - i <= litBars ? lit : dim)
    }

    // The caller's frequency, unlit segments ghosted.
    const frequency = theme.frequencies?.[state.contact] ?? DEFAULT_FREQUENCY
    const digits = [...frequency].filter(c => c !== '.').length
    const digitTop = Math.round((boxTop + boxBottom - DIGIT_H) / 2)
    let x = boxRight - 2 - (digits * (DIGIT_W + 1) + 2)
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

  const by = state.speaker ?? state.captionBy
  if (layout.caption && state.caption) {
    const capLeft = afterRight + GAP
    const top = Math.max(0, Math.floor(rows / 2) - 3)
    if (by) {
      const ink = theme.ink[by] ?? theme.subtitle
      write(capLeft, top, theme.names[by] ?? by.toUpperCase(), state.speaker ? ink : fade(ink, 0, 0.35))
    }
    wrapRows(cellSafe(state.caption), layout.caption, Math.max(1, rows - top - 2)).forEach((line, i) => write(capLeft, top + 2 + i, line, theme.subtitle))
  }

  return packCells(columns, rows, pixels, text)
}
