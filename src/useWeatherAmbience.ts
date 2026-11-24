import { useEffect, useRef, useState } from 'react'
import { createWeatherAmbience, type AmbienceSettings, type AmbienceStatus } from './weatherAmbience'
import type { WeatherId } from './climate'

const STORAGE_KEY = 'glass-lab.weather-ambience.v1'

function storedSettings(): AmbienceSettings {
  const defaults = { enabled: false, volume: .34, fireplace: false }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return {
      enabled: saved?.enabled === true,
      volume: typeof saved?.volume === 'number' && Number.isFinite(saved.volume) ? Math.min(1, Math.max(0, saved.volume)) : defaults.volume,
      fireplace: saved?.fireplace === true,
    }
  } catch {
    return defaults
  }
}

export function useWeatherAmbience(weather: WeatherId, musicPlaying: boolean) {
  const [settings, setSettings] = useState(storedSettings)
  const [status, setStatus] = useState<AmbienceStatus>(() => settings.enabled ? 'waiting' : 'off')
  const engine = useRef<ReturnType<typeof createWeatherAmbience> | null>(null)

  useEffect(() => () => {
    engine.current?.dispose()
    engine.current = null
  }, [])

  useEffect(() => {
    engine.current?.configure({ ...settings, weather, musicPlaying })
  }, [settings, weather, musicPlaying])

  function activate(next: AmbienceSettings) {
    if (!next.enabled) return
    try {
      engine.current ??= createWeatherAmbience(setStatus)
      engine.current.configure({ ...next, weather, musicPlaying })
      engine.current.activate()
    } catch {
      setStatus('error')
    }
  }

  function change(patch: Partial<AmbienceSettings>, unlock = false) {
    const next = { ...settings, ...patch }
    setSettings(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // The controls remain usable when browser storage is unavailable.
    }
    if (unlock) activate(next)
    else {
      engine.current?.configure({ ...next, weather, musicPlaying })
      if (!next.enabled) setStatus('off')
    }
  }

  return {
    ...settings,
    status: settings.enabled ? status : 'off' as const,
    showFireplace: weather === 'snow',
    onEnabledChange: (enabled: boolean) => change({ enabled }, enabled),
    onVolumeChange: (volume: number) => change({ volume }),
    onFireplaceChange: (fireplace: boolean) => change({ fireplace }, fireplace && settings.enabled),
    activateForMusic: () => activate(settings),
  }
}
