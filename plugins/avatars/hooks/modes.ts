// Modes are folders of data: `mode.json` (who speaks, how, and how it sounds),
// and for a cast mode `portraits.json` (baked by bin/bake-portraits.py) and an
// optional ring sound. The built-in modes ship in the plugin's `modes/`, mode
// packs (other plugins) in their `avatars/modes/`, and the person's own in
// `~/.claude/avatars/modes/`; later ones win on a name clash.
// MODES.md documents the format.

import type { CourtTheme, Portrait } from './court'
import type { Effect } from './effects'

type Weighted = { weight: number; text: string }

/** One speaking member of a cast mode, as `mode.json` holds them. */
export type CastMember = {
  /** How Sonnet writes them before a line, in capitals. */
  name: string
  /** Other names Sonnet might write for them ("queen", "boss"). */
  aliases?: string[]
  /** Their ElevenLabs voice id. */
  voice: string
  /** A public library voice's owner id, so it can be added to an account that needs that first. */
  libraryOwner?: string
  /** Shifts their voice's pitch, keeping its speed: 0.95 is 5% lower. */
  pitch?: number
  /** Their name and subtitle colour in the band, `#rrggbb`. */
  ink?: string
  persona: string
  /** What brings them into a call. */
  speaksAbout: string
  /** Audio tags that suit them, for v3/v4 voice models. */
  tags?: string
  /** Portrait frames shown while someone else talks. */
  idle?: Array<{ frame: string; weight: number; ms: [number, number] }>
  /** A frame that punctuates talking when a line's tags match `when` (a regex, case-insensitive). */
  accent?: { frame: string; when: string }
  /** Codec layout: the frequency the panel shows while they are on the line. */
  frequency?: string
}

export type ModeFile = {
  title: string
  description: string
  /** A single-voice mode's default voice; the person may pick another. */
  voice?: string
  /** The default voice's library owner id, as for a cast member. */
  voiceOwner?: string
  /** A single-voice mode's persona, added to Sonnet's instructions. */
  persona?: string
  /** Extra persona guidance used only when the voice model performs tags. */
  personaTags?: string
  /** A cast mode: Sonnet writes `NAME:` lines, each spoken in its member's voice. */
  call?: {
    /** What the call is, who did the work, who is always present. */
    premise: string
    /** Always in the band's left frame. */
    host: string
    /** Who says a reply that came back without any `NAME:` lines. */
    fallback: string
    cast: Record<string, CastMember>
    /** Extra cast notes (a pet that never speaks). */
    extras?: string[]
    /** A paragraph on tone. */
    style?: string
    /** Who trades lines with whom. */
    turns: string
    /** What must survive the delivery, beyond the outcome and any question. */
    accuracy?: string
    /** How the voices differ, completing "Keep each voice distinct: ". */
    distinct?: string
    /** Picked per call: who reports. */
    reporters?: Weighted[]
    /** Picked per call: what kind of call it is, with an optional note on who joins. */
    kinds: Array<Weighted & { note?: string }>
  }
  /** The band above the prompt (cast modes with portraits). Colours are `#rrggbb`. */
  band?: {
    title: string
    frame: string
    frameLit: string
    corner: string
    subtitle: string
    meter: { label: string; glyph: string; lit: string; dim: string }
    /** `codec`: a radio call with a frequency panel. `solo`: the host alone, centred in glyph rain. */
    layout?: 'codec' | 'solo'
    /** Solo layout: the characters the rain falls in, each one cell wide. */
    glyphs?: string
    /** Codec layout: the frequency shown for a member without their own. */
    frequency?: string
  }
  audio?: {
    /** An ffmpeg -filter_complex graph over mono 22050 Hz audio. */
    filter?: string
    /** Post effects on the dry voice, planned fresh for every line, ahead of `filter`. */
    effects?: Effect[]
    /** Raw s16le mono 22050 Hz, played before a call's first line, and its length. */
    ring?: { file: string; ms: number }
  }
  /** Played when the mode is switched on: lines (`NAME: text` for a cast mode). */
  sample: string[]
  /** Played by `/avatar test`. */
  demos: string[][]
  /** Longer scripted calls for `/avatar scenario`. */
  scenarios?: Record<string, { title: string; script: string[] }>
}

