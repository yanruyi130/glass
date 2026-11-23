import { useEffect, useRef, useState } from 'react'
import type { AudioInput } from './background'
import type { WeatherId } from './climate'

type Track = {
  id: string
  title: string
  file: File
  weathers: WeatherId[]
  importedAt: number
}

type Preferences = {
  volume: number
  selection: Partial<Record<WeatherId, string>>
}

type AudioGraph = {
  context: AudioContext
  analyser: AnalyserNode
  gain: GainNode
  spectrum: Uint8Array<ArrayBuffer>
}

const preferenceKey = 'glass-lab.music.preferences'
const storeName = 'tracks'
const weathers = ['sunny', 'cloudy', 'rainy', 'snow'] as const
const silence: AudioInput = { low: 0, mid: 0, high: 0, energy: 0 }
const audioExtensions = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|aiff|aif|weba|webm|mp4)$/i

function unit(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

function readPreferences(): Preferences {
  const result: Preferences = { volume: 0.7, selection: {} }
  try {
    const stored = JSON.parse(localStorage.getItem(preferenceKey) ?? 'null')
    if (typeof stored?.volume === 'number') result.volume = unit(stored.volume)
    for (const weather of weathers) {
      const id: unknown = stored?.selection?.[weather]
      if (typeof id === 'string') result.selection[weather] = id
    }
  } catch {
    // The player also works in browsers with storage disabled.
  }
  return result
}

function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('glass-lab.music', 1)
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readLibrary(): Promise<Track[]> {
  const db = await openLibrary()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(storeName).objectStore(storeName).getAll()
      request.onsuccess = () => resolve((request.result as Track[]).sort((a, b) => a.importedAt - b.importedAt))
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

async function saveTracks(tracks: readonly Track[]) {
  const db = await openLibrary()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite')
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
      const store = transaction.objectStore(storeName)
      for (const track of tracks) store.put(track)
    })
  } finally {
    db.close()
  }
}

function acceptedFile(file: File) {
  return file.size > 0 && (file.type.startsWith('audio/') || audioExtensions.test(file.name))
}

function createGraph(media: HTMLAudioElement, volume: number): AudioGraph | null {
  if (typeof AudioContext === 'undefined') return null
  let context: AudioContext | undefined
  try {
    context = new AudioContext()
    const analyser = context.createAnalyser()
    analyser.fftSize = 4096
    analyser.smoothingTimeConstant = 0.72
    analyser.minDecibels = -82
    analyser.maxDecibels = -24
    const gain = context.createGain()
    gain.gain.value = volume
    context.createMediaElementSource(media).connect(analyser).connect(gain).connect(context.destination)
    media.volume = 1
    return { context, analyser, gain, spectrum: new Uint8Array(analyser.frequencyBinCount) }
  } catch {
    if (context) void context.close().catch(() => undefined)
    return null
  }
}

function readBands({ context, analyser, spectrum }: AudioGraph): AudioInput {
  analyser.getByteFrequencyData(spectrum)
  const hertzPerBin = context.sampleRate / analyser.fftSize
  const measure = (from: number, to: number) => {
    const first = Math.ceil(from / hertzPerBin)
    const last = Math.min(Math.ceil(to / hertzPerBin), spectrum.length)
    let squared = 0
    for (let index = first; index < last; index += 1) {
      const amplitude = spectrum[index] / 255
      squared += amplitude * amplitude
    }
    return unit(Math.sqrt(squared / Math.max(1, last - first)))
  }
  const low = measure(30, 220)
  const mid = measure(220, 2200)
  const high = measure(2200, 10500)
  return { low, mid, high, energy: unit(Math.hypot(low * 0.64, mid * 0.64, high * 0.42)) }
}

