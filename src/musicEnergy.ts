import type { AudioInput } from './background'

const bands = ['low', 'mid', 'high', 'energy'] as const
const rise = { low: .155, mid: .115, high: .18, energy: .17 }
const fall = { low: .85, mid: .59, high: .7, energy: .94 }
const silence: AudioInput = Object.freeze({ low: 0, mid: 0, high: 0, energy: 0 })
let source = silence

function normalize(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

/** Music analysers can publish independently of the rendering frame rate. */
export function setMusicEnergy(input?: Partial<AudioInput>) {
  source = input ? {
    low: normalize(input.low), mid: normalize(input.mid), high: normalize(input.high), energy: normalize(input.energy),
  } : silence
}

export function createMusicEnvelope() {
  const output = { ...silence }
  return (seconds: number, input = source): AudioInput => {
    for (const name of bands) {
      const target = normalize(input[name])
      const response = target > output[name] ? rise[name] : fall[name]
      output[name] += (target - output[name]) * -Math.expm1(-seconds / response)
      if (Math.abs(output[name] - target) < .0005) output[name] = target
    }
    return output
  }
}

if (import.meta.env.DEV) {
  const inject = (event: Event) => {
    const input: unknown = event instanceof CustomEvent ? event.detail : undefined
    setMusicEnergy(input && typeof input === 'object' ? input as Partial<AudioInput> : undefined)
  }
  window.addEventListener('glass-lab:music-energy', inject)
  import.meta.hot?.dispose(() => window.removeEventListener('glass-lab:music-energy', inject))
}
