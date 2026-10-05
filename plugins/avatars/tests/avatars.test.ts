import type { Engine, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const KEY = 'sk_test_key'

/** A blank portrait: `rows` tall, square, one frame per name. */
const portrait = (rows: number, frames: string[]) => {
  const size = rows * 2
  const blank = 'AAAA'.repeat((size * size * 3) / 3)
  return { w: size, h: size, frames: Object.fromEntries(frames.map(f => [f, blank])) }
}

const DUO = {
  title: 'The Duo',
  description: 'A boss and a helper.',
  call: {
    premise: 'A boss hears a report from a helper.',
    host: 'boss',
    fallback: 'helper',
    cast: {
      boss: { name: 'BOSS', aliases: ['chief'], voice: 'BossVoice00000000000', ink: '#ff0000', persona: 'Loud.', speaksAbout: 'Orders.', idle: [{ frame: 'neutral', weight: 1, ms: [500, 900] }] },
      helper: { name: 'HELPER', voice: 'HelperVoice000000000', libraryOwner: 'owner7', persona: 'Quick.', speaksAbout: 'The work.' },
    },
    turns: 'They trade lines.',
    kinds: [{ weight: 1, text: 'A report.', note: 'Nobody else speaks.' }],
  },
  band: {
    title: 'T H E   D U O',
    frame: '#333333',
    frameLit: '#999999',
    corner: '#cccccc',
    subtitle: '#ffffff',
    meter: { label: 'VOLUME', glyph: '*', lit: '#ffffff', dim: '#222222' },
  },
  audio: { filter: 'volume=2dB', ring: { file: 'ring.pcm', ms: 500 } },
  sample: ['BOSS: [loud] Report!', 'HELPER: [quick] All done, chief.'],
  demos: [['BOSS: Well?', 'HELPER: Green.'], ['HELPER: Faster now.', 'BOSS: Good.']],
  scenarios: { long: { title: 'A long one', script: ['BOSS: One.', 'HELPER: Two.', 'BOSS: Three.'] } },
}

const NARRATOR = {
  title: 'Narrator',
  description: 'One voice.',
  voice: 'NarratorVoice0000000',
  sample: ['Hello.'],
  demos: [['[pleased] The build passed.']],
}

const PORTRAITS = { boss: { 20: portrait(20, ['neutral', 'blink', 'talk_a', 'talk_b']) }, helper: { 20: portrait(20, ['neutral', 'blink', 'talk_a', 'talk_b']) } }

/** Stands in for the engine: a small filesystem of modes, a store, silent playback. */
const engine = (on: On, files: Record<string, string> = {}) => {
  const fs: Record<string, string> = {
    '/plugin/modes/duo/mode.json': JSON.stringify(DUO),
    '/plugin/modes/duo/portraits.json': JSON.stringify(PORTRAITS),
    '/plugin/modes/duo/ring.pcm': '',
    '/plugin/modes/narrator/mode.json': JSON.stringify(NARRATOR),
    ...files,
  }
  mock.env(on, { HOME: '/home/me' })
  const spawned: Array<{ argv: readonly string[]; env: Record<string, string>; input: string }> = []
  const toasts: string[] = []
  const configSets: Array<{ key: string; value: unknown }> = []
  const relative = (path: string) =>
    path.includes('/.claude/avatars/') ? path.replace(/^.*\/\.claude\/avatars\//, '/home/') : path.replace(/^.*?\/modes(?=\/|$)/, '/plugin/modes')
  const isDir = (path: string) => Object.keys(fs).some(f => f.startsWith(`${relative(path)}/`))
  on('fs.exists', async (_$, e) => ({ value: relative(e.path) in fs || isDir(e.path) }) as never)
  on('fs.write', async (_$, e) => {
    fs[relative(e.path)] = e.text
    return { value: undefined } as never
  })
  on('fs.read', async (_$, e) => {
    const text = fs[relative(e.path)]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text } as never
  })
  on('fs.list', async (_$, e) => {
    const base = relative(e.path ?? '')
    const names = new Set(Object.keys(fs).filter(f => f.startsWith(`${base}/`)).map(f => f.slice(base.length + 1).split('/')[0]!))
    return { value: [...names].map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) } as never
  })
  on('ui.toast', async (_$, e) => {
    toasts.push(String((e as { text?: string }).text ?? ''))
    return { value: undefined } as never
  })
  on('turn.complete', async () => ({ text: '' }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__avatars__${e.name}` } }) as never)
  on('session.start', async () => ({ cwd: '/work' }) as never)
  on('config.set', async (_$, e) => {
    configSets.push({ key: e.key, value: e.value })
    return { value: e.value } as never
  })
  /** What a playback writes to stderr, by its curl config: nothing unless a test says. */
  const playback = { stderr: (_input: string): string | undefined => undefined }
  on('process.spawn', async function* (_$, e) {
    spawned.push({ argv: e.argv, env: { ...(e.env ?? {}) }, input: e.input ?? '' })
    const stderr = playback.stderr(e.input ?? '')
    if (stderr) yield { stream: 'stderr', text: stderr }
    return { value: { code: 0, signal: null } } as never
  })
  return { spawned, toasts, configSets, fs, playback }
}

const run = ($: Engine, args: string) => $.command.run({ command: 'avatar', args })

/** An interactive session starting: only those speak replies. */
const start = ($: Engine) => ($ as unknown as { session: { start: (e: unknown) => Promise<unknown> } }).session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

/** The JSON body and headers of a curl config the plugin handed over stdin. */
const curlOf = (config: string) => {
  const unquote = (v: string) => JSON.parse(v.replace(/\\\\/g, '\u0000').replace(/\\"/g, '\u0001').replace(/\u0000/g, '\\\\').replace(/\u0001/g, '\\"'))
  const field = (name: string) => [...config.matchAll(new RegExp(`^${name} = (".*")$`, 'gm'))].map(m => unquote(m[1]!) as string)
  return { url: field('url')[0] ?? '', headers: field('header'), body: JSON.parse(field('data-binary')[0] ?? '{}') as { text: string; model_id: string } }
}

const WITH_KEY = { options: { api_key: KEY } }

test('modes load from the mode folders; a broken one is reported, not loaded', async ($, on) => {
  engine(on, { '/plugin/modes/broken/mode.json': '{ "title": "Broken", "call": {} ' })
  await run($, 'reload')
  const listed = (await run($, 'modes')).text
  expect(listed).toContain('duo: The Duo')
  expect(listed).toContain('narrator: Narrator')
  expect(listed).toContain('broken: mode.json does not parse')
})

test('switching mode plays its sample: each line in its member voice, the ring before the first', WITH_KEY, async ($, on) => {
  const { spawned } = engine(on)
  const clock = mock.clock(on, { now: 1_000 })
  await run($, 'reload')
  expect((await run($, 'mode duo')).text).toBe('Mode set to The Duo.')
  await clock.advance(2_000)

  expect(spawned.map(s => curlOf(s.input).url)).toEqual([
    'https://api.elevenlabs.io/v1/text-to-speech/BossVoice00000000000/stream?output_format=pcm_22050',
    'https://api.elevenlabs.io/v1/text-to-speech/HelperVoice000000000/stream?output_format=pcm_22050',
  ])
  expect(spawned[0]!.env.AVATAR_RING).toMatch(/modes\/duo\/ring\.pcm$/)
  expect(spawned[1]!.env.AVATAR_RING).toBeUndefined()
  expect(spawned.every(s => s.env.AVATAR_FILTER === 'volume=2dB')).toBe(true)
  expect(curlOf(spawned[0]!.input).body.text).toBe('[loud] Report!')
})

test('the key travels only in the curl config on stdin, quoted so any text survives', WITH_KEY, async ($, on) => {
  const { spawned } = engine(on)
  const clock = mock.clock(on, { now: 1_000 })
  await run($, 'reload')
  await run($, 'mode narrator')
  await clock.advance(1_000)
  spawned.length = 0
  await run($, 'model eleven_flash_v2_5') // no tags: they are stripped
  await clock.advance(1_000)

  const [only] = spawned
  expect(only!.argv.join(' ')).not.toContain(KEY)
  expect(JSON.stringify(only!.env)).not.toContain(KEY)
  const curl = curlOf(only!.input)
  expect(curl.headers).toContain(`xi-api-key: ${KEY}`)
  expect(curl.body).toEqual({ text: 'Switched models. This is how I sound now.', model_id: 'eleven_flash_v2_5' })
})

test('a reply with quotes, backslashes and newlines round-trips through the curl config', WITH_KEY, async ($, on) => {
  const { spawned } = engine(on)
  on('model.complete', async () => ({ value: { isAnswered: true, text: 'She said "done" \\ twice.\nThen left.' } }) as never)
  const clock = mock.clock(on, { now: 1_000 })
  await run($, 'reload')
  await run($, 'mode narrator')
  await clock.advance(1_000)
  spawned.length = 0
  await start($)
  await $.turn.complete({ reason: 'answer', answer: 'Fixed it.', turnId: 't1' } as never)
  await clock.advance(1_000)
  expect(curlOf(spawned[0]?.input ?? '').body.text).toBe('She said "done" \\ twice.\nThen left.')
})

test('without a key nothing is spawned and the person is told how to set one', async ($, on) => {
  const { spawned, toasts } = engine(on)
  const clock = mock.clock(on, { now: 1_000 })
  await run($, 'reload')
  await run($, 'mode narrator')
  await clock.advance(1_000)
  expect(spawned.length).toBe(0)
  expect(toasts.join('\n')).toContain('No ElevenLabs API key')
})

test('a cast reply is split into lines, unknown names continuing the last line', WITH_KEY, async ($, on) => {
  const { spawned } = engine(on)
  on('model.complete', async () => ({ value: { isAnswered: true, text: 'CHIEF: Well?\nHELPER: All green.\nand fast too.' } }) as never)
  const clock = mock.clock(on, { now: 1_000 })
  await run($, 'reload')
  await run($, 'mode duo')
  await clock.advance(2_000)
  spawned.length = 0
  await start($)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: 't1' } as never)
  await clock.advance(2_000)
  expect(spawned.map(s => curlOf(s.input).body.text)).toEqual(['Well?', 'All green. and fast too.'])
  expect(spawned.map(s => curlOf(s.input).url.split('/')[5])).toEqual(['BossVoice00000000000', 'HelperVoice000000000'])
})

const BAND = (bodyColumns: number) => ({ hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns, title: '' }) as never

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown }

const rasterOf = (node: unknown): Drawn | undefined => {
  const el = node as Drawn
  if (el?.type === 'Raster') return el
  const kids = el?.children ?? el?.props?.children
  for (const kid of Array.isArray(kids) ? kids : kids ? [kids] : []) {
    const found = rasterOf(kid)
    if (found) return found
  }
  return undefined
}

const rasterText = (raster: Drawn) => {
  const { columns, rows, cells } = raster.props as { columns: number; rows: number; cells: string }
  const words = new Uint32Array(Uint8Array.from(atob(cells), c => c.charCodeAt(0)).buffer)
  return Array.from({ length: rows }, (_, y) =>
    Array.from({ length: columns }, (_, x) => String.fromCodePoint(words[(y * columns + x) * 3] ?? 32)).join(''),
  ).join('\n')
}

test('a cast mode with portraits draws its band; a mode without one removes it', WITH_KEY, async ($, on) => {
  engine(on)
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }) as never)
  const clock = mock.clock(on, { now: 1_000 })
  await run($, 'reload')
  await run($, 'mode duo')
  await clock.advance(3_000)
  const ui = await $.ui.mount({ plugin: 'avatars', surface: 'terminal', component: 'AbovePrompt', props: BAND(170) })
  const raster = rasterOf(await ui.drawn())
  expect(raster?.props?.rows).toBe(20)
  expect(rasterText(raster!)).toContain('T H E   D U O')
  await ui.unmount()

  await run($, 'mode narrator')
  const after = await $.ui.mount({ plugin: 'avatars', surface: 'terminal', component: 'AbovePrompt', props: BAND(170) })
  expect(rasterOf(await after.drawn())).toBeUndefined()
})

test('a codec band shows its panel when wide and shrinks to fit when narrow', WITH_KEY, async ($, on) => {
  const sizes = (frames: string[]) => Object.fromEntries([20, 16, 12, 10, 8].map(rows => [rows, portrait(rows, frames)]))
  const frames = ['neutral', 'blink', 'talk_a', 'talk_b']
  engine(on, {
    '/plugin/modes/codec/mode.json': JSON.stringify({ ...DUO, title: 'Codec', band: { ...DUO.band, title: 'P T T', layout: 'codec', frequency: '140.85' } }),
    '/plugin/modes/codec/portraits.json': JSON.stringify({ boss: sizes(frames), helper: sizes(frames) }),
  })
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }) as never)
  const clock = mock.clock(on, { now: 1_000 })
  await run($, 'reload')
  await run($, 'mode codec')
  await clock.advance(3_000)
  const wide = await $.ui.mount({ plugin: 'avatars', surface: 'terminal', component: 'AbovePrompt', props: BAND(170) })
  const raster = rasterOf(await wide.drawn())
  expect(raster?.props?.rows).toBe(20)
  expect(rasterText(raster!)).toContain('P T T')
  await wide.unmount()

  const narrow = await $.ui.mount({ plugin: 'avatars', surface: 'terminal', component: 'AbovePrompt', props: BAND(60) })
  const small = rasterOf(await narrow.drawn())
  expect(small?.props?.rows).toBe(12)
  expect(rasterText(small!)).not.toContain('P T T')
})

test('/avatar test picks a demo by number or by a speaker in it', WITH_KEY, async ($, on) => {
  const { spawned } = engine(on)
  const clock = mock.clock(on, { now: 1_000 })
  await run($, 'reload')
  await run($, 'mode duo')
  await clock.advance(2_000)
  spawned.length = 0
  expect((await run($, 'test 2')).text).toBe('Playing a The Duo demo (2).')
  await clock.advance(2_000)
  expect(curlOf(spawned[0]!.input).body.text).toBe('Faster now.')
  expect((await run($, 'test chief')).text).toContain('(chief)')
  expect((await run($, 'test 9')).text).toContain('No The Duo demo matches 9')
})

test('/avatar scenario switches to its mode and plays every line', WITH_KEY, async ($, on) => {
  const { spawned } = engine(on)
  const clock = mock.clock(on, { now: 1_000 })
  await run($, 'reload')
  await run($, 'mode narrator')
  await clock.advance(1_000)
  spawned.length = 0
  expect((await run($, 'scenario')).text).toContain('long (The Duo: A long one)')
  expect((await run($, 'scenario long')).text).toContain('3 lines')
  await clock.advance(10_000)
  expect(spawned.length).toBe(3)
})

test('/avatar default saves the session setup through the plugin config', async ($, on) => {
  const { configSets } = engine(on)
  await run($, 'reload')
  await run($, 'mode narrator')
  await run($, 'off')
  expect((await run($, 'default')).text).toBe('New sessions will start with Narrator.')
  expect(configSets).toContainEqual({ key: 'avatars.mode', value: 'narrator' })
  expect(configSets).toContainEqual({ key: 'avatars.speak', value: false })
})

test('the menu opens and its mode picker switches mode', WITH_KEY, async ($, on) => {
  engine(on)
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }) as never)
  const clock = mock.clock(on, { now: 1_000 })
  await run($, 'reload')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'avatars', surface, component: 'Pane', requestId: 'avatars', props: {} as never })
    await ui.select({ key: 'mode', value: 'narrator' })
    await clock.advance(1_000)
    expect((await run($, 'modes')).text).toContain('narrator')
    expect(JSON.stringify(await ui.drawn())).toContain('One voice.')
    await ui.unmount()
  }
})

test('check_mode rejects a folder name that cannot be a mode name', async ($, on) => {
  engine(on)
  const r = await $.tool.call({ tool: 'mcp__avatars__check_mode', path: '/home/me/.claude/avatars/modes/My Mode' } as never)
  expect(JSON.stringify(r)).toContain('must be lowercase')
})

test('search_voices queries the shared library with the key and lists ids', WITH_KEY, async ($, on) => {
  engine(on)
  const asked: Array<{ url: string; key?: string }> = []
  on('http.fetch', async (_$, e) => {
    asked.push({ url: e.url, key: e.init?.headers?.['xi-api-key'] })
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ voices: [{ voice_id: 'Shared00000000000000', public_owner_id: 'owner1', name: 'Queenly', accent: 'egyptian' }] }) } } as never
  })
  const r = await $.tool.call({ tool: 'mcp__avatars__search_voices', query: 'regal queen', gender: 'female' } as never)
  expect(asked[0]?.url).toBe('https://api.elevenlabs.io/v1/shared-voices?search=regal%20queen&page_size=12&gender=female')
  expect(asked[0]?.key).toBe(KEY)
  expect(JSON.stringify(r)).toContain('Shared00000000000000')
})

test('/avatar recast gives a character a personal voice that survives a reload, and undoes it', WITH_KEY, async ($, on) => {
  const { spawned, fs } = engine(on)
  const clock = mock.clock(on, { now: 1_000 })
  await run($, 'reload')
  await run($, 'mode duo')
  await clock.advance(2_000)
  expect((await run($, 'recast boss Personal000000000000')).text).toContain('boss in The Duo now speaks with Personal000000000000')
  expect(JSON.parse(fs['/home/voices.json']!)).toEqual({ duo: { boss: 'Personal000000000000' } })
  await run($, 'reload')
  spawned.length = 0
  await run($, 'test 1')
  await clock.advance(2_000)
  expect(curlOf(spawned[0]!.input).url).toContain('/Personal000000000000/')
  expect((await run($, 'recast boss')).text).toContain("back to the mode's own voice")
  expect(JSON.parse(fs['/home/voices.json']!)).toEqual({})
})

test('a rejected library voice is added to the account and the line retried once', WITH_KEY, async ($, on) => {
  const { spawned, playback } = engine(on)
  const posts: string[] = []
  on('http.fetch', async (_$, e) => {
    posts.push(`${e.init?.method} ${e.url}`)
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } } as never
  })
  let rejected = false
  playback.stderr = input => {
    if (rejected || !input.includes('/HelperVoice000000000/')) return undefined
    rejected = true
    return 'curl: (22) The requested URL returned error: 404'
  }
  const clock = mock.clock(on, { now: 1_000 })
  await run($, 'reload')
  await run($, 'mode duo')
  await clock.advance(3_000)
  expect(posts).toEqual(['POST https://api.elevenlabs.io/v1/voices/add/owner7/HelperVoice000000000'])
  expect(spawned.map(sp => curlOf(sp.input).url.split('/')[5])).toEqual(['BossVoice00000000000', 'HelperVoice000000000', 'HelperVoice000000000'])
})
