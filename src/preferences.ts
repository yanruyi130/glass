import { useEffect, useState } from 'react'

export function usePreference<Value extends string>(name: string, choices: readonly Value[], fallback: Value) {
  const key = `glass-lab.ui.${name}`
  const [value, change] = useState<Value>(() => {
    try {
      const saved = window.localStorage.getItem(key)
      return choices.find(choice => choice === saved) ?? fallback
    } catch {
      return fallback
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // The setting still applies when the browser blocks storage.
    }
  }, [key, value])

  return [value, change] as const
}
