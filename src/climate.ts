import { clamp, mix, type WeatherGlass } from './material'

export type WeatherId = 'sunny' | 'cloudy' | 'rainy' | 'snow'
export const DEFAULT_WEATHER: WeatherId = 'sunny'
export type Rgb = readonly [number, number, number]

const COLOR_BANDS = ['sky', 'distant', 'cobalt', 'current', 'foam', 'foldRim', 'fold', 'undertow', 'light'] as const
type ColorBand = typeof COLOR_BANDS[number]
type Palette = Record<ColorBand, readonly Rgb[]>

export interface Climate {
  palette: Palette
  flowSpeed: number
  waveAmplitude: number
  sunlight: number
  cloudCover: number
  rainfall: number
  snowfall: number
  surfaceRain: number
  frost: number
  rimLight: number
  rimTint: Rgb
  glass: WeatherGlass
}

function rgb(hex: string): Rgb {
  const value = Number.parseInt(hex, 16)
  return [value >> 16, (value >> 8) & 255, value & 255]
}

function palette(colors: Record<ColorBand, string>): Palette {
  return Object.fromEntries<readonly Rgb[]>(COLOR_BANDS.map(band => [band, colors[band].split(' ').map(rgb)])) as Palette
}

export const WEATHER_PRESETS: Record<WeatherId, Climate> = {
  sunny: {
    flowSpeed: .95, waveAmplitude: 1, sunlight: .9, cloudCover: .02, rainfall: 0, snowfall: 0,
    surfaceRain: 0, frost: 0, rimLight: 1.08, rimTint: [1, .88, .66],
    glass: { tint: .125, tintColor: [1, .974, .923], saturation: 1.37, brightness: 1.06 },
    palette: palette({
      sky: '09172e 11294f 205581 3987a1',
      distant: '112c5c 1d4c88 22508e 185579',
      cobalt: '18468c 255fc2 2c84d1 287ebd 19567f',
      current: '1a448d 2e90ce 4bbed1 288db1 1b668b',
      foam: 'a8d9e5 aae4ec fff1c7 d4eeea 9ed4dc',
      foldRim: '1a579b 37a5c7 268aa6 176281',
      fold: '173b88 21669d 265e86 0e3c60',
      undertow: '102856 124376 183c73 153457',
      light: '3a99ec 72e4e9 ffe0a2',
    }),
  },
  cloudy: {
    flowSpeed: .68, waveAmplitude: .79, sunlight: 0, cloudCover: .86, rainfall: 0, snowfall: 0,
    surfaceRain: 0, frost: 0, rimLight: .74, rimTint: [.77, .83, .94],
    glass: { tint: .12, tintColor: [.76, .81, .93], saturation: 1.16, brightness: 1.01 },
    palette: palette({
      sky: '171e35 27334b 48546d 677687',
      distant: '232a49 3b4268 4c5277 374860',
      cobalt: '2c3d60 495880 586e98 5c7191 39536e',
      current: '394867 627495 869caf 758ca0 496279',
      foam: '9daec9 a9bed0 e2e2ed c7d1dd 99b2c5',
      foldRim: '465474 697c9e 627793 465e7c',
      fold: '313553 424f71 475a74 293c56',
      undertow: '1d263e 2d3659 303a55 243547',
      light: '8997c3 b4c3d9 d9d7eb',
    }),
  },
  rainy: {
    flowSpeed: .76, waveAmplitude: .92, sunlight: 0, cloudCover: .56, rainfall: .73, snowfall: 0,
    surfaceRain: 1, frost: 0, rimLight: .89, rimTint: [.71, .89, .97],
    glass: { tint: .20, tintColor: [.10, .20, .26], saturation: 1.24, brightness: .85 },
    palette: palette({
      sky: '081624 102636 194353 315f71',
      distant: '10263c 173b5b 214658 193e55',
      cobalt: '18375b 29577c 326f92 245e7f 173e5d',
      current: '1f486a 347286 518f9a 397680 24566a',
      foam: '8fbecb a4d5df cce9e6 b7dbe0 8bb8c7',
      foldRim: '234c6a 326982 347785 285667',
      fold: '1b3756 264e6b 2d596b 17384c',
      undertow: '0c203b 173b57 1e455b 132d41',
      light: '5c97b7 82c5cd b3dce8',
    }),
  },
  snow: {
    flowSpeed: .57, waveAmplitude: .67, sunlight: 0, cloudCover: .18, rainfall: 0, snowfall: .83,
    surfaceRain: 0, frost: .88, rimLight: 1.03, rimTint: [.79, .93, 1],
    glass: { tint: .10, tintColor: [.86, .96, 1], saturation: 1.23, brightness: 1.035 },
    palette: palette({
      sky: '0d1e3b 233d62 476989 7195a9',
      distant: '233d63 436f9d 5b8db5 416f92',
      cobalt: '2e5486 5087b9 67a9d1 64a1bc 406f9b',
      current: '3b6d9d 64a2c8 91c9dc 6cb1c7 4b86a6',
      foam: 'b0d4eb c9e8f4 f5fbff d7f1f6 b8dceb',
      foldRim: '4a77a3 76afca 68a5bf 477b9b',
      fold: '2a4a76 3c6e96 477b9c 284d75',
      undertow: '192e52 2c517c 335c85 1d3c64',
      light: 'a6d4f5 d1f5fa e9f6ff',
    }),
  },
}

export function blendClimate(from: Climate, to: Climate, amount: number): Climate {
  const t = clamp(amount)
  if (t === 0) return from
  if (t === 1) return to

  const number = (key: Exclude<keyof Climate, 'palette' | 'rimTint' | 'glass'>) => mix(from[key], to[key], t)
  const color = (a: Rgb, b: Rgb): Rgb => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]
  const palette = Object.fromEntries<readonly Rgb[]>(COLOR_BANDS.map(band => [band,
    from.palette[band].map((rgb, index) => color(rgb, to.palette[band][index])),
  ])) as Palette

  return {
    palette,
    flowSpeed: number('flowSpeed'), waveAmplitude: number('waveAmplitude'), sunlight: number('sunlight'),
    cloudCover: number('cloudCover'), rainfall: number('rainfall'), snowfall: number('snowfall'),
    surfaceRain: number('surfaceRain'), frost: number('frost'), rimLight: number('rimLight'),
    rimTint: color(from.rimTint, to.rimTint),
    glass: {
      tint: mix(from.glass.tint, to.glass.tint, t),
      tintColor: color(from.glass.tintColor, to.glass.tintColor),
      saturation: mix(from.glass.saturation, to.glass.saturation, t),
      brightness: mix(from.glass.brightness, to.glass.brightness, t),
    },
  }
}
