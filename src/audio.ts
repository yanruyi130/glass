import { useEffect, useRef, useState } from 'react'
import type { AudioInput } from './background'
import { BUILT_IN_MUSIC, builtInMusicUrl } from './builtInMusic'
import { createMusicTransport, musicUnit as unit, SILENT_MUSIC, STOPPED } from './musicTransport'
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

const preferenceKey = 'glass-lab.music.preferences'
const storeName = 'tracks'
const weathers = ['sunny', 'cloudy', 'rainy', 'snow'] as const
const audioExtensions = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|aiff|aif|weba|webm|mp4)$/i

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

async function saveTracks(tracks: readonly Track[], removed: readonly string[]) {
  const db = await openLibrary()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite')
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
      const store = transaction.objectStore(storeName)
      for (const track of tracks) store.put(track)
      for (const id of removed) store.delete(id)
    })
  } finally {
    db.close()
  }
}

function acceptedFile(file: File) {
  return file.size > 0 && (file.type.startsWith('audio/') || audioExtensions.test(file.name))
}

export function useSoundscape(weather: WeatherId) {
  const [library, setLibrary] = useState<Track[]>([])
  const [preferences, setPreferences] = useState(readPreferences)
  const [loading, setLoading] = useState(true)
  const [storageError, setStorageError] = useState('')
  const [playback, setPlayback] = useState(STOPPED)
  const bands = useRef<AudioInput>(SILENT_MUSIC)
  const initialVolume = useRef(preferences.volume)
  const transport = useRef<ReturnType<typeof createMusicTransport>>(null)
  const liveLibrary = useRef<Track[]>([])
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const mounted = useRef(false)
  const advanceOnEnd = useRef<(id: string) => boolean>(() => false)
  const playlist = library.filter(track => track.weathers.includes(weather))
  const active = playlist.find(track => track.id === preferences.selection[weather]) ?? playlist[0]
  const index = active ? playlist.indexOf(active) : -1
  const previous = playlist[index - 1]
  const next = playlist[index + 1]
  const builtIn = BUILT_IN_MUSIC[weather]
  const current = active
    ? { id: active.id, title: active.title, source: 'local' as const }
    : { id: builtIn.id, title: builtIn.title, source: 'built-in' as const }
  const location = active?.file ?? builtInMusicUrl(builtIn.fileName)
  const currentId = current.id

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    void readLibrary().then(tracks => {
      if (cancelled) return
      liveLibrary.current = tracks
      setLibrary(tracks)
    }).catch(() => {
      if (!cancelled) setStorageError('无法读取本地曲库。')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    const controller = createMusicTransport(initialVolume.current, setPlayback, input => {
      bands.current = input
    }, id => advanceOnEnd.current(id))
    transport.current = controller
    return () => {
      transport.current = null
      controller.dispose()
    }
  }, [])

  useEffect(() => {
    if (!loading) transport.current?.select({ id: currentId, location })
  }, [currentId, location, loading])

  useEffect(() => {
    transport.current?.setVolume(preferences.volume)
  }, [preferences.volume])

  useEffect(() => {
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(preferences))
    } catch {
      // Music and the in-memory preference remain available.
    }
  }, [preferences])

  const nextId = next?.id
  useEffect(() => {
    advanceOnEnd.current = id => {
      if (!nextId || id !== currentId) return false
      setPreferences(previous => ({
        ...previous,
        selection: { ...previous.selection, [weather]: nextId },
      }))
      return true
    }
  }, [currentId, nextId, weather])

  function updateLibrary(tracks: Track[], changed: Track[], removed: string[] = []) {
    liveLibrary.current = tracks
    setLibrary(tracks)
    setStorageError('')
    saveQueue.current = saveQueue.current.then(() => saveTracks(changed, removed)).catch(() => {
      if (mounted.current) setStorageError('曲库未能保存，当前页面仍可播放。')
    })
    return saveQueue.current
  }

  function choose(id?: string) {
    setPreferences(previous => {
      const selection = { ...previous.selection }
      if (id) selection[weather] = id
      else delete selection[weather]
      return { ...previous, selection }
    })
  }

  function upload(files: File[]) {
    const additions = files.filter(acceptedFile).map((file, index): Track => ({
      id: Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-'),
      title: file.name.replace(/\.[^.]+$/, '') || file.name,
      file,
      weathers: [weather],
      importedAt: Date.now() + index,
    }))
    if (additions.length) {
      choose(additions[0].id)
      return updateLibrary([...liveLibrary.current, ...additions], additions)
    }
    if (files.length) setStorageError('请选择非空音频文件，例如 MP3、WAV 或 M4A。')
  }

  function select(id: string) {
    const track = liveLibrary.current.find(item => item.id === id)
    if (!track) return
    if (!track.weathers.includes(weather)) {
      const updated = { ...track, weathers: [...track.weathers, weather] }
      void updateLibrary(liveLibrary.current.map(item => item.id === id ? updated : item), [updated])
    }
    choose(id)
  }

  function restoreBuiltIn() {
    const changed: Track[] = []
    const restored = liveLibrary.current.map(track => {
      if (!track.weathers.includes(weather)) return track
      const next = { ...track, weathers: track.weathers.filter(assignment => assignment !== weather) }
      changed.push(next)
      return next
    })
    choose()
    void updateLibrary(restored, changed)
  }

  function removeCurrent() {
    if (!active) return
    choose()
    void updateLibrary(liveLibrary.current.filter(track => track.id !== active.id), [], [active.id])
  }

  const displayed = playback.id === currentId ? playback : STOPPED
  return {
    requested: playback.requested,
    playing: playback.playing,
    progress: displayed.progress,
    duration: displayed.duration,
    bands,
    current,
    tracks: library.map(({ id, title }) => ({ id, title })),
    loading,
    error: displayed.error || storageError,
    musicVolume: preferences.volume,
    previousTrack: previous ? () => select(previous.id) : undefined,
    nextTrack: next ? () => select(next.id) : undefined,
    select,
    upload,
    restoreBuiltIn,
    removeCurrent,
    togglePlay: () => transport.current?.toggle(),
    seek: (seconds: number) => transport.current?.seek(seconds),
    setMusicVolume: (volume: number) => setPreferences(previous => ({ ...previous, volume: unit(volume) })),
  }
}
