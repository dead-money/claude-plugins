import { atom, read, update } from 'claude-code'
import type { Engine, PluginOptions, Register, Timer } from 'claude-code'

import { codecCells } from './codec'
import { withEffects } from './effects'
import { soloCells, soloRowsFor } from './solo'
import { courtCells, courtRowsFor } from './court'
import { buildMode, callPersona, demoHas, isModeName, parseCall, planCall, type Mode } from './modes'
import type { Setting, VoiceChoice } from '../types'

const DEFAULT_MODE = 'coven'
const DEFAULT_MODEL = 'eleven_v4_turbo'
const MODELS = ['eleven_v4_turbo', 'eleven_v4', 'eleven_v3', 'eleven_flash_v2_5', 'eleven_multilingual_v2']
const MAX_REPLY_CHARS = 12000
const API = 'https://api.elevenlabs.io'
const MENU = 'avatars'

const SYSTEM = `You turn a coding assistant's written reply into what it would say aloud to the user who asked.

Rules:
- Speak as the assistant, first person, to "you". Natural spoken English.
- One to four sentences, under 80 words. Shorter is better when the reply is short.
- Lead with the outcome. Keep any question the reply asks the user, and any decision they must make.
- Never read code, commands, file paths, URLs, IDs or tables aloud: describe them ("I edited the config file").
- Say numbers the way a person would. No markdown, no lists, no emoji.
- Output only the words to speak, nothing else.`

// v3/v4 models act on [bracketed] audio tags; older ones would read them out.
const TAG_RULES = `
Audio tags: the voice model performs inline directions in square brackets.
- Use one to three tags, each placed just before the words it colors.
- Fit the tone to the content: [quietly pleased] for something finished, [apologetic] for a failure, [curious] or [thoughtful] for a question, [dry] for an aside. Free-text directions like [dry amusement] work too.
- [pause] or [short pause] for a beat before a key point. [sighs] or [laughs softly] only when it genuinely fits.
- Never sound effects, never shouting, never a tag on every sentence. Restraint sounds better.`

const hasTags = (model: string) => /^eleven_v[34]/.test(model)
const stripTags = (text: string) => text.replace(/\[[^\]]*\]\s*/g, '').trim()
const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)] as T

// ── Modes and options ──

// Module state: a reload reads the modes again and stops any playback.
let modes = new Map<string, Mode>()
let modeErrors: string[] = []
let options: PluginOptions = {}
let isInteractive = true
let isLoaded = false
let isWindows = false
let userModesDir = ''
/** The person's own voices for any mode's characters: `{ mode: { member: voiceId } }`. */
let voicesFile = ''
let personal: Record<string, Record<string, string>> = {}

