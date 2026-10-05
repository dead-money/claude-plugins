// A mode's band above the prompt: its host's portrait on the left, whoever is
// talking to them on the right, and a panel between with the title, who speaks,
// the subtitles and a level meter. Portraits are half-block pixels (two per
// terminal cell); the whole band is one Raster's cells, rebuilt every tick and
// blitted in place.

/** One baked portrait size: `h` rows of `w` RGB pixels per frame, base64. */
export type Portrait = { w: number; h: number; frames: Record<string, string> }

/** How one mode's band looks: its cast's portraits, frame colours, title and meter. */
export type CourtTheme = {
  /** Per member, per band height in terminal rows. */
  portraits: Record<string, Record<number, Portrait>>
  /** Who is always in the left frame. */
  host: string
  names: Record<string, string>
  ink: Record<string, number>
  frame: number
  /** The frame of whoever is talking. */
  frameLit: number
  corner: number
  /** Centred in the panel's top rule. */
  title: string
  subtitle: number
  /** The level meter centred in the bottom rule: `label` then `glyph`s lit by the voice. */
  meter: { label: string; glyph: string; lit: number; dim: number }
  /** `codec`: a radio call with a frequency panel. `solo`: the host alone, centred in glyph rain. */
  layout?: 'codec' | 'solo'
  /** Court layout: an image over the subtitles, per band height, that brightens with the voice. */
  emblem?: Record<number, Portrait>
  /** Solo layout: the glyphs the rain is made of. */
  glyphs?: string[]
  /** Codec layout: the frequency on the panel while each member is on the line. */
  frequencies?: Record<string, string>
}

export type CourtState = {
  /** Who is talking, or undefined between lines. */
  speaker?: string
  /** Who is in the right frame: the last member other than the host to speak. */
  contact: string
  /** Each frame's portrait this tick. */
  faces: { host: string; contact: string }
  /** 0..1, how much of the meter is lit. */
  level: number
  caption: string
  /** Who said the caption (it stays after the call ends). */
  captionBy?: string
}

const DEFAULT_COLOR = 0x01000000
const HALF_BLOCK = 0x2580
export const GAP = 3
/** Characters a cell may hold beyond printable ASCII (each width 1). */
const EXTRA_GLYPHS = new Set([...'…—–‘’“”'])

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

// ── base64 (decoded once per art; encoded every frame) ──

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]))

const fromBase64 = (text: string) => {
  const clean = text.replace(/=+$/, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let bits = 0
  let value = 0
  let o = 0
  for (const c of clean) {
    value = (value << 6) | (B64_INDEX.get(c) ?? 0)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (value >> bits) & 0xff
    }
  }
  return out
}

const toBase64 = (bytes: Uint8Array) => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? B64[n & 63]! : '='
  }
  return out
}


export const fade = (from: number, to: number, t: number) => {
  let out = 0
  for (const shift of [16, 8, 0]) {
    const a = (from >> shift) & 0xff
    const b = (to >> shift) & 0xff
    out |= Math.round(a + (b - a) * t) << shift
  }
  return out
}

/** Words of `text` in `count` rows of `width`, the last cut with an ellipsis. */
export const wrapRows = (text: string, width: number, count: number) => {
  const rows: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (next.length <= width) {
      line = next
      continue
    }
    if (rows.length === count - 1) {
      rows.push(next.slice(0, Math.max(0, width - 1)) + '…')
      return rows
    }
    rows.push(line)
    line = word.slice(0, width)
  }
  if (line) rows.push(line)
  return rows.slice(0, count)
}

// Accented Latin letters (chérie, señora) are one cell wide too; NFC folds a combining accent into its letter.
export const cellSafe = (text: string) =>
  [...text.normalize('NFC')].map(c => (/[\x20-\x7e\u00a0-\u017f]/.test(c) || EXTRA_GLYPHS.has(c) ? c : '?')).join('')


