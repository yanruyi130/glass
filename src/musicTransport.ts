import type { AudioInput } from './background'

export interface MusicSource {
  id: string
  location: string | File
}

export interface Playback {
  id: string | null
  requested: boolean
  playing: boolean
  progress: number
  duration: number
  error: string
}

interface VolumeRamp {
  from: number
  to: number
  start: number
  duration: number
}

interface Deck {
  media: HTMLAudioElement
  trackId: string | null
  objectUrl: string | null
  running: boolean
  ramp: VolumeRamp
  gain?: GainNode
}

const FADE = 1.55
const AUDIO_STOP = .075
const SILENT_RAMP = { from: 0, to: 0, start: 0, duration: 0 }
export const SILENT_MUSIC: AudioInput = { low: 0, mid: 0, high: 0, energy: 0 }
export const STOPPED: Playback = { id: null, requested: false, playing: false, progress: 0, duration: 0, error: '' }
export const musicUnit = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0

function createDeck(): Deck {
  const media = new Audio()
  media.preload = 'metadata'
  media.volume = 0
  return { media, trackId: null, objectUrl: null, running: false, ramp: SILENT_RAMP }
}

function createGraph(context: AudioContext, volume: number, decks: readonly Deck[]) {
  const master = context.createGain()
  master.gain.value = volume
  const analyser = context.createAnalyser()
  analyser.fftSize = 4096
  analyser.smoothingTimeConstant = .67
  analyser.minDecibels = -82
  analyser.maxDecibels = -23
  // The analyser sees the audible music mix after crossfade and volume.
  master.connect(analyser).connect(context.destination)
  for (const deck of decks) {
    const gain = context.createGain()
    gain.gain.value = 0
    context.createMediaElementSource(deck.media).connect(gain).connect(master)
    deck.gain = gain
    deck.media.volume = 1
  }
  return {
    context, master, analyser,
    spectrum: new Uint8Array(analyser.frequencyBinCount),
    samples: new Float32Array(analyser.fftSize),
  }
}

function readMusic({ context, analyser, spectrum, samples }: ReturnType<typeof createGraph>): AudioInput {
  analyser.getFloatTimeDomainData(samples)
  let sum = 0
  for (const sample of samples) sum += sample * sample
  const rms = Math.sqrt(sum / samples.length)
  const activity = musicUnit((rms - .001) / .013)
  if (activity === 0) return SILENT_MUSIC
  analyser.getByteFrequencyData(spectrum)
  const hertzPerBin = context.sampleRate / analyser.fftSize
  function band(from: number, to: number, scale: number) {
    const first = Math.ceil(from / hertzPerBin)
    const last = Math.min(Math.ceil(to / hertzPerBin), spectrum.length)
    let squared = 0
    for (let index = first; index < last; index++) squared += (spectrum[index] / 255) ** 2
    return activity * musicUnit(Math.sqrt(squared / Math.max(1, last - first)) * scale)
  }
  return {
    low: band(35, 200, .92),
    mid: band(200, 2300, 1.19),
    high: band(2300, 10400, 1.12),
    energy: activity * musicUnit(Math.log1p(34 * rms) / Math.log1p(34 * .22)),
  }
}

const wait = (seconds: number) => new Promise<void>(resolve => window.setTimeout(resolve, seconds * 1000 + 12))

