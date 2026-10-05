// Post effects: `audio.effects` in mode.json, turned into ffmpeg filter graph
// pieces fresh for every line, so no two lines glitch alike. Effects run on
// the dry voice, before any pitch shift and the mode's `audio.filter`. Their
// timing is planned from the line's text, since the audio streams in and its
// length is not known up front.

export type Effect =
  | {
      /** Repeats a short fragment a few times, sometimes reversed: a voice catching on a word. */
      type: 'stutter'
      perSecond?: number
      repeats?: [number, number]
      ms?: [number, number]
      reverse?: number
      /** The share of stutters that speed up into the word and slow back out. */
      rush?: number
      /** A rush's top speed: 1.18 is 18% faster and higher. */
      rushRate?: number
    }
  | {
      /** A failing radio: brief cuts to static or near silence, and a little hiss under it all. */
      type: 'dropouts'
      perSecond?: number
      ms?: [number, number]
      static?: number
      hiss?: number
    }

const SAMPLE_RATE = 22050
/** Speech is about this many characters a second; a `[pause]` tag adds a beat. */
const CHARS_PER_SECOND = 15
const PAUSE_SECONDS = 0.6
/** No effect starts this close to either end of the line. */
const MARGIN = 0.3

/** About how long `text` takes to say, in seconds. */
export const spokenSeconds = (text: string) => {
  const pauses = (text.match(/\[[^\]]*pause[^\]]*\]/gi) ?? []).length
  const plain = text.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim()
  return plain.length / CHARS_PER_SECOND + pauses * PAUSE_SECONDS
}

const between = (rand: () => number, [lo, hi]: [number, number]) => lo + rand() * (hi - lo)

/** Times in (MARGIN, seconds - MARGIN) at about `perSecond`, sorted, at least `gap` apart. */
const moments = (rand: () => number, seconds: number, perSecond: number, gap: number) => {
  const span = seconds - 2 * MARGIN
  if (span <= 0 || perSecond <= 0) return []
  let count = Math.floor(span * perSecond)
  if (rand() < span * perSecond - count) count += 1
  const times = Array.from({ length: count }, () => MARGIN + rand() * span).sort((a, b) => a - b)
  return times.filter((t, i) => i === 0 || t - times[i - 1]! >= gap)
}

const fixed = (n: number) => n.toFixed(3)

/** How long each step of a rush's speed-up or slow-down lasts, in seconds, and how many steps each way. */
const RUSH_STEP = 0.12
const RUSH_STEPS = 3

/**
 * `[from]` stuttered into `[to]`: the voice cut at each moment, a fragment replayed, then on from there.
 * A rushed stutter speeds up into the fragment and slows back out, faster and higher like tape.
 */
const stutter = (e: Extract<Effect, { type: 'stutter' }>, seconds: number, rand: () => number, from: string, to: string) => {
  const ramp = RUSH_STEP * RUSH_STEPS
  const events = moments(rand, seconds, e.perSecond ?? 0.5, 2 * ramp + 0.2).map(at => ({
    at,
    length: between(rand, e.ms ?? [50, 110]) / 1000,
    times: Math.round(between(rand, e.repeats ?? [1, 3])),
    isReversed: rand() < (e.reverse ?? 0.2),
    isRushed: rand() < (e.rush ?? 0.5),
  }))
  if (!events.length) return undefined
  const peak = e.rushRate ?? 1.18
  const rate = (step: number) => 1 + ((peak - 1) * step) / RUSH_STEPS
  const pieces: Array<{ start: number; end?: number; rate: number; isReversed?: boolean }> = []
  let start = 0
  for (const event of events) {
    const rampIn = event.isRushed ? Math.min(ramp, event.at - start) : 0
    pieces.push({ start, end: event.at - rampIn, rate: 1 })
    if (rampIn > 0) {
      for (let step = 1; step <= RUSH_STEPS; step++) {
        const stepStart = event.at - rampIn + ((step - 1) * rampIn) / RUSH_STEPS
        pieces.push({ start: stepStart, end: stepStart + rampIn / RUSH_STEPS, rate: rate(step) })
      }
    }
    for (let i = 0; i < event.times; i++) {
      pieces.push({ start: event.at, end: event.at + event.length, rate: event.isRushed ? peak : 1, isReversed: event.isReversed })
    }
    start = event.at
    if (event.isRushed) {
      for (let step = RUSH_STEPS; step >= 1; step--) {
        pieces.push({ start, end: start + RUSH_STEP, rate: rate(step) })
        start += RUSH_STEP
      }
    }
  }
  pieces.push({ start, rate: 1 })
  const labels = pieces.map((_, i) => `[${to}_${i}]`)
  const chain = (p: (typeof pieces)[number]) =>
    [
      `atrim=start=${fixed(p.start)}${p.end === undefined ? '' : `:end=${fixed(p.end)}`}`,
      ...(p.isReversed ? ['areverse'] : []),
      'asetpts=PTS-STARTPTS',
      ...(p.rate === 1 ? [] : [`asetrate=${SAMPLE_RATE}*${p.rate.toFixed(4)}`, `aresample=${SAMPLE_RATE}`]),
    ].join(',')
  return [
    `${from}asplit=${pieces.length}${labels.join('')}`,
    ...pieces.map((piece, i) => `${labels[i]}${chain(piece)}[${to}_p${i}]`),
    `${pieces.map((_, i) => `[${to}_p${i}]`).join('')}concat=n=${pieces.length}:v=0:a=1[${to}]`,
  ].join(';')
}

/** `[from]` with radio dropouts into `[to]`. */
const dropouts = (e: Extract<Effect, { type: 'dropouts' }>, seconds: number, rand: () => number, from: string, to: string) => {
  const cuts = moments(rand, seconds, e.perSecond ?? 0.8, 0.2).map(at => ({
    at,
    end: at + between(rand, e.ms ?? [30, 140]) / 1000,
    isStatic: rand() < (e.static ?? 0.6),
  }))
  const during = (list: typeof cuts) => list.map(c => `between(t,${fixed(c.at)},${fixed(c.end)})`).join('+') || '0'
  const hiss = e.hiss ?? 0.004
  return [
    `${from}volume='if(${during(cuts)},0.08,1)':eval=frame[${to}_v]`,
    `anoisesrc=r=${SAMPLE_RATE}:c=white:a=0.09,volume='if(${during(cuts.filter(c => c.isStatic))},1,${hiss / 0.09})':eval=frame[${to}_n]`,
    `[${to}_v][${to}_n]amix=inputs=2:normalize=0:duration=first[${to}]`,
  ].join(';')
}

/**
 * `filter` (and any pitch chain in front of it) with the effects ahead of it, for one line of `text`.
 * A filter may name its input `[0]` or leave it unnamed; both read the effects' output.
 */
export const withEffects = (effects: Effect[] | undefined, text: string, filter: string | undefined, rand: () => number = Math.random) => {
  if (!effects?.length) return filter
  const seconds = spokenSeconds(text)
  const graphs: string[] = []
  let from = '[0]'
  effects.forEach((effect, i) => {
    const to = `fx${i}`
    const graph = effect.type === 'stutter' ? stutter(effect, seconds, rand, from, to) : effect.type === 'dropouts' ? dropouts(effect, seconds, rand, from, to) : undefined
    if (!graph) return
    graphs.push(graph)
    from = `[${to}]`
  })
  if (!graphs.length) return filter
  const body = (filter ?? 'anull').replace(/^\s*\[0(?::a)?\]/, '')
  return `${graphs.join(';')};${from}${body}`
}
