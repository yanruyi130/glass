import type { WeatherId } from './climate'

export type AmbienceStatus = 'off' | 'waiting' | 'playing' | 'error'

export interface AmbienceSettings {
  enabled: boolean
  volume: number
  fireplace: boolean
}

interface Scene extends AmbienceSettings {
  weather: WeatherId
  musicPlaying: boolean
}

const BED_FOR_WEATHER = {
  sunny: 'coast',
  cloudy: 'wind',
  rainy: 'rain',
  snow: 'winter',
} as const satisfies Record<WeatherId, string>

const SOUNDS = {
  coast: { file: 'coast.wav', gain: .88 },
  wind: { file: 'wind.wav', gain: .78 },
  rain: { file: 'rain.wav', gain: .92 },
  winter: { file: 'winter.wav', gain: .54 },
  fireplace: { file: 'fireplace.wav', gain: .57 },
  drip: { file: 'rain-drop.wav', gain: .19 },
} as const

type SoundId = keyof typeof SOUNDS
type BedId = Exclude<SoundId, 'drip'>

const WEATHER_FADE = 2.5
const STOP_FADE = .36
const DUCKED = .44
const OUTPUT_GAIN = .83

interface Level {
  node: GainNode
  from: number
  to: number
  start: number
  end: number
}

interface Bed {
  source: AudioBufferSourceNode
  level: Level
  retire: number
}