export function useSoundscape(weather: WeatherId) {
  const [library, setLibrary] = useState<Track[]>([])
  const [preferences, setPreferences] = useState(readPreferences)
  const [loading, setLoading] = useState(true)
  const [storageError, setStorageError] = useState('')
  const [playbackError, setPlaybackError] = useState('')
  const [playback, setPlayback] = useState({ playing: false, progress: 0, duration: 0 })
  const bands = useRef<AudioInput>(silence)
  const media = useRef<HTMLAudioElement | null>(null)
  const graph = useRef<AudioGraph | null>(null)
  const playRequested = useRef(false)
  const playToken = useRef(0)
  const objectUrl = useRef<string | null>(null)
  const liveLibrary = useRef<Track[]>([])
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const mounted = useRef(false)
  const advanceOnEnd = useRef<(() => boolean) | null>(null)

  const playlist = library.filter(track => track.weathers.includes(weather))
  const active = playlist.find(track => track.id === preferences.selection[weather]) ?? playlist[0]
  const index = active ? playlist.indexOf(active) : -1
  const previous = playlist[index - 1]
  const next = playlist[index + 1]
  const file = active?.file
  const trackId = active?.id

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    void readLibrary().then(tracks => {
      if (cancelled) return
      liveLibrary.current = tracks
      setLibrary(tracks)
    }).catch(() => {
      if (!cancelled) setStorageError('无法读取本地曲库，仍可在当前页面导入音频。')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
      mounted.current = false
    }
  }, [])

  function requestPlayback(player: HTMLAudioElement) {
    playRequested.current = true
    const token = ++playToken.current
    void player.play().catch((error: unknown) => {
      if (token !== playToken.current) return
      playRequested.current = false
      if (error instanceof DOMException && error.name === 'AbortError') return
      setPlaybackError('无法播放这段音频，请重试或选择其他文件。')
    })
  }

  useEffect(() => {
    const player = new Audio()
    player.preload = 'metadata'
    media.current = player
    let frame = 0

    function stopAnalysis() {
      window.cancelAnimationFrame(frame)
      frame = 0
      bands.current = silence
    }

    function tick() {
      const audioGraph = graph.current
      if (!audioGraph || player.paused || player.ended) {
        stopAnalysis()
        return
      }
      bands.current = readBands(audioGraph)
      frame = window.requestAnimationFrame(tick)
    }

    function updatePlayback() {
      setPlayback({
        playing: !player.paused && !player.ended,
        progress: player.currentTime,
        duration: Number.isFinite(player.duration) ? player.duration : 0,
      })
    }

    const listeners = {
      durationchange: updatePlayback,
      timeupdate: updatePlayback,
      playing: () => {
        updatePlayback()
        if (!frame && graph.current) frame = window.requestAnimationFrame(tick)
      },
      pause: () => {
        updatePlayback()
        stopAnalysis()
      },
      ended: () => {
        updatePlayback()
        stopAnalysis()
        playRequested.current = advanceOnEnd.current?.() ?? false
      },
      error: () => {
        updatePlayback()
        stopAnalysis()
        if (!objectUrl.current || !player.error) return
        playRequested.current = false
        setPlaybackError('浏览器无法读取这段音频，请尝试其他格式。')
      },
    }
    for (const [event, handle] of Object.entries(listeners)) player.addEventListener(event, handle)

    return () => {
      ++playToken.current
      for (const [event, handle] of Object.entries(listeners)) player.removeEventListener(event, handle)
      stopAnalysis()
      player.pause()
      player.removeAttribute('src')
      player.load()
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
      if (graph.current) void graph.current.context.close().catch(() => undefined)
      objectUrl.current = null
      graph.current = null
      media.current = null
      playRequested.current = false
    }
  }, [])

  useEffect(() => {
    const player = media.current
    if (!player) return
    ++playToken.current
    player.pause()
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = file ? URL.createObjectURL(file) : null
    if (objectUrl.current) player.src = objectUrl.current
    else player.removeAttribute('src')
    player.load()
    bands.current = silence
    setPlayback({ playing: false, progress: 0, duration: 0 })
    setPlaybackError('')
    if (!file) playRequested.current = false
    else if (playRequested.current) requestPlayback(player)
  }, [file, trackId])

  useEffect(() => {
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(preferences))
    } catch {
      // A blocked preference store does not affect playback.
    }
    if (graph.current) {
      const { gain, context } = graph.current
      gain.gain.setTargetAtTime(preferences.volume, context.currentTime, 0.025)
    } else if (media.current) {
      media.current.volume = preferences.volume
    }
  }, [preferences])

  const nextId = next?.id
  useEffect(() => {
    advanceOnEnd.current = () => {
      if (!nextId) return false
      setPreferences(previous => ({
        ...previous,
        selection: { ...previous.selection, [weather]: nextId },
      }))
      return true
    }
  }, [nextId, weather])

  function updateLibrary(tracks: Track[], changed: Track[]) {
    liveLibrary.current = tracks
    setLibrary(tracks)
    setStorageError('')
    saveQueue.current = saveQueue.current.then(() => saveTracks(changed)).catch(() => {
      if (mounted.current) setStorageError('曲库未能保存，音频仍可在当前页面播放。')
    })
    return saveQueue.current
  }

  function upload(files: File[]) {
    const additions = files.filter(acceptedFile).map((file, index): Track => ({
      id: Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-'),
      title: file.name.replace(/\.[^.]+$/, '') || file.name,
      file,
      weathers: [weather],
      importedAt: Date.now() + index,
    }))
    if (additions.length) return updateLibrary([...liveLibrary.current, ...additions], additions)
    if (files.length) setStorageError('请选择非空的音频文件，例如 MP3、WAV 或 M4A。')
  }

  function select(id: string) {
    const track = liveLibrary.current.find(item => item.id === id)
    if (!track) return
    if (!track.weathers.includes(weather)) {
      const updated = { ...track, weathers: [...track.weathers, weather] }
      void updateLibrary(liveLibrary.current.map(item => item.id === id ? updated : item), [updated])
    }
    setPreferences(previous => ({
      ...previous,
      selection: { ...previous.selection, [weather]: id },
    }))
  }

  function togglePlay() {
    const player = media.current
    if (!player || !objectUrl.current) return
    if (playRequested.current || (!player.paused && !player.ended)) {
      playRequested.current = false
      ++playToken.current
      player.pause()
      return
    }
    setPlaybackError('')
    graph.current ??= createGraph(player, preferences.volume)
    if (graph.current?.context.state === 'suspended') void graph.current.context.resume().catch(() => undefined)
    requestPlayback(player)
  }

  function seek(seconds: number) {
    const player = media.current
    if (!player || !Number.isFinite(seconds) || !Number.isFinite(player.duration)) return
    player.currentTime = Math.max(0, Math.min(player.duration, seconds))
  }

  return {
    ...playback,
    bands,
    current: active ? { id: active.id, title: active.title, source: 'local' as const } : null,
    tracks: library.map(({ id, title, weathers }) => ({ id, title, weathers })),
    loading,
    error: playbackError || storageError,
    musicVolume: preferences.volume,
    previousTrack: previous ? () => select(previous.id) : undefined,
    nextTrack: next ? () => select(next.id) : undefined,
    select,
    upload,
    togglePlay,
    seek,
    setMusicVolume: (volume: number) => setPreferences(previous => ({ ...previous, volume: unit(volume) })),
  }
}