/** Pixels and text into cells: half blocks, the terminal's background where empty. */
export const packCells = (
  columns: number,
  rows: number,
  pixels: Array<number | undefined>,
  text: Map<number, [string, number]>,
) => {
  const words = new Uint32Array(columns * rows * 3)
  for (let y = 0; y < rows; y++) {
    for (let cx = 0; cx < columns; cx++) {
      const i = (y * columns + cx) * 3
      const t = text.get(y * columns + cx)
      const top = pixels[2 * y * columns + cx]
      const bottom = pixels[(2 * y + 1) * columns + cx]
      if (t) {
        words[i] = t[0].codePointAt(0) ?? 0x20
        words[i + 1] = t[1]
        words[i + 2] = DEFAULT_COLOR
      } else if (top === undefined && bottom === undefined) {
        words[i] = 0x20
        words[i + 1] = DEFAULT_COLOR
        words[i + 2] = DEFAULT_COLOR
      } else if (top === undefined) {
        words[i] = 0x2584
        words[i + 1] = bottom ?? DEFAULT_COLOR
        words[i + 2] = DEFAULT_COLOR
      } else {
        words[i] = HALF_BLOCK
        words[i + 1] = top
        words[i + 2] = bottom ?? DEFAULT_COLOR
      }
    }
  }
  return toBase64(new Uint8Array(words.buffer))
}

export const COURT_ROWS = [20, 16, 12, 10, 8]
const METER_GLYPHS = 10
const COURT_PANEL = 46
const COURT_SPARE = 4

const courtDecoded = new Map<string, Uint8Array>()
/** The emblem's top, in pixels: just under the title's rule. */
const EMBLEM_TOP = 3
const courtEmblemPixels = (theme: CourtTheme, rows: number, emblem: Portrait) => {
  const key = `${theme.title}$emblem${rows}`
  let rgb = courtDecoded.get(key)
  if (!rgb) {
    rgb = fromBase64(emblem.frames.neutral ?? '')
    courtDecoded.set(key, rgb)
  }
  return rgb
}
export const courtPixels = (theme: CourtTheme, who: string, rows: number, frame: string) => {
  const art = (theme.portraits[who] ?? theme.portraits[theme.host]!)[rows] as Portrait
  // Blinks are a single frame: a half-blink shows it too.
  const name = frame in art.frames ? frame : frame.startsWith('blink') ? 'blink' : 'neutral'
  const key = `${theme.title}${who}${rows}${name}`
  let rgb = courtDecoded.get(key)
  if (!rgb) {
    rgb = fromBase64(art.frames[name] ?? art.frames.neutral ?? '')
    courtDecoded.set(key, rgb)
  }
  return { art, rgb }
}

/** Both frames must fit; the panel between them shows only when there is room. */
const courtFits = (theme: CourtTheme, rows: number, columns: number) => {
  const art = theme.portraits[theme.host]![rows]
  return art !== undefined && 2 * (art.w + 3) - 1 <= columns
}

/**
 * The panel's width between the two frames at this size, or 0 when it won't fit.
 * Fixed: the band's width wobbles a few columns as the UI
 * around the prompt changes, and a panel that followed it would flicker.
 */
export const courtPanel = (theme: CourtTheme, rows: number, columns: number) => {
  const art = theme.portraits[theme.host]![rows]
  return art && 2 * (art.w + 2) + 2 * GAP + COURT_PANEL <= columns ? COURT_PANEL : 0
}

const lastRows = new Map<string, number | undefined>()

/**
 * The band height for `key`, from `best(spare)`: the height that fits with `spare` columns held back.
 * Keeps the size in use unless it stops fitting, and grows only with room to spare, so a width
 * hovering at a threshold doesn't flip the band between sizes.
 */
export const steadyRows = (key: string, best: (spare: number) => number | undefined) => {
  const last = lastRows.get(key)
  const now = best(0)
  const roomy = best(COURT_SPARE)
  const keep = last !== undefined && now !== undefined && last <= now && (roomy ?? 0) <= last
  const rows = keep ? last : (roomy ?? now)
  lastRows.set(key, rows)
  return rows
}

/** The tallest band that fits with its panel, else the tallest whose frames fit. */
export const courtRowsFor = (theme: CourtTheme, maxRows: number, columns: number, preferRows: number) =>
  steadyRows(theme.title, spare => {
    const sizes = COURT_ROWS.filter(r => r <= Math.min(maxRows, preferRows) && courtFits(theme, r, columns - spare))
    return sizes.find(r => courtPanel(theme, r, columns - spare) > 0) ?? sizes[0]
  })