export function createWeatherAmbience(report: (status: AmbienceStatus) => void) {
  const context = new AudioContext()
  const downloads = new AbortController()
  const cache = new Map<SoundId, Promise<AudioBuffer>>()
  const beds = new Map<BedId, Bed>()
  const accents = new Map<AudioBufferSourceNode, GainNode>()
  let scene: Scene | undefined
  let request = 0
  let route: string | undefined
  let accentTimer = 0
  let disposed = false

  function makeLevel(destination: AudioNode): Level {
    const node = context.createGain()
    node.gain.value = 0
    node.connect(destination)
    return { node, from: 0, to: 0, start: 0, end: 0 }
  }

  // The weather bus joins the browser's output here. The liquid surface reads
  // only the analyser in the music transport's separate audio graph.
  const output = makeLevel(context.destination)

  function ramp(level: Level, to: number, seconds: number, now = context.currentTime) {
    if (level.to === to) return
    const progress = level.end > now ? Math.max(0, (now - level.start) / (level.end - level.start)) : 1
    const from = level.from + (level.to - level.from) * progress
    const gain = level.node.gain
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(from, now)
    gain.linearRampToValueAtTime(to, now + seconds)
    Object.assign(level, { from, to, start: now, end: now + seconds })
  }

  function load(id: SoundId) {
    let pending = cache.get(id)
    if (!pending) {
      pending = fetch(import.meta.env.BASE_URL + 'ambience/' + SOUNDS[id].file, { signal: downloads.signal })
        .then(response => {
          if (!response.ok) throw new Error('Weather audio unavailable')
          return response.arrayBuffer()
        })
        .then(bytes => context.decodeAudioData(bytes))
        .catch((error: unknown) => {
          cache.delete(id)
          throw error
        })
      cache.set(id, pending)
    }
    return pending
  }

  function stopBed(id: BedId, bed: Bed) {
    window.clearTimeout(bed.retire)
    bed.source.stop()
    bed.source.disconnect()
    bed.level.node.disconnect()
    beds.delete(id)
  }

  function fadeBed(id: BedId, bed: Bed, level: number, seconds: number, now: number) {
    window.clearTimeout(bed.retire)
    ramp(bed.level, level, seconds, now)
    bed.retire = level === 0 ? window.setTimeout(() => stopBed(id, bed), (seconds + .06) * 1000) : 0
  }

  function startBed(id: BedId, buffer: AudioBuffer) {
    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    const level = makeLevel(output.node)
    source.connect(level.node)
    source.start(0, Math.random() * buffer.duration)
    const bed: Bed = { source, level, retire: 0 }
    beds.set(id, bed)
    return bed
  }

  function current(version: number) {
    return !disposed && request === version && scene?.enabled && context.state === 'running'
  }

  function scheduleDrip(version: number) {
    accentTimer = window.setTimeout(() => {
      if (!current(version)) return
      void load('drip').then(buffer => {
        const rain = beds.get('rain')
        if (!current(version) || !rain) return
        const source = context.createBufferSource()
        source.buffer = buffer
        source.playbackRate.value = .87 + Math.random() * .22
        const gain = context.createGain()
        gain.gain.value = SOUNDS.drip.gain * (.7 + Math.random() * .3)
        source.connect(gain).connect(rain.level.node)
        accents.set(source, gain)
        source.onended = () => {
          accents.delete(source)
          source.disconnect()
          gain.disconnect()
        }
        source.start()
        scheduleDrip(version)
      }).catch(() => {
        // The continuous rain bed is already playing if this accent fails.
      })
    }, 5600 + Math.random() * 11700)
  }

  function cancelPending() {
    request++
    route = undefined
    window.clearTimeout(accentTimer)
  }

  function updateOutput(seconds: number) {
    const level = scene?.enabled ? scene.volume * OUTPUT_GAIN * (scene.musicPlaying ? DUCKED : 1) : 0
    ramp(output, level, seconds)
  }

  function reconcile(seconds: number) {
    if (disposed || !scene?.enabled || context.state !== 'running') return
    const base: BedId = BED_FOR_WEATHER[scene.weather]
    const desired: BedId[] = scene.weather === 'snow' && scene.fireplace ? [base, 'fireplace'] : [base]
    const signature = desired.join(':')
    if (route === signature) return
    cancelPending()
    route = signature
    const version = request
    if (![...beds.values()].some(bed => bed.level.to > 0)) report('waiting')

    void Promise.allSettled(desired.map(id => load(id))).then(results => {
      if (!current(version)) return
      const active = new Map<BedId, AudioBuffer>()
      for (const [index, result] of results.entries()) {
        if (result.status === 'fulfilled') active.set(desired[index], result.value)
      }
      const complete = active.size === desired.length
      if (!active.has(base)) active.clear()
      const now = context.currentTime
      for (const [id, bed] of beds) {
        if (!active.has(id)) fadeBed(id, bed, 0, seconds, now)
      }
      for (const [id, buffer] of active) {
        fadeBed(id, beds.get(id) ?? startBed(id, buffer), SOUNDS[id].gain, seconds, now)
      }
      if (active.has('rain')) scheduleDrip(version)
      if (!complete) route = undefined
      report(complete ? 'playing' : 'error')
    })
  }

  function onStateChange() {
    if (!scene?.enabled || disposed) return
    if (context.state === 'running') reconcile(.48)
    else {
      cancelPending()
      report('waiting')
    }
  }
  context.addEventListener('statechange', onStateChange)

  return {
    configure(next: Scene) {
      const previous = scene
      scene = next
      if (!next.enabled) {
        if (previous?.enabled) {
          cancelPending()
          updateOutput(STOP_FADE)
          const now = context.currentTime
          for (const [id, bed] of beds) fadeBed(id, bed, 0, STOP_FADE, now)
        }
        report('off')
        return
      }
      if (!previous?.enabled) updateOutput(.45)
      else if (previous.musicPlaying !== next.musicPlaying) updateOutput(next.musicPlaying ? .7 : 1.35)
      else if (previous.volume !== next.volume) updateOutput(.18)
      reconcile(previous && previous.weather !== next.weather ? WEATHER_FADE : .48)
    },
    activate() {
      if (!scene?.enabled || disposed) return
      if (context.state === 'running') reconcile(.48)
      else {
        report('waiting')
        void context.resume().then(() => reconcile(.48)).catch(() => {
          if (scene?.enabled && !disposed) report('waiting')
        })
      }
    },
    dispose() {
      disposed = true
      cancelPending()
      downloads.abort()
      context.removeEventListener('statechange', onStateChange)
      for (const [source, gain] of accents) {
        source.onended = null
        source.stop()
        source.disconnect()
        gain.disconnect()
      }
      accents.clear()
      for (const [id, bed] of beds) stopBed(id, bed)
      cache.clear()
      output.node.disconnect()
      void context.close().catch(() => {})
    },
  }
}