const option = (name: string) => {
  const value = options[name]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const apiKey = async ($: Engine) => option('api_key') ?? ((await $.env.get('ELEVENLABS_API_KEY'))?.trim() || undefined)

const readMode = async ($: Engine, dir: string, name: string) => {
  try {
    const portraits = (await $.fs.exists(`${dir}/portraits.json`)) ? await $.fs.read(`${dir}/portraits.json`) : undefined
    return buildMode(name, dir, await $.fs.read(`${dir}/mode.json`), portraits)
  } catch (err) {
    return `${name}: ${String(err)}`
  }
}

/** Every mode in the plugin's folder, then the person's, which win on a name clash. */
const reloadModes = async ($: Engine) => {
  isWindows = /^[A-Za-z]:[\\/]/.test($.plugin.root) || $.plugin.root.includes('\\')
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const avatarsDir = home ? `${home.replace(/[\\/]+$/, '')}/.claude/avatars` : ''
  userModesDir = avatarsDir && `${avatarsDir}/modes`
  voicesFile = avatarsDir && `${avatarsDir}/voices.json`
  const found = new Map<string, Mode>()
  const errors: string[] = []
  for (const root of [`${$.plugin.root}/modes`, userModesDir]) {
    if (!root || !(await $.fs.exists(root))) continue
    for (const entry of await $.fs.list(root)) {
      const dir = `${root}/${entry.name}`
      if (entry.kind !== 'dir' || !isModeName(entry.name) || !(await $.fs.exists(`${dir}/mode.json`))) continue
      const mode = await readMode($, dir, entry.name)
      if (typeof mode === 'string') errors.push(mode)
      else found.set(mode.name, mode)
    }
  }
  personal = {}
  if (voicesFile && (await $.fs.exists(voicesFile))) {
    try {
      personal = JSON.parse(await $.fs.read(voicesFile))
    } catch (err) {
      errors.push(`voices.json does not parse (${String(err)})`)
    }
  }
  for (const [name, voices] of Object.entries(personal)) {
    const mode = found.get(name)
    if (!mode) continue
    for (const [who, voice] of Object.entries(voices)) {
      const member = mode.call?.cast[who]
      if (member) {
        member.voice = voice
        delete member.libraryOwner
        delete member.pitch
      } else if (who === 'voice' && !mode.call) {
        mode.voice = voice
        delete mode.voiceOwner
      }
    }
  }
  modes = found
  modeErrors = errors
  isLoaded = true
}

/** Loads the modes on first use when the plugin arrived after the session started. */
const ensureLoaded = async ($: Engine) => {
  if (isLoaded) return
  await reloadModes($)
  if (isInteractive) await showBand($, await modeOf($))
}

// ── Settings: this session's, over the plugin's configured defaults ──

const bandMode = atom({ plugin: 'avatars', key: 'bandMode' } as const, false as string | false)
const enabledSetting = atom({ plugin: 'avatars', key: 'enabled' } as const, null as Setting)
const modeSetting = atom({ plugin: 'avatars', key: 'mode' } as const, null as Setting)
const voiceSetting = atom({ plugin: 'avatars', key: 'voice' } as const, null as Setting)
const modelSetting = atom({ plugin: 'avatars', key: 'model' } as const, null as Setting)
const lastSaid = atom({ plugin: 'avatars', key: 'last' } as const, null as Setting)
const libraryVoices = atom({ plugin: 'avatars', key: 'voices' } as const, null as VoiceChoice[] | null)
const menuNote = atom({ plugin: 'avatars', key: 'note' } as const, '')

const isEnabled = async ($: Engine) => {
  const session = await read($, enabledSetting)
  if (session !== null) return session === 'on'
  return options.speak !== false
}

const modeOf = async ($: Engine) => {
  const name = (await read($, modeSetting)) ?? option('mode') ?? DEFAULT_MODE
  return name === 'off' ? undefined : (modes.get(name) ?? modes.get(DEFAULT_MODE))
}

const modelOf = async ($: Engine) => (await read($, modelSetting)) ?? option('model') ?? DEFAULT_MODEL

/** The voice of a single-voice mode: the session's pick, the configured one, the mode's own. */
const voiceOf = async ($: Engine, mode: Mode | undefined) =>
  (await read($, voiceSetting)) ?? option('voice') ?? mode?.voice ?? ''

const systemFor = (model: string, mode: Mode | undefined) =>
  SYSTEM +
  (hasTags(model) ? TAG_RULES : '') +
  (mode?.call ? callPersona(mode, hasTags(model)) : `${mode?.persona ?? ''}${hasTags(model) ? (mode?.personaTags ?? '') : ''}`)

/** Accepts a bare voice id or any elevenlabs.io URL ending in one. */
const parseVoice = (arg: string) => arg.match(/([A-Za-z0-9]{20})\/?(?:[?#].*)?$/)?.[1]

// ── The band: the mode's host on the left, whoever talks to them on the right ──

const BAND_KEY = 'band'
const TICK_MS = 90
const PREFER_ROWS = 20
const CHARS_PER_SECOND = 12

type Script = {
  /** Spoken characters, tags removed; a pause is a run of spaces. */
  plain: string
  /** From each character index on, the performed tag in force. */
  cues: Array<{ at: number; tag: string }>
}

const scriptOf = (text: string): Script => {
  let plain = ''
  const cues: Script['cues'] = []
  for (const part of text.split(/(\[[^\]]*\])/)) {
    const tag = part.match(/^\[([^\]]*)\]$/)?.[1]
    if (tag === undefined) plain += part
    else if (/pause/i.test(tag)) plain += ' '.repeat(/long/i.test(tag) ? 18 : 9)
    else cues.push({ at: plain.length, tag })
  }
  return { plain, cues }
}

const captionOf = (text: string) => text.replace(/\[[^\]]*\]\s*/g, '').replace(/\s+/g, ' ').trim()

let speech: { script: Script; startedAt: number } | undefined
let caption = ''
let speaker: string | undefined
let captionBy: string | undefined
/** Who sits beside the host: the last of the others to speak. */
let contact: string | undefined
let level = 0
let tick = 0
let faceTimer: Timer | undefined
let band: { requestId: string; columns: number; rows: number } | undefined
let want: { columns: number; maxRows: number } | undefined
let lastFrame: { mode: string; columns: number; rows: number; cells: string } | undefined

/** The speech under way at `now`: the tags so far and whether a sound is voiced. */
const speechAt = (now: number) => {
  if (!speech) return undefined
  const { script } = speech
  const at = Math.min(script.plain.length - 1, Math.floor(((now - speech.startedAt) / 1000) * CHARS_PER_SECOND))
  return {
    tags: script.cues.filter(cue => cue.at <= at).map(cue => cue.tag),
    isVoiced: at >= 0 && /[\p{L}\p{N}]/u.test(script.plain[at] ?? ' '),
  }
}

/** One portrait's animation: blinks, idle looks, talking frames. */
type Actor = {
  blinkUntil: number
  nextBlinkAt: number
  idle?: { frame: string; until: number }
  nextIdleAt: number
  talkFrame: string
}
const actors = new Map<string, Actor>()
const actorOf = (who: string) => {
  let actor = actors.get(who)
  if (!actor) {
    actor = { blinkUntil: 0, nextBlinkAt: 0, nextIdleAt: 0, talkFrame: 'neutral' }
    actors.set(who, actor)
  }
  return actor
}

/** This tick's frame for one portrait. */
const actorFrame = (mode: Mode, who: string, now: number, said: ReturnType<typeof speechAt>) => {
  const actor = actorOf(who)
  const member = mode.call!.cast[who]
  if (actor.nextBlinkAt === 0) actor.nextBlinkAt = now + 1000 + Math.random() * 3000
  if (now >= actor.nextBlinkAt) {
    actor.blinkUntil = now + 270
    actor.nextBlinkAt = now + 2500 + Math.random() * 4500
  }
  const blink = actor.blinkUntil > now ? 'blink' : undefined
  if (speaker === who && said) {
    actor.idle = undefined
    actor.nextIdleAt = now + 2000
    if (tick % 2 === 0) {
      const accent = member?.accent
      const isAccented = accent !== undefined && said.tags.some(tag => new RegExp(accent.when, 'i').test(tag))
      const open = isAccented && Math.random() < 0.35 ? accent!.frame : pick(['talk_a', 'talk_b', 'talk_b'])
      actor.talkFrame = said.isVoiced ? pick([open, open, open, 'neutral']) : 'neutral'
    }
    return blink && actor.talkFrame === 'neutral' ? blink : actor.talkFrame
  }
  if (blink) return blink
  if (actor.idle && now >= actor.idle.until) actor.idle = undefined
  const choices = member?.idle ?? []
  if (!actor.idle && now >= actor.nextIdleAt && choices.length) {
    let r = Math.random() * choices.reduce((n, c) => n + c.weight, 0)
    const choice = choices.find(c => (r -= c.weight) <= 0) ?? choices[0]!
    actor.idle = { frame: choice.frame, until: now + choice.ms[0] + Math.random() * (choice.ms[1] - choice.ms[0]) }
    actor.nextIdleAt = actor.idle.until + 1500 + Math.random() * 4000
  }
  return actor.idle?.frame ?? 'neutral'
}

const shownMode = () => (lastShown ? modes.get(lastShown) : undefined)
/** The mode the band draws, mirrored from `bandMode` for the timer. */
let lastShown: string | false = false

const othersOf = (mode: Mode) => Object.keys(mode.call!.cast).filter(who => who !== mode.call!.host)

const rowsWanted = () => {
  const mode = shownMode()
  if (!mode?.theme || !want) return undefined
  const rowsFor = mode.theme.layout === 'solo' ? soloRowsFor : courtRowsFor
  return rowsFor(mode.theme, want.maxRows, want.columns, PREFER_ROWS)
}

/** A fresh frame at the size last measured, or undefined when the band does not fit. */
const nextFrame = async ($: Engine) => {
  const mode = shownMode()
  const rows = rowsWanted()
  if (!mode?.theme || !want || !rows) return undefined
  const now = await $.clock.now()
  const said = speechAt(now)
  tick += 1
  level += ((said?.isVoiced ? 0.55 + Math.random() * 0.45 : said ? 0.15 : 0) - level) * 0.5
  const others = othersOf(mode)
  const beside = contact && others.includes(contact) ? contact : (others[0] ?? mode.call!.host)
  const inCast = (who: string | undefined) => (who && mode.call!.cast[who] ? who : undefined)
  const cellsFor = mode.theme.layout === 'codec' ? codecCells : mode.theme.layout === 'solo' ? soloCells : courtCells
  const cells = cellsFor(mode.theme, want.columns, rows, {
    speaker: inCast(speaker),
    contact: beside,
    faces: { host: actorFrame(mode, mode.call!.host, now, said), contact: actorFrame(mode, beside, now, said) },
    level,
    caption,
    captionBy: inCast(captionBy),
  })
  lastFrame = { mode: mode.name, columns: want.columns, rows, cells }
  return lastFrame
}

/**
 * The frame a redraw shows: the last one if it still fits, else a fresh one.
 * Only the timer moves the animation; the engine redraws the band far more often.
 */
const currentFrame = async ($: Engine) => {
  const fits = lastFrame && lastFrame.mode === lastShown && lastFrame.columns === want?.columns && lastFrame.rows === rowsWanted()
  return fits ? lastFrame : nextFrame($)
}

const tickBand = async ($: Engine) => {
  if (!band) return
  const shown = lastFrame?.cells
  const frame = await nextFrame($)
  if (!frame) return
  if (band.columns !== frame.columns || band.rows !== frame.rows) {
    $.ui.invalidate('ui.render')
    return
  }
  if (frame.cells === shown) return
  const blit = await $.ui.blit({ requestId: band.requestId, key: BAND_KEY, cells: frame.cells })
  if (blit.deny !== undefined) $.ui.invalidate('ui.render')
}

/** Shows the mode's band, or hides it for a mode without one. */
const showBand = async ($: Engine, mode: Mode | undefined) => {
  const name = mode?.theme ? mode.name : false
  lastShown = name
  lastFrame = undefined
  contact = undefined
  await update($, bandMode, () => name)
  if (!name) {
    faceTimer?.cancel()
    faceTimer = undefined
    band = undefined
    return
  }
  faceTimer ??= $.clock.every(TICK_MS, () => {
    void tickBand($).catch(() => {})
  })
}

const faceSpeaks = async ($: Engine, text: string, who: string | undefined, delayMs: number) => {
  caption = captionOf(text)
  speaker = who
  captionBy = who
  const mode = shownMode()
  if (mode && who && othersOf(mode).includes(who)) contact = who
  // The first audio arrives a moment after the request goes out.
  speech = { script: scriptOf(text), startedAt: (await $.clock.now()) + 450 + delayMs }
}

const clearCaption = () => {
  caption = ''
  captionBy = undefined
}

// ── Speech: ElevenLabs through the mode's effects to the speakers ──

/** A value in a curl config file's double quotes. */
const curlQuoted = (text: string) =>
  `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`

/** The curl config for one line: handed over stdin, so the key stays out of argv and the environment. */
const curlConfig = (key: string, voice: string, model: string, text: string) =>
  [
    `url = ${curlQuoted(`${API}/v1/text-to-speech/${voice}/stream?output_format=pcm_22050`)}`,
    'request = "POST"',
    `header = ${curlQuoted(`xi-api-key: ${key}`)}`,
    'header = "Content-Type: application/json"',
    `data-binary = ${curlQuoted(JSON.stringify({ text: hasTags(model) ? text : stripTags(text), model_id: model }))}`,
    '',
  ].join('\n')

/** What went wrong, in words the person can act on. */
const explain = (stderr: string, voice: string) => {
  const status = stderr.match(/returned error: (\d{3})/)?.[1]
  if (status === '401') return 'ElevenLabs rejected the API key (401): check it, or that it has text-to-speech access.'
  if (status === '402') return 'ElevenLabs says the account is out of credits (402).'
  if (status === '404' || status === '400') return `ElevenLabs could not use voice ${voice} (${status}): it may need adding to your voice library.`
  if (status === '429') return 'ElevenLabs is rate limiting this key (429): too many requests at once.'
  if (status) return `ElevenLabs answered HTTP ${status}.`
  if (/ffmpeg|ffplay/.test(stderr) && /not found|not recognized|No such file/i.test(stderr)) {
    return 'ffmpeg was not found: install it (brew install ffmpeg, winget install Gyan.FFmpeg, or your package manager) or set its path in the plugin options.'
  }
  return stderr.trim().split('\n').pop() ?? 'playback failed'
}

let generation = 0
let playing: AsyncGenerator<unknown, unknown> | undefined

const stop = async () => {
  generation++
  clearCaption()
  speaker = undefined
  const was = playing
  playing = undefined
  await was?.return(undefined)
}

type Line = { voice: string; filter?: string; ring?: string; ringMs?: number; speaker?: string }

/** Speaks one line and resolves when it has played; the error in words, if any. */
type Played = { error?: string; isVoiceRejected?: boolean }

const playLine = async ($: Engine, text: string, mine: number, line: Line): Promise<Played> => {
  if (mine !== generation) return {}
  const key = await apiKey($)
  if (!key) return { error: 'No ElevenLabs API key: set one in the plugin options (/plugin, Avatars, configure) or ELEVENLABS_API_KEY.' }
  if (!line.voice) return { error: 'No voice set: pick one with /avatar voice or in the /avatar menu.' }
  const binDir = `${$.plugin.root}/bin`
  const child = $.process.spawn({
    argv: isWindows ? ['cmd.exe', '/d', '/c', 'speak.cmd'] : ['bash', `${binDir}/speak.sh`],
    cwd: binDir,
    // Unset rather than empty: cmd's `if defined` counts an empty variable as set.
    env: Object.fromEntries(
      Object.entries({ AVATAR_FILTER: line.filter, AVATAR_RING: line.ring, AVATAR_FFMPEG: option('ffmpeg') }).filter(
        (entry): entry is [string, string] => Boolean(entry[1]),
      ),
    ),
    input: curlConfig(key, line.voice, await modelOf($), text),
  })
  playing = child
  // The ring plays first: the band waits it out before the lips move.
  if (lastShown) await faceSpeaks($, text, line.speaker, line.ring ? (line.ringMs ?? 0) : 0)

  let stderr = ''
  try {
    for await (const { stream, text: piece } of child) {
      if (stream === 'stderr') stderr += piece
    }
  } finally {
    if (playing === child) {
      playing = undefined
      speech = undefined
      if (!line.speaker) clearCaption()
    }
  }
  if (mine !== generation || !stderr.trim()) return {}
  return { error: explain(stderr, line.voice), isVoiceRejected: /returned error: 40[04]/.test(stderr) }
}

/** The mode's filter with a pitch shift in front; speed is kept. */
const pitched = (filter: string | undefined, pitch: number | undefined) => {
  if (!pitch || pitch === 1 || !(pitch > 0.5 && pitch < 2)) return filter
  const shift = `asetrate=22050*${pitch},aresample=22050,atempo=${(1 / pitch).toFixed(4)}`
  if (!filter) return shift
  const input = filter.match(/^\s*\[0(?::a)?\]/)?.[0] ?? ''
  return `${input}${shift},${filter.slice(input.length)}`
}

const added = new Set<string>()

/**
 * Adds a public library voice to the person's ElevenLabs library, which some
 * accounts need before the voice can be used; once per voice per session.
 */
const addLibraryVoice = async ($: Engine, voice: string, owner: string | undefined, name: string) => {
  const key = await apiKey($)
  if (!owner || !key || added.has(voice)) return false
  added.add(voice)
  const r = await $.http.fetch(`${API}/v1/voices/add/${owner}/${voice}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_name: name }),
  })
  return r.ok
}

/** Plays a line; a rejected library voice is added to the person's library and tried once more. */
const playVoiced = async ($: Engine, text: string, mine: number, line: Line, owner: string | undefined, name: string) => {
  const played = await playLine($, text, mine, line)
  if (!played.isVoiceRejected || !(await addLibraryVoice($, line.voice, owner, name))) return played.error
  return (await playLine($, text, mine, { ...line, ring: undefined })).error
}

/** Speaks `text` in the mode: one voice, or a call's lines in turn, each in its speaker's voice. */
const perform = async ($: Engine, text: string, mine: number, mode: Mode | undefined) => {
  const filter = mode?.audio?.filter
  const effects = mode?.audio?.effects
  const ring = mode?.audio?.ring
  if (!mode?.call) {
    const voice = await voiceOf($, mode)
    const owner = voice === mode?.voice ? mode?.voiceOwner : undefined
    const error = await playVoiced($, text, mine, { voice, filter: withEffects(effects, text, filter) }, owner, `${mode?.title ?? 'Avatars'} narrator`)
    if (error) $.ui.toast(`avatars: ${error}`)
    return
  }
  const lines = parseCall(mode, text)
  // The band shows who is calling before they speak.
  const caller = lines.find(line => line.speaker !== mode.call!.host)?.speaker
  if (caller) contact = caller
  for (const [i, line] of lines.entries()) {
    if (mine !== generation) return
    const member = mode.call.cast[line.speaker]!
    const error = await playVoiced(
      $,
      line.text,
      mine,
      {
        voice: member.voice,
        filter: withEffects(effects, line.text, pitched(filter, member.pitch)),
        speaker: line.speaker,
        ...(i === 0 && ring ? { ring: `${mode.dir}/${ring.file}`, ringMs: ring.ms } : {}),
      },
      member.libraryOwner,
      `${mode.title}: ${member.name}`,
    )
    if (error) {
      $.ui.toast(`avatars: ${error}`)
      break
    }
    if (i < lines.length - 1) await $.clock.sleep(250)
  }
  if (mine === generation) {
    speaker = undefined
    clearCaption()
  }
}

const say = async ($: Engine, text: string, mode?: Mode) => {
  await stop()
  await perform($, text, generation, mode ?? (await modeOf($)))
}

const speakReply = async ($: Engine, answer: string) => {
  await stop()
  const mine = generation
  const mode = await modeOf($)
  if (!mode) return
  const reply = answer.slice(0, MAX_REPLY_CHARS)
  const r = await $.model.complete({
    model: 'sonnet',
    system: systemFor(await modelOf($), mode),
    prompt: `${mode.call ? `${planCall(mode, reply.length)}\n\n` : ''}<reply>\n${reply}\n</reply>`,
    maxTokens: 1200,
    effort: 'low',
  })
  if (mine !== generation) return
  if (!r.isAnswered) {
    $.ui.toast(`avatars: Sonnet gave no speech (${r.reason})`)
    return
  }
  const text = r.text.trim()
  await update($, lastSaid, () => text)
  await perform($, text, mine, mode)
}

const background = ($: Engine, work: Promise<void>) => {
  void work.catch(err => $.ui.toast(`avatars: ${String(err)}`))
}

// ── Actions shared by the commands and the menu ──

const setMode = async ($: Engine, name: string) => {
  if (name === 'off') {
    await update($, modeSetting, () => 'off')
    await stop()
    await showBand($, undefined)
    return 'Avatars are off for this session.'
  }
  const mode = modes.get(name)
  if (!mode) return `No mode named ${name}. Modes: ${[...modes.keys()].join(', ')}.`
  await update($, modeSetting, () => name)
  await showBand($, mode)
  background($, say($, mode.sample.join('\n'), mode))
  return `Mode set to ${mode.title}.`
}

const setEnabled = async ($: Engine, isOn: boolean) => {
  await update($, enabledSetting, () => (isOn ? 'on' : 'off'))
  if (!isOn) await stop()
  return isOn ? 'Spoken replies are on for this session.' : 'Spoken replies are off for this session.'
}

const setVoice = async ($: Engine, voice: string) => {
  await update($, voiceSetting, () => voice)
  const mode = await modeOf($)
  if (mode?.call) return `Voice set to ${voice}. It is used by single-voice modes; ${mode.title} has its own cast.`
  background($, say($, 'Hello. This is the voice I will use for my replies from now on.'))
  return `Voice set to ${voice}.`
}

const setModel = async ($: Engine, model: string) => {
  if (!/^eleven_[a-z0-9_]+$/.test(model)) return `Not an ElevenLabs model id: ${model || '(none)'}. Try ${MODELS.join(', ')}.`
  await update($, modelSetting, () => model)
  background($, say($, hasTags(model) ? '[warmly] Switched models. [pause] This is how I sound now.' : 'Switched models. This is how I sound now.'))
  return `Model set to ${model}${hasTags(model) ? ' (audio tags on)' : ''}.`
}

/** Gives a character of the current mode the person's own voice, kept in voices.json. */
const recast = async ($: Engine, who: string, voiceArg: string) => {
  const mode = await modeOf($)
  if (!mode) return 'Pick a mode first.'
  if (!voicesFile) return 'No home folder to keep voices.json in.'
  const members = mode.call ? Object.keys(mode.call.cast) : ['voice']
  const member = members.find(m => m === who.toLowerCase())
  if (!member) return `${mode.title} has no ${who}. Characters: ${members.join(', ')}.`
  const voice = voiceArg ? parseVoice(voiceArg) : undefined
  if (voiceArg && !voice) return `Not a voice id or URL: ${voiceArg}`
  const mine = { ...(personal[mode.name] ?? {}) }
  if (voice) mine[member] = voice
  else delete mine[member]
  const next = { ...personal, [mode.name]: mine }
  if (!Object.keys(mine).length) delete next[mode.name]
  await $.fs.write(voicesFile, `${JSON.stringify(next, null, 2)}\n`)
  await reloadModes($)
  return voice
    ? `${member} in ${mode.title} now speaks with ${voice} (kept in ${voicesFile}).`
    : `${member} in ${mode.title} is back to the mode's own voice.`
}

const playDemo = async ($: Engine, arg: string) => {
  const mode = await modeOf($)
  if (!mode) return 'Avatars are off for this session: pick a mode first.'
  const demos = mode.demos.length ? mode.demos : [mode.sample]
  const n = Number(arg)
  const chosen = !arg ? pick(demos) : Number.isInteger(n) ? demos[n - 1] : demos.find(demo => demoHas(mode, demo, arg))
  if (!chosen) return `No ${mode.title} demo matches ${arg} (there are ${demos.length}; or name a speaker).`
  background($, say($, chosen.join('\n'), mode))
  return `Playing a ${mode.title} demo${arg ? ` (${arg})` : ''}.`
}

const playScenario = async ($: Engine, name: string) => {
  const all = [...modes.values()].flatMap(mode => Object.entries(mode.scenarios ?? {}).map(([key, s]) => ({ key, mode, ...s })))
  const scenario = all.find(s => s.key === name)
  if (!scenario) return `${name ? `No scenario ${name}. ` : ''}Scenarios: ${all.map(s => `${s.key} (${s.mode.title}: ${s.title})`).join(', ') || 'none'}.`
  if ((await modeOf($))?.name !== scenario.mode.name) {
    await update($, modeSetting, () => scenario.mode.name)
    await showBand($, scenario.mode)
  }
  background($, say($, scenario.script.join('\n'), scenario.mode))
  return `Playing ${scenario.title} (${scenario.script.length} lines; /avatar stop ends it).`
}

/** Saves this session's setup as the plugin's defaults for new sessions. */
const saveDefaults = async ($: Engine) => {
  const mode = await modeOf($)
  const values: Array<[string, string | boolean]> = [
    ['mode', mode?.name ?? 'off'],
    ['model', await modelOf($)],
    ['speak', await isEnabled($)],
  ]
  const voice = await read($, voiceSetting)
  if (voice) values.push(['voice', voice])
  const refused: string[] = []
  for (const [field, value] of values) {
    const { deny } = await $.config.set({ key: `avatars.${field}`, value })
    if (deny !== undefined) refused.push(`${field} (${deny})`)
  }
  return refused.length ? `Could not save: ${refused.join(', ')}.` : `New sessions will start with ${mode?.title ?? 'avatars off'}.`
}

const fetchJson = async ($: Engine, path: string) => {
  const key = await apiKey($)
  if (!key) throw new Error('No ElevenLabs API key: set one in the plugin options or ELEVENLABS_API_KEY.')
  const r = await $.http.fetch(`${API}${path}`, { headers: { 'xi-api-key': key } })
  if (!r.ok) throw new Error(`ElevenLabs answered HTTP ${r.status} for ${path.split('?')[0]}: ${r.text.slice(0, 200)}`)
  return JSON.parse(r.text) as Record<string, unknown>
}

type ApiVoice = { voice_id: string; name: string; labels?: Record<string, string>; category?: string; description?: string }

const refreshLibrary = async ($: Engine) => {
  try {
    const body = await fetchJson($, '/v1/voices')
    const voices = ((body.voices as ApiVoice[] | undefined) ?? []).map(v => ({ id: v.voice_id, name: v.name }))
    await update($, libraryVoices, () => voices)
  } catch (err) {
    await update($, menuNote, () => String(err instanceof Error ? err.message : err))
  }
}

/** Plain checks of the setup: key, ffmpeg, a player, and whether the key can use each mode's voices. */
const doctor = async ($: Engine) => {
  const out: string[] = []
  const key = await apiKey($)
  out.push(key ? `API key: set (${option('api_key') ? 'plugin options' : 'ELEVENLABS_API_KEY'}).` : 'API key: missing. Set it in the plugin options (/plugin, Avatars, configure) or export ELEVENLABS_API_KEY.')
  const ffmpeg = option('ffmpeg') ?? 'ffmpeg'
  const ran = await $.process.run([ffmpeg, '-hide_banner', '-version'], { timeoutMs: 10_000 }).catch(() => undefined)
  out.push(ran?.exitCode === 0 ? `ffmpeg: ${ran.stdout.split('\n')[0]}` : `ffmpeg: not found (${ffmpeg}). Needed for effects everywhere, and for playback on macOS and Windows.`)
  if (isWindows) {
    const ffplay = await $.process.run(['ffplay', '-hide_banner', '-version'], { timeoutMs: 10_000 }).catch(() => undefined)
    out.push(ffplay?.exitCode === 0 ? 'ffplay: found.' : 'ffplay: not found. It ships with the usual ffmpeg builds (winget install Gyan.FFmpeg).')
  }
  const recastCount = Object.values(personal).reduce((n, voices) => n + Object.keys(voices).length, 0)
  if (recastCount) out.push(`Your own voices: ${recastCount} character(s), from ${voicesFile}.`)
  if (modeErrors.length) out.push(`Modes that did not load: ${modeErrors.join(' | ')}`)
  if (key) {
    for (const mode of modes.values()) {
      const voices = mode.call ? Object.entries(mode.call.cast).map(([who, m]) => [who, m.voice] as const) : [['voice', await voiceOf($, mode)] as const]
      const missing: string[] = []
      for (const [who, voice] of voices) {
        const r = await $.http.fetch(`${API}/v1/voices/${voice}`, { headers: { 'xi-api-key': key } })
        if (!r.ok) missing.push(`${who} (${voice}: HTTP ${r.status})`)
      }
      out.push(missing.length ? `${mode.title}: voices this key cannot use: ${missing.join(', ')}.` : `${mode.title}: all voices reachable.`)
    }
  }
  return out.join('\n')
}

const USAGE = [
  '/avatar                  open the menu',
  '/avatar mode <name|off>  switch mode for this session',
  '/avatar modes            list modes',
  '/avatar on | off         spoken replies on or off',
  '/avatar test [n|name]    play a demo of the mode',
  '/avatar replay | stop',
  '/avatar voice <id|url>   the voice for single-voice modes',
  '/avatar recast <who> [id] your own voice for a character (no id: back to the default)',
  '/avatar model <id>       the ElevenLabs model',
  '/avatar scenario [name]  play a scripted call',
  '/avatar default          save this session as the default',
  '/avatar doctor           check the key, ffmpeg and voices',
  '/avatar reload           read the mode folders again',
].join('\n')

const modeList = () =>
  [...modes.values()].map(mode => `${mode.name}: ${mode.title}. ${mode.description}`).join('\n') +
  (modeErrors.length ? `\nNot loaded: ${modeErrors.join(' | ')}` : '') +
  `\nYour own modes go in ${userModesDir} (the create-mode skill walks you through one).`

// ── Tools for the create-mode skill: they use the person's key without showing it ──

const TOOLS = {
  search: 'search_voices',
  mine: 'my_voices',
  audition: 'audition',
  check: 'check_mode',
  paths: 'paths',
} as const

const voiceLine = (v: ApiVoice & { accent?: string; gender?: string; age?: string; use_case?: string; descriptive?: string; language?: string }) => {
  const traits = [v.gender ?? v.labels?.gender, v.age ?? v.labels?.age, v.accent ?? v.labels?.accent, v.language, v.descriptive ?? v.labels?.descriptive, v.use_case ?? v.labels?.use_case]
    .filter(Boolean)
    .join(', ')
  const owner = (v as { public_owner_id?: string }).public_owner_id
  return `- ${v.name} (${v.voice_id}${owner ? `, library owner ${owner}` : ''})${traits ? `: ${traits}` : ''}${v.description ? `. ${v.description.slice(0, 160)}` : ''}`
}

const answer = (text: string, isError = false) => ({ result: text, ...(isError ? { isError: true as const } : {}) })

export const register: Register = (on, opts) => {
  options = opts

  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    await reloadModes($)
    if (isInteractive) await showBand($, await modeOf($))
    await $.command.register({
      name: 'avatar',
      description: 'Spoken replies with an avatar: opens the menu, or mode, on, off, test, stop, doctor and more',
      argumentHint: '[mode <name>|on|off|test|replay|stop|voice <id>|model <id>|scenario|default|doctor|modes|reload|help]',
      immediate: true,
    })
    await $.tool.register({
      name: TOOLS.search,
      description:
        "Searches the ElevenLabs shared voice library with the user's own API key, for picking voices for an avatars mode. Returns names, voice ids and traits.",
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text search, e.g. "gravelly old pirate" or "french aristocrat woman"' },
          gender: { type: 'string', enum: ['male', 'female', 'neutral'] },
          age: { type: 'string', enum: ['young', 'middle_aged', 'old'] },
          accent: { type: 'string', description: 'e.g. british, american, french, indian' },
          limit: { type: 'number', description: 'How many voices, at most 30 (default 12)' },
        },
        required: ['query'],
      },
    })
    await $.tool.register({
      name: TOOLS.mine,
      description: "Lists the voices in the user's own ElevenLabs library (ones they made or added), with ids.",
    })
    await $.tool.register({
      name: TOOLS.audition,
      description:
        'Speaks a line aloud in an ElevenLabs voice so the user can judge it, optionally through an avatars mode\'s audio effects. Use it to audition voices and tags while designing a mode. Returns when playback ends.',
      inputSchema: {
        type: 'object',
        properties: {
          voice: { type: 'string', description: 'The voice id' },
          text: { type: 'string', description: 'The line, with [audio tags] if the model is v3/v4' },
          model: { type: 'string', description: `An ElevenLabs model id (default: the session's, e.g. ${DEFAULT_MODEL})` },
          mode: { type: 'string', description: 'A loaded mode whose audio filter to apply' },
          filter: { type: 'string', description: 'An ffmpeg -filter_complex graph to try instead of a mode\'s' },
          pitch: { type: 'number', description: 'Shift the pitch, keeping speed: 0.95 is 5% lower' },
        },
        required: ['voice', 'text'],
      },
    })
    await $.tool.register({
      name: TOOLS.paths,
      description:
        "Where the avatars plugin keeps things: the user's modes folder (where new modes go), the built-in example modes, the format reference, and the portrait bake script.",
    })
    await $.tool.register({
      name: TOOLS.check,
      description:
        'Checks an avatars mode folder (mode.json, portraits.json, ring sound) and whether the user\'s key can use every voice in it, then reloads the modes so a good one can be switched to with /avatar mode <name>.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'The mode folder, absolute' } },
        required: ['path'],
      },
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await ensureLoaded($)
    const isMainAnswer = e.agentId === undefined && e.reason === 'answer' && e.answer.trim() !== ''
    if (isInteractive && isMainAnswer && (await isEnabled($)) && (await modeOf($))) {
      background($, speakReply($, e.answer))
    }

    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { Raster } = $.ui.resolve(e)
    const shown = await read($, bandMode)
    if (!shown || e.props.hasSurvey || e.surface !== 'terminal' || !Raster) {
      band = undefined
      return next(e)
    }
    lastShown = shown
    want = { columns: Math.min(512, e.props.bodyColumns), maxRows: e.props.maxRows }
    const frame = await currentFrame($)
    if (!frame) {
      band = undefined
      return next(e)
    }
    band = { requestId: e.requestId, columns: want.columns, rows: frame.rows }

    return <Raster key={BAND_KEY} columns={want.columns} rows={frame.rows} cells={frame.cells} />
  })

  on('ui.render', { component: 'Pane', requestId: MENU }, async ($, e) => {
    const { Box, Text, Button, Select } = $.ui.resolve(e)
    const mode = await modeOf($)
    const isOn = await isEnabled($)
    const model = await modelOf($)
    const voice = await voiceOf($, mode)
    const voices = await read($, libraryVoices)
    const note = await read($, menuNote)
    const hasKey = (await apiKey($)) !== undefined
    const scenarios = [...modes.values()].flatMap(m => Object.entries(m.scenarios ?? {}).map(([key, s]) => ({ key, title: `${m.title}: ${s.title}` })))
    const act = (work: () => Promise<string>) => () => {
      void work().then(text => update($, menuNote, () => text)).catch(err => update($, menuNote, () => String(err)))
    }

    const voiceOptions = [
      ...(mode?.voice ? [{ value: mode.voice, label: `${mode.title} default` }] : []),
      ...(voices ?? []).filter(v => v.id !== mode?.voice).map(v => ({ value: v.id, label: v.name })),
    ]
    if (voice && !voiceOptions.some(o => o.value === voice)) voiceOptions.unshift({ value: voice, label: voice })

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text>
            Spoken replies: <Text bold>{isOn ? 'on' : 'off'}</Text>
            {'   '}API key: {hasKey ? <Text color="green">set</Text> : <Text color="red">missing</Text>}
          </Text>
          {!hasKey && <Text dimColor>Set it with /plugin (Avatars, configure), or export ELEVENLABS_API_KEY and restart.</Text>}
        </Box>
        <Box flexDirection="column">
          <Select
            key="mode"
            label="Mode  "
            autoFocus
            value={mode?.name ?? 'off'}
            options={[...[...modes.values()].map(m => ({ value: m.name, label: m.title })), { value: 'off', label: 'Off' }]}
            onSelect={value => act(() => setMode($, value))()}
          />
          {mode && <Text dimColor>{mode.description}</Text>}
        </Box>
        {mode && !mode.call && voiceOptions.length > 0 && (
          <Select key="voice" label="Voice " value={voice} options={voiceOptions} onSelect={value => act(() => setVoice($, value))()} />
        )}
        {mode && !mode.call && voices === null && hasKey && (
          <Button key="load-voices" dimColor onPress={() => void refreshLibrary($)}>
            Load my ElevenLabs voices
          </Button>
        )}
        <Select
          key="model"
          label="Model "
          value={model}
          options={[...new Set([model, ...MODELS])].map(m => ({ value: m, label: `${m}${hasTags(m) ? ' (audio tags)' : ''}` }))}
          onSelect={value => act(() => setModel($, value))()}
        />
        {scenarios.length > 0 && (
          <Select
            key="scenario"
            label="Scenario "
            value=""
            options={[{ value: '', label: 'Pick one to play' }, ...scenarios.map(s => ({ value: s.key, label: s.title }))]}
            onSelect={value => value && act(() => playScenario($, value))()}
          />
        )}
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="test" hotkey="t" variant="primary" onPress={act(() => playDemo($, ''))}>Test</Button>
          <Button key="replay" hotkey="r" onPress={act(async () => {
            const last = await read($, lastSaid)
            if (!last) return 'Nothing spoken yet.'
            background($, say($, last))
            return 'Replaying.'
          })}>Replay</Button>
          <Button key="stop" hotkey="s" onPress={act(async () => (await stop(), 'Stopped.'))}>Stop</Button>
          <Button key="toggle" hotkey="o" onPress={act(() => setEnabled($, !isOn))}>{isOn ? 'Turn off' : 'Turn on'}</Button>
          <Button key="default" hotkey="d" onPress={act(() => saveDefaults($))}>Save as default</Button>
          <Button key="doctor" hotkey="c" onPress={act(() => doctor($))}>Check setup</Button>
          <Button key="close" role="dismiss" onPress={() => void $.ui.close({ id: MENU })}>Close</Button>
        </Box>
        {note !== '' && <Text>{note}</Text>}
        <Text dimColor>New modes: ask Claude to create one (the create-mode skill), or see {userModesDir}.</Text>
      </Box>
    )
  })

  on('command.run', { command: 'avatar' }, async ($, e) => {
    await ensureLoaded($)
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ')

    switch (verb.toLowerCase()) {
      case '':
      case 'menu': {
        await update($, menuNote, () => '')
        const opened = await $.ui.open({ id: MENU, title: 'Avatars', focus: true, closeOnEscape: true })
        if (!opened.isPlaced) return { text: `${USAGE}\n\n(${opened.reason})` }
        const mode = await modeOf($)
        if (mode && !mode.call && (await read($, libraryVoices)) === null && (await apiKey($))) void refreshLibrary($)
        return { text: 'Opened the avatars menu.' }
      }
      case 'help':
        return { text: USAGE }
      case 'modes':
        return { text: modeList() }
      case 'mode':
        return { text: arg ? await setMode($, arg.toLowerCase()) : modeList() }
      case 'on':
        return { text: await setEnabled($, true) }
      case 'off':
        return { text: await setEnabled($, false) }
      case 'stop':
        await stop()
        return { text: 'Stopped.' }
      case 'test':
        return { text: await playDemo($, arg) }
      case 'replay': {
        const last = await read($, lastSaid)
        if (!last) return { text: 'Nothing spoken yet.' }
        background($, say($, last))
        return { text: `Replaying: ${last}` }
      }
      case 'voice': {
        const id = parseVoice(arg)
        return { text: id ? await setVoice($, id) : `Not a voice id or URL: ${arg || '(none)'}` }
      }
      case 'model':
        return { text: await setModel($, arg) }
      case 'recast': {
        const [who = '', voice = ''] = rest
        return { text: who ? await recast($, who, voice) : `Usage: /avatar recast <character> [voice id or URL]` }
      }
      case 'scenario':
        return { text: await playScenario($, arg.toLowerCase()) }
      case 'default':
        return { text: await saveDefaults($) }
      case 'doctor':
        return { text: await doctor($) }
      case 'reload':
        await reloadModes($)
        await showBand($, await modeOf($))
        return { text: modeList() }
      default:
        return { text: USAGE }
    }
  })

  on('tool.call', { tool: 'mcp__avatars__search_voices' }, async ($, e) => {
    const input = e as unknown as { query: string; gender?: string; age?: string; accent?: string; limit?: number }
    const params: Array<[string, string]> = [['search', input.query], ['page_size', String(Math.min(30, input.limit ?? 12))]]
    for (const field of ['gender', 'age', 'accent'] as const) if (input[field]) params.push([field, input[field]!])
    const query = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    try {
      const body = await fetchJson($, `/v1/shared-voices?${query}`)
      const voices = (body.voices as Array<ApiVoice & { accent?: string }> | undefined) ?? []
      if (!voices.length) return answer('No voices matched; try broader words.')
      return answer(`${voices.map(voiceLine).join('\n')}\n\nAudition one with the audition tool before choosing.`)
    } catch (err) {
      return answer(String(err instanceof Error ? err.message : err), true)
    }
  })

  on('tool.call', { tool: 'mcp__avatars__my_voices' }, async $ => {
    try {
      const body = await fetchJson($, '/v1/voices')
      const voices = (body.voices as ApiVoice[] | undefined) ?? []
      return answer(voices.length ? voices.map(voiceLine).join('\n') : 'The library is empty.')
    } catch (err) {
      return answer(String(err instanceof Error ? err.message : err), true)
    }
  })

  on('tool.call', { tool: 'mcp__avatars__audition' }, async ($, e) => {
    const input = e as unknown as { voice: string; text: string; model?: string; mode?: string; filter?: string; pitch?: number }
    const voice = parseVoice(input.voice) ?? input.voice
    const mode = input.mode ? modes.get(input.mode) : undefined
    if (input.model && !/^eleven_[a-z0-9_]+$/.test(input.model)) return answer(`Not an ElevenLabs model id: ${input.model}`, true)
    await stop()
    const mine = generation
    const previous = await read($, modelSetting)
    if (input.model) await update($, modelSetting, () => input.model!)
    try {
      const filter = pitched(input.filter ?? mode?.audio?.filter, input.pitch)
      const { error } = await playLine($, input.text, mine, { voice, filter: withEffects(mode?.audio?.effects, input.text, filter) })
      return error ? answer(error, true) : answer('Played. Ask the user how it sounded.')
    } finally {
      if (input.model) await update($, modelSetting, () => previous)
    }
  })

  on('tool.call', { tool: 'mcp__avatars__paths' }, async $ => {
    await ensureLoaded($)
    const root = $.plugin.root
    return answer(
      [
        `New modes go in: ${userModesDir}/<name>/`,
        `Built-in example modes: ${root}/modes/coven (cast with portraits), ${root}/modes/prototype (solo with audio effects), ${root}/modes/narrator (single voice)`,
        `Format reference: ${root}/MODES.md`,
        `Portrait bake script: ${root}/bin/bake-portraits.py <mode folder> --preview <sheet.png> (needs Python 3 with Pillow and numpy)`,
        `Platform: ${isWindows ? 'Windows' : 'macOS or Linux'}`,
        `Loaded modes: ${[...modes.keys()].join(', ')}${modeErrors.length ? `; not loaded: ${modeErrors.join(' | ')}` : ''}`,
      ].join('\n'),
    )
  })

  on('tool.call', { tool: 'mcp__avatars__check_mode' }, async ($, e) => {
    const dir = String((e as unknown as { path: string }).path).replace(/[\\/]+$/, '')
    const name = dir.split(/[\\/]/).pop() ?? ''
    if (!isModeName(name)) return answer(`The folder name ${name} must be lowercase letters, digits, - or _: it is the mode's name.`, true)
    const mode = await readMode($, dir, name)
    if (typeof mode === 'string') return answer(mode, true)
    const notes: string[] = []
    const key = await apiKey($)
    const voices = mode.call ? Object.entries(mode.call.cast).map(([who, m]) => [who, m.voice] as const) : mode.voice ? [['voice', mode.voice] as const] : []
    for (const [who, voice] of voices) {
      if (!key) break
      const r = await $.http.fetch(`${API}/v1/voices/${voice}`, { headers: { 'xi-api-key': key } })
      if (!r.ok) notes.push(`${who}'s voice ${voice} is not usable with this key (HTTP ${r.status}); add it to the library or pick another.`)
    }
    if (mode.call && mode.band && mode.theme) {
      for (const who of Object.keys(mode.call.cast)) {
        const sizes = mode.theme.portraits[who]
        if (!sizes) notes.push(`portraits.json has no ${who}: the band shows the host's portrait in their place.`)
        else if (!sizes[20]?.frames.talk_a) notes.push(`${who} has no talk_a frame at 20 rows: their mouth will not move.`)
      }
    }
    if (mode.audio?.ring && !(await $.fs.exists(`${dir}/${mode.audio.ring.file}`))) notes.push(`The ring sound ${mode.audio.ring.file} is missing.`)
    if (!dir.startsWith(userModesDir) && !dir.startsWith(`${$.plugin.root}/modes`)) {
      notes.push(`It loads only from ${userModesDir}/${name}; move it there.`)
    }
    await reloadModes($)
    return answer(
      `${mode.title} is valid.${notes.length ? `\n${notes.map(n => `- ${n}`).join('\n')}` : ''}\nSwitch to it with /avatar mode ${name}, then /avatar test.`,
    )
  })
}
