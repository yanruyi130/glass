/* Ink contrast hysteresis adapted from Glasswork by Kubai087 (MIT). */
export const LAYERS = ['shadow', 'blur', 'rim', 'tint', 'light', 'ink'] as const
export type LayerId = typeof LAYERS[number]

export interface Material {
  shadow: number
  blur: number
  saturation: number
  brightness: number
  rimWidth: number
  edge: number
  power: number
  dispersion: number
  tint: number
  light: number
}

export interface EffectiveMaterial {
  blur: number
  shadow: number
  tint: number
  saturation: number
  brightness: number
}

export interface WeatherGlass extends Omit<EffectiveMaterial, 'blur' | 'shadow'> {
  blurScale: number
  shadowScale: number
  tintColor: readonly [number, number, number]
}

export interface InkReading { luminance: number; lightInk: boolean }
export const INITIAL_INK_READING: InkReading = { luminance: .35, lightInk: true }

export const DEFAULT_MATERIAL: Material = {
  shadow: .72, blur: 2, saturation: 1, brightness: 1, rimWidth: 42,
  edge: 1.1, power: 2.6, dispersion: .15, tint: 1, light: .8,
}

export const DEFAULT_GAP = 40
export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value))
export const mix = (from: number, to: number, amount: number) => from + (to - from) * amount

export function prefersLightInk(luminance: number, previous?: boolean) {
  return luminance < (previous === undefined ? .5 : previous ? .52 : .48)
}

export function effectiveMaterial(material: Material, weather: WeatherGlass): EffectiveMaterial {
  return {
    blur: material.blur * weather.blurScale,
    shadow: material.shadow * weather.shadowScale,
    tint: clamp(weather.tint * material.tint, 0, .76),
    saturation: weather.saturation * material.saturation,
    brightness: weather.brightness * material.brightness,
  }
}
