// The solo band: the host alone, centred, in falling glyph rain that quickens
// while they speak. The title and a signal meter sit over the left rain, the
// subtitles over the right. The face's edges fade into the rain, and while it
// talks, rows of it now and then slip sideways like a bad signal.

import { cellSafe, clamp01, COURT_ROWS, courtPixels, fade, GAP, packCells, steadyRows, wrapRows, type CourtState, type CourtTheme } from './court'

/** Each side needs this many columns for the subtitles to show. */
const SIDE_MIN = 26
const CAPTION_MAX = 56
const METER_GLYPHS = 10
const DEFAULT_GLYPHS = [...'01:.<>{}#']
/** How many pixels in from the face's edge the fade into the rain reaches. */
const FEATHER = 3

const faceWidth = (theme: CourtTheme, rows: number) => theme.portraits[theme.host]?.[rows]?.w

/** The tallest band whose sides fit the subtitles, else the tallest whose face fits. */
export const soloRowsFor = (theme: CourtTheme, maxRows: number, columns: number, preferRows: number) =>
  steadyRows(theme.title, spare => {
    const sizes = COURT_ROWS.filter(r => {
      const w = faceWidth(theme, r)
      return r <= Math.min(maxRows, preferRows) && w !== undefined && w <= columns - spare
    })
    return sizes.find(r => columns - spare - faceWidth(theme, r)! >= 2 * (SIDE_MIN + GAP)) ?? sizes[0]
  })

type Drop = { y: number; speed: number; glyphs: string[] }
const rain = new Map<string, { columns: number; drops: Array<Drop | undefined> }>()
const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]!

/** A solo band's cells for one frame, `rows` tall. Each call advances the rain one tick. */
export const soloCells = (theme: CourtTheme, columns: number, rows: number, state: CourtState) => {
  const H = rows * 2
  const pixels: Array<number | undefined> = Array.from({ length: columns * H }, () => undefined)
  const text = new Map<number, [string, number]>()
  const clear = new Set<number>()
  const write = (x: number, y: number, s: string, fg: number) =>
    [...s].forEach((c, i) => {
      if (x + i >= 0 && x + i < columns && y >= 0 && y < rows) text.set(y * columns + x + i, [c, fg])
    })
  /** Keeps the rain out of a box of cells, so text over it reads. */
  const clearBox = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.max(0, y0); y <= Math.min(rows - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(columns - 1, x1); x++) clear.add(y * columns + x)
  }

  const { art, rgb } = courtPixels(theme, theme.host, rows, state.faces.host)
  const left = Math.floor((columns - art.w) / 2)
  const right = left + art.w
  const isTalking = state.speaker === theme.host

  // The face, its edges feathered into the dark, with rows slipping sideways now and then while it talks.
  const slips = new Map<number, number>()
  if (Math.random() < (isTalking ? 0.12 : 0.015)) {
    const top = Math.floor(Math.random() * art.h)
    const height = 1 + Math.floor(Math.random() * 3)
    const shift = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 3))
    for (let y = top; y < Math.min(art.h, top + height); y++) slips.set(y, shift)
  }
  for (let y = 0; y < Math.min(art.h, H); y++) {
    const shift = slips.get(y) ?? 0
    for (let x = 0; x < art.w; x++) {
      const sx = x - shift
      if (sx < 0 || sx >= art.w) continue
      const i = (y * art.w + sx) * 3
      const edge = Math.min(x, y, art.w - 1 - x, art.h - 1 - y)
      const k = edge >= FEATHER ? 1 : (edge + 1) / (FEATHER + 1)
      let color = (Math.round((rgb[i] ?? 0) * k) << 16) | (Math.round((rgb[i + 1] ?? 0) * k) << 8) | Math.round((rgb[i + 2] ?? 0) * k)
      if (shift) color = fade(color, theme.frameLit, 0.35)
      pixels[y * columns + left + x] = color
    }
  }

  // Title and meter over the left rain, the subtitles over the right.
  const leftWidth = left - GAP
  const capLeft = right + GAP
  const capWidth = Math.min(columns - capLeft - 1, CAPTION_MAX)
  if (leftWidth >= SIDE_MIN) {
    const title = ` ${theme.title} `
    const tx = Math.floor((leftWidth - title.length) / 2)
    clearBox(tx - 1, 0, tx + title.length, 1)
    write(tx, 0, title, state.speaker ? theme.frameLit : theme.frame)
    const { meter } = theme
    const label = `${meter.label} `
    const mx = Math.floor((leftWidth - label.length - METER_GLYPHS) / 2)
    const lit = Math.round(clamp01(state.level) * METER_GLYPHS)
    clearBox(mx - 1, rows - 2, mx + label.length + METER_GLYPHS, rows - 1)
    write(mx, rows - 1, label, theme.frame)
    for (let i = 0; i < METER_GLYPHS; i++) write(mx + label.length + i, rows - 1, meter.glyph, i < lit ? meter.lit : meter.dim)
  }
  const by = state.speaker ?? state.captionBy
  if (capWidth >= SIDE_MIN - 2 && state.caption) {
    const lines = wrapRows(cellSafe(state.caption), capWidth, Math.max(1, rows - 4))
    const height = lines.length + (by ? 2 : 0)
    const top = Math.max(0, Math.floor((rows - height) / 2))
    const widest = Math.max(...lines.map(line => line.length), by ? (theme.names[by] ?? by).length : 0)
    clearBox(capLeft - 1, top - 1, capLeft + widest, top + height)
    if (by) {
      const ink = theme.ink[by] ?? theme.subtitle
      write(capLeft, top, theme.names[by] ?? by.toUpperCase(), state.speaker ? ink : fade(ink, 0, 0.35))
    }
    lines.forEach((line, i) => write(capLeft, top + (by ? 2 : 0) + i, line, theme.subtitle))
  }

  // The rain: drops down every other column outside the face, bright heads, fading trails.
  const glyphs = theme.glyphs?.length ? theme.glyphs : DEFAULT_GLYPHS
  let field = rain.get(theme.title)
  if (!field || field.columns !== columns) {
    field = { columns, drops: [] }
    rain.set(theme.title, field)
  }
  const pace = 1 + 2.2 * clamp01(state.level)
  for (let x = 0; x < columns; x += 2) {
    if (x >= left - 1 && x <= right) continue
    let drop = field.drops[x]
    if (!drop && Math.random() < 0.03 * pace) {
      const length = 3 + Math.floor(Math.random() * Math.max(3, rows - 2))
      drop = { y: 0, speed: 0.25 + Math.random() * 0.5, glyphs: Array.from({ length }, () => pick(glyphs)) }
    }
    if (!drop) continue
    drop.y += drop.speed * pace
    if (Math.random() < 0.2) drop.glyphs[Math.floor(Math.random() * drop.glyphs.length)] = pick(glyphs)
    const head = Math.floor(drop.y)
    drop.glyphs.forEach((glyph, k) => {
      const y = head - k
      const at = y * columns + x
      if (y < 0 || y >= rows || clear.has(at) || text.has(at)) return
      text.set(at, [glyph, k === 0 ? theme.frameLit : fade(theme.frame, theme.meter.dim, k / drop!.glyphs.length)])
    })
    field.drops[x] = head - drop.glyphs.length > rows ? undefined : drop
  }

  return packCells(columns, rows, pixels, text)
}