export function createMusicTransport(
  volume: number, publish: (value: Playback) => void, signal: (input: AudioInput) => void,
  onEnded: (id: string) => boolean,
) {
  const decks = [createDeck(), createDeck()]
  let source: MusicSource | null = null
  let selected: Deck | null = null
  let graph: ReturnType<typeof createGraph> | null = null
  let intent = false
  let failure = ''
  let revision = 0
  let frame = 0
  let disposed = false
  let latest = STOPPED

  const now = () => graph?.context.currentTime ?? performance.now() / 1000
  const level = (deck: Deck, time = now()) => {
    const { from, to, start, duration } = deck.ramp
    return duration > 0 ? from + (to - from) * musicUnit((time - start) / duration) : to
  }
  const audible = (deck: Deck) => deck.running && !deck.media.paused && !deck.media.ended && !deck.media.error

  function report() {
    const media = selected?.media
    const next = {
      id: source?.id ?? null,
      requested: intent,
      playing: intent && decks.some(deck => audible(deck) && (deck === selected || level(deck) > .001)),
      progress: media?.currentTime ?? 0,
      duration: media && Number.isFinite(media.duration) ? media.duration : 0,
      error: failure,
    }
    if (next.id !== latest.id || next.requested !== latest.requested || next.playing !== latest.playing
      || next.progress !== latest.progress || next.duration !== latest.duration || next.error !== latest.error) {
      latest = next
      publish(next)
    }
  }

  function tick() {
    frame = 0
    if (disposed) return
    if (!graph) {
      for (const deck of decks) deck.media.volume = musicUnit(volume * level(deck))
    }
    signal(graph?.context.state === 'running' && intent && volume > 0 && decks.some(audible) ? readMusic(graph) : SILENT_MUSIC)
    if (intent || decks.some(deck => !deck.media.paused)) wake()
  }

  function wake() {
    if (!frame && !disposed) frame = window.requestAnimationFrame(tick)
  }

  function setDeckLevel(deck: Deck, to: number, duration: number, at = now()) {
    const from = level(deck, at)
    deck.ramp = { from, to, start: at, duration }
    if (deck.gain) {
      const param = deck.gain.gain
      param.cancelScheduledValues(at)
      param.setValueAtTime(duration > 0 ? from : to, at)
      if (duration > 0) param.linearRampToValueAtTime(to, at + duration)
    } else {
      deck.media.volume = musicUnit(volume * level(deck, at))
    }
  }

  function mixTo(destination: Deck | null, duration: number) {
    const at = now()
    for (const deck of decks) setDeckLevel(deck, Number(deck === destination), duration, at)
    wake()
  }

  function unload(deck: Deck) {
    if (!deck.trackId) return
    deck.trackId = null
    deck.running = false
    deck.media.pause()
    deck.media.removeAttribute('src')
    deck.media.load()
    if (deck.objectUrl) URL.revokeObjectURL(deck.objectUrl)
    deck.objectUrl = null
  }

  function load(deck: Deck, track: MusicSource) {
    unload(deck)
    setDeckLevel(deck, 0, 0)
    deck.trackId = track.id
    const resource = track.location
    if (typeof resource === 'string') deck.media.src = resource
    else {
      deck.objectUrl = URL.createObjectURL(resource)
      deck.media.src = deck.objectUrl
    }
    deck.media.load()
  }

  function loaded(id: string) {
    return decks.find(deck => deck.trackId === id)
  }

  function park(version: number, track: MusicSource | null) {
    // Keep a tiny ramp even when pause is followed immediately by a new selection.
    const delay = decks.some(deck => !deck.media.paused && level(deck) > .001) ? AUDIO_STOP : 0
    mixTo(null, delay)
    signal(SILENT_MUSIC)
    function finish() {
      if (revision !== version || disposed) return
      const destination = track ? loaded(track.id) ?? decks[0] : null
      for (const deck of decks) {
        if (deck === destination) {
          deck.media.pause()
          deck.running = false
        } else unload(deck)
      }
      if (destination && track && destination.trackId !== track.id) load(destination, track)
      selected = destination
      report()
    }
    if (delay) void wait(delay).then(finish)
    else finish()
  }

  function fail() {
    failure = '无法播放这段音频，请重试或选择其他文件。'
    intent = false
    park(++revision, source)
    report()
  }

  async function play(track: MusicSource, version: number) {
    const valid = () => !disposed && revision === version && intent
    let destination = loaded(track.id)
    if (!destination) {
      destination = decks.find(deck => !deck.trackId)
      if (!destination) {
        const outgoing = audible(decks[0]) && (!audible(decks[1]) || level(decks[0]) >= level(decks[1]))
          ? decks[0] : decks[1]
        destination = outgoing === decks[0] ? decks[1] : decks[0]
        if (audible(destination) && level(destination) > .001) {
          mixTo(outgoing, .16)
          await wait(.16)
          if (!valid()) return
        }
      }
      load(destination, track)
    }
    selected = destination
    report()
    try {
      if (destination.media.error) destination.media.load()
      await destination.media.play()
    } catch {
      if (valid()) fail()
      return
    }
    if (!valid()) return
    destination.running = true
    const crossfade = decks.some(deck => deck !== destination && audible(deck) && level(deck) > .001)
    const duration = crossfade ? FADE : .14
    mixTo(destination, duration)
    report()
    await wait(duration)
    if (!valid()) return
    for (const deck of decks) if (deck !== destination) unload(deck)
  }

  function select(track: MusicSource) {
    if (source?.id === track.id) return
    source = track
    selected = loaded(track.id) ?? null
    failure = ''
    const version = ++revision
    if (intent) void play(track, version)
    else park(version, track)
    report()
  }

  function ensureGraph() {
    if (!graph && typeof AudioContext !== 'undefined') {
      let context: AudioContext | undefined
      try {
        context = new AudioContext()
        graph = createGraph(context, volume, decks)
      } catch {
        if (context) void context.close().catch(() => undefined)
      }
    }
    if (graph?.context.state === 'suspended') void graph.context.resume().catch(() => undefined)
  }

  function toggle() {
    const version = ++revision
    intent = !!source && !intent
    if (intent && source) {
      failure = ''
      ensureGraph()
      void play(source, version)
    } else park(version, source)
    report()
  }

  const unsubscribers = decks.map(deck => {
    const { media } = deck
    const events = {
      durationchange: report,
      timeupdate: report,
      pause() { deck.running = false; report() },
      waiting() { deck.running = false; report() },
      playing() {
        deck.running = !!deck.trackId
        report()
        wake()
      },
      ended() {
        deck.running = false
        if (intent && deck === selected && deck.trackId && !onEnded(deck.trackId)) {
          intent = false
          park(++revision, source)
        }
        report()
      },
      error() {
        deck.running = false
        if (deck === selected && deck.trackId && media.error) fail()
      },
    }
    for (const [type, listener] of Object.entries(events)) media.addEventListener(type, listener)
    return () => {
      for (const [type, listener] of Object.entries(events)) media.removeEventListener(type, listener)
    }
  })

  return {
    select,
    toggle,
    seek(seconds: number) {
      const media = selected?.media
      if (!media || !Number.isFinite(seconds) || !Number.isFinite(media.duration)) return
      media.currentTime = Math.max(0, Math.min(media.duration, seconds))
      report()
    },
    setVolume(value: number) {
      volume = value
      if (graph) graph.master.gain.setTargetAtTime(volume, now(), .025)
      wake()
    },
    dispose() {
      disposed = true
      revision++
      cancelAnimationFrame(frame)
      unsubscribers.forEach(unsubscribe => unsubscribe())
      decks.forEach(unload)
      signal(SILENT_MUSIC)
      if (graph) void graph.context.close().catch(() => undefined)
    },
  }
}