/** A court band's cells for one frame, `rows` tall. */
export const courtCells = (theme: CourtTheme, columns: number, rows: number, state: CourtState) => {
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

  // A portrait in its frame, lit while talking. Never dimmed: painted portraits
  // lose their detail darkened.
  const frame = (who: string, x0: number, face: string) => {
    const { art, rgb } = courtPixels(theme, who, rows, face)
    for (let y = 0; y < art.h; y++) {
      for (let x = 0; x < art.w; x++) {
        const i = (y * art.w + x) * 3
        dot(x0 + 1 + x, y, ((rgb[i] ?? 0) << 16) | ((rgb[i + 1] ?? 0) << 8) | (rgb[i + 2] ?? 0))
      }
    }
    const border = state.speaker === who ? theme.frameLit : theme.frame
    for (let y = 0; y < H; y++) {
      dot(x0, y, border)
      dot(x0 + art.w + 1, y, border)
    }
    for (let x = x0; x <= x0 + art.w + 1; x++) {
      dot(x, 0, border)
      dot(x, H - 1, border)
    }
    for (const [cx, cy] of [[x0, 0], [x0 + art.w + 1, 0], [x0, H - 1], [x0 + art.w + 1, H - 1]] as const) dot(cx, cy, theme.corner)
  }
  const frameWidth = theme.portraits[theme.host]![rows]!.w + 2
  const panel = courtPanel(theme, rows, columns)
  frame(theme.host, 0, state.faces.host)
  const px0 = frameWidth + GAP
  frame(state.contact, panel ? px0 + panel + GAP : frameWidth + 1, state.faces.contact)
  if (!panel) return packCells(columns, rows, pixels, text)

  // Rules top and bottom: the title above, the meter below; who speaks and what between.
  const centred = (y: number, s: string, fg: number) => write(px0 + Math.floor((panel - [...s].length) / 2), y, s, fg)
  const rule = '─'.repeat(panel)
  write(px0, 0, rule, theme.frame)
  centred(0, ` ${theme.title} `, theme.frameLit)
  write(px0, rows - 1, rule, theme.frame)
  // An empty glyph leaves only the label.
  const { meter } = theme
  const glyphs = meter.glyph ? METER_GLYPHS : 0
  const lit = Math.round(clamp01(state.level) * glyphs)
  const label = ` ${meter.label} `
  const meterLeft = px0 + Math.floor((panel - label.length - glyphs - (glyphs ? 1 : 0)) / 2)
  write(meterLeft, rows - 1, label, theme.frame)
  for (let i = 0; i < glyphs; i++) write(meterLeft + label.length + i, rows - 1, meter.glyph, i < lit ? meter.lit : meter.dim)
  if (glyphs) write(meterLeft + label.length + glyphs, rows - 1, ' ', theme.frame)

  // The emblem under the title, flickering a little and brightening while someone speaks.
  let first = 2
  const emblem = theme.emblem?.[rows]
  if (emblem) {
    const rgb = courtEmblemPixels(theme, rows, emblem)
    const k = 0.6 + 0.4 * clamp01(state.level) + (Math.random() - 0.5) * 0.08
    const ex = px0 + Math.floor((panel - emblem.w) / 2)
    for (let y = 0; y < emblem.h; y++) {
      for (let x = 0; x < emblem.w; x++) {
        const i = (y * emblem.w + x) * 3
        const r = rgb[i] ?? 0
        const g = rgb[i + 1] ?? 0
        const b = rgb[i + 2] ?? 0
        if (r + g + b < 24) continue
        const c = (v: number) => Math.min(255, Math.round(v * k))
        dot(ex + x, EMBLEM_TOP + y, (c(r) << 16) | (c(g) << 8) | c(b))
      }
    }
    first = Math.ceil((EMBLEM_TOP + emblem.h) / 2) + 1
  }

  const by = state.speaker ?? state.captionBy
  if (state.caption) {
    const space = rows - 1 - first
    const head = by ? (space >= 5 ? 2 : 1) : 0
    const lines = wrapRows(cellSafe(state.caption), panel - 4, Math.max(1, space - head))
    const top = first + Math.max(0, Math.floor((space - lines.length - head) / 2))
    const ink = by ? (theme.ink[by] ?? theme.subtitle) : theme.subtitle
    if (by) centred(top, theme.names[by] ?? by.toUpperCase(), state.speaker ? ink : fade(ink, 0, 0.35))
    lines.forEach((line, i) => centred(top + head + i, line, theme.subtitle))
  }
  return packCells(columns, rows, pixels, text)
}