export type Mode = ModeFile & {
  name: string
  /** The folder it was read from. */
  dir: string
  /** The band's look, when the mode has portraits and a band. */
  theme?: CourtTheme
}

const color = (hex: string | undefined, fallback: number) => {
  const n = hex ? Number.parseInt(hex.replace(/^#/, ''), 16) : Number.NaN
  return Number.isFinite(n) ? n : fallback
}

/** What is wrong with a mode file, if anything, for the person to fix. */
const problemsOf = (file: ModeFile, portraits: Record<string, Record<number, Portrait>> | undefined) => {
  const problems: string[] = []
  if (typeof file.title !== 'string') problems.push('no title')
  if (!Array.isArray(file.sample) || !Array.isArray(file.demos)) problems.push('sample and demos must be arrays')
  const call = file.call
  if (call) {
    const members = Object.keys(call.cast ?? {})
    if (!members.length) problems.push('call.cast is empty')
    if (!members.includes(call.host)) problems.push(`call.host ${call.host} is not in the cast`)
    if (!members.includes(call.fallback)) problems.push(`call.fallback ${call.fallback} is not in the cast`)
    if (!call.kinds?.length) problems.push('call.kinds is empty')
    for (const [who, m] of Object.entries(call.cast ?? {})) {
      if (!m.voice || !m.name) problems.push(`${who} needs a name and a voice`)
    }
    if (file.band && !portraits) problems.push('band needs portraits.json')
    if (file.band && portraits && !portraits[call.host]) problems.push(`portraits.json has no ${call.host}`)
    if (file.band?.layout !== undefined && file.band.layout !== 'codec' && file.band.layout !== 'solo') {
      problems.push(`band.layout ${file.band.layout} is not a layout (codec, solo, or leave it out)`)
    }
  } else if (file.band) {
    problems.push('band needs a call (a cast)')
  }
  return problems
}

const themeOf = (file: ModeFile, portraits: Record<string, Record<number, Portrait>>): CourtTheme | undefined => {
  const { call, band } = file
  if (!call || !band) return undefined
  const cast = Object.entries(call.cast)
  return {
    portraits,
    host: call.host,
    names: Object.fromEntries(cast.map(([who, m]) => [who, m.name])),
    ink: Object.fromEntries(cast.map(([who, m]) => [who, color(m.ink, 0xffffff)])),
    frame: color(band.frame, 0x444444),
    frameLit: color(band.frameLit, 0xaaaaaa),
    corner: color(band.corner, 0xcccccc),
    title: band.title,
    subtitle: color(band.subtitle, 0xffffff),
    meter: {
      label: band.meter.label,
      glyph: band.meter.glyph,
      lit: color(band.meter.lit, 0xffffff),
      dim: color(band.meter.dim, 0x333333),
    },
    layout: band.layout,
    emblem: portraits.$emblem,
    glyphs: band.glyphs ? [...band.glyphs] : undefined,
    frequencies: Object.fromEntries(
      cast.flatMap(([who, m]) => {
        const frequency = m.frequency ?? band.frequency
        return frequency ? [[who, frequency] as const] : []
      }),
    ),
  }
}

/** A mode from its files' text, or what is wrong with it. */
export const buildMode = (name: string, dir: string, modeText: string, portraitsText: string | undefined): Mode | string => {
  let file: ModeFile
  try {
    file = JSON.parse(modeText) as ModeFile
  } catch (err) {
    return `${name}: mode.json does not parse (${String(err)})`
  }
  let portraits: Record<string, Record<number, Portrait>> | undefined
  if (portraitsText !== undefined) {
    try {
      portraits = JSON.parse(portraitsText)
    } catch (err) {
      return `${name}: portraits.json does not parse (${String(err)})`
    }
  }
  const problems = problemsOf(file, portraits)
  if (problems.length) return `${name}: ${problems.join('; ')}`
  return { ...file, name, dir, theme: portraits ? themeOf(file, portraits) : undefined }
}

/** A folder name that can be a mode's name. */
export const isModeName = (name: string) => /^[a-z0-9][a-z0-9_-]*$/.test(name)

const pickWeighted = <T extends { weight: number }>(list: readonly T[]) => {
  let r = Math.random() * list.reduce((n, item) => n + item.weight, 0)
  return list.find(item => (r -= item.weight) <= 0) ?? list[0]!
}

/** The call format and every member's persona, for Sonnet's system prompt. */
export const callPersona = (mode: Mode, hasTags: boolean) => {
  const call = mode.call!
  const cast = Object.values(call.cast)
    .map(m => `- ${m.name}: ${m.persona}\n  Speaks about: ${m.speaksAbout}${hasTags && m.tags ? `\n  Tags that suit them: ${m.tags}` : ''}`)
    .concat((call.extras ?? []).map(extra => `- ${extra}`))
    .join('\n')
  const rules = [
    `One speaker per line, each line on its own line starting "NAME: ". ${call.turns}`,
    `The call is delivery, not content: the outcome, the numbers that matter, and any question or decision for the user must come through accurately.${call.accuracy ? ` ${call.accuracy}` : ''}`,
    'Match the length the <call> block asks for.',
    ...(call.distinct ? [`Keep each voice distinct: ${call.distinct}`] : []),
    ...(hasTags ? ['Start each line with one tag that fits the speaker and the moment.'] : []),
    'No narration, no sound effects, nothing outside the lines.',
  ]
  return `
Format: this replaces the single-speaker rules above. ${call.premise}

The cast (each line starts with the speaker's name in capitals, then a colon):
${cast}
${call.style ? `\n${call.style}\n` : ''}
Rules:
${rules.map(rule => `- ${rule}`).join('\n')}`
}

/** The <call> block for one reply: who reports, what kind of call, how long. */
export const planCall = (mode: Mode, replyChars: number) => {
  const call = mode.call!
  const kind = pickWeighted(call.kinds)
  const lines =
    replyChars < 500 ? '2 to 3 lines, under 50 words' :
    replyChars < 1500 ? '3 to 5 lines, under 100 words' :
    replyChars < 4000 ? '4 to 7 lines, under 160 words' :
    '6 to 10 lines, under 230 words'
  return [
    '<call>',
    ...(call.reporters?.length ? [`Reporting: ${pickWeighted(call.reporters).text}`] : []),
    `Kind of call: ${kind.text}`,
    ...(kind.note ? [kind.note] : []),
    `Length: ${lines}.`,
    '</call>',
  ].join('\n')
}

/** Who a `NAME` Sonnet wrote means, by key, name or alias. */
export const speakerOf = (mode: Mode, written: string) => {
  const said = written.trim().toLowerCase()
  for (const [who, m] of Object.entries(mode.call?.cast ?? {})) {
    const names = [who, m.name, ...(m.aliases ?? [])].map(n => n.toLowerCase())
    if (names.includes(said)) return who
  }
  return undefined
}

/** `NAME: ...` lines for the mode's cast; a line without a known name continues the last. */
export const parseCall = (mode: Mode, text: string) => {
  const lines: Array<{ speaker: string; text: string }> = []
  for (const raw of text.split('\n')) {
    const m = raw.match(/^\s*\**\s*([A-Za-z][A-Za-z .'-]{0,24}?)\s*\**\s*:\s*(.+)$/)
    const speaker = m ? speakerOf(mode, m[1] ?? '') : undefined
    if (m && speaker) lines.push({ speaker, text: (m[2] ?? '').trim() })
    else if (raw.trim() && lines.length) lines[lines.length - 1]!.text += ` ${raw.trim()}`
  }
  return lines.length ? lines : [{ speaker: mode.call!.fallback, text: text.trim() }]
}

/** Whether a demo has this speaker in it, by key, name or alias. */
export const demoHas = (mode: Mode, demo: string[], who: string) => {
  const wanted = speakerOf(mode, who)
  return wanted !== undefined && demo.some(line => speakerOf(mode, line.match(/^\s*([^:]{1,24}):/)?.[1] ?? '') === wanted)
}
