/* Material defaults and adaptive treatment adapted from Glasswork by Kubai087 (MIT). */
export const LAYERS = ['shadow', 'blur', 'rim', 'tint', 'light', 'ink'] as const
export type LayerId = typeof LAYERS[number]
export type MaterialMode = 'auto' | 'light' | 'dark'

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
  tint: number
  saturation: number
  brightness: number
  dark: boolean
}

export interface InkReading { luminance: number; lightInk: boolean }

export const DEFAULT_MATERIAL: Material = {
  shadow: .72, blur: 2, saturation: 1, brightness: 1, rimWidth: 42,
  edge: 1.1, power: 2.6, dispersion: .15, tint: 1, light: .8,
}

export const DEFAULT_GAP = 40
export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value))
export const mix = (from: number, to: number, amount: number) => from + (to - from) * amount

const smoothstep = (value: number) => {
  const t = clamp(value)
  return t * t * (3 - 2 * t)
}

export interface BackgroundReading {
  luminance: number
  texture: number
  chroma: number
}

export const INITIAL_READING: BackgroundReading = { luminance: .35, texture: .12, chroma: .65 }

export function pickMaterialMode(luminance: number, previous?: boolean) {
  return luminance < (previous === undefined ? .5 : previous ? .52 : .48)
}

export function effectiveMaterial(material: Material, reading: BackgroundReading, dark: boolean): EffectiveMaterial {
  const { luminance, texture, chroma } = reading
  const near = dark ? smoothstep((luminance - .12) / .4) : smoothstep((.8 - luminance) / .35)
  const density = clamp(near * .37 + texture * .5 + chroma * .16)
  const baseTint = dark ? mix(.16, .38, density) : mix(.06, .22, density)
  const baseSaturation = dark ? 1.6 : 1.8
  const keep = clamp(1 - chroma * .75, .45)
  return {
    dark,
    tint: clamp(baseTint * material.tint, 0, .76),
    saturation: (1 + (baseSaturation - 1) * keep) * material.saturation,
    brightness: (dark ? .8 : 1.06) * material.brightness,
  }
}
