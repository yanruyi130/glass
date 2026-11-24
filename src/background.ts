import type { Climate, Rgb } from './climate'
import { createSunnySky } from './sunnySky'
import { clamp, mix } from './material'
import { createLiquidSurface } from './liquidSurface'

export type AudioInput = Readonly<{ low: number; mid: number; high: number; energy: number }>

export interface BackgroundFrame {
  time: number
  phase: number
  cloudTime: number
  cloudDriftTime: number
  climate: Climate
  audio: AudioInput
  detail: number
}

type Axis = readonly [number, number, number, number]

const SKY = [0, .36, .7, 1]
const TWO_PI = Math.PI * 2

function rgba([r, g, b]: Rgb, alpha = 1) {
  return 'rgba(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ',' + alpha + ')'
}

function gradient(
  context: CanvasRenderingContext2D, axis: Axis, colors: readonly Rgb[],
  positions: readonly number[], alphas?: readonly number[],
) {
  const fill = context.createLinearGradient(...axis)
  for (const [index, color] of colors.entries()) {
    fill.addColorStop(positions[index], rgba(color, alphas?.[index]))
  }
  return fill
}

function glow(context: CanvasRenderingContext2D, x: number, y: number, radius: number, color: Rgb, alpha: number) {
  if (alpha < .002) return
  const fill = context.createRadialGradient(x, y, 0, x, y, radius)
  fill.addColorStop(0, rgba(color, alpha))
  fill.addColorStop(.43, rgba(color, alpha * .36))
  fill.addColorStop(1, rgba(color, 0))
  context.fillStyle = fill
  context.fillRect(x - radius, y - radius, radius * 2, radius * 2)
}

const wrap = (value: number) => value - Math.floor(value)
const smooth = (value: number) => {
  const t = clamp(value)
  return t * t * (3 - 2 * t)
}

function hash(x: number, y: number, seed: number) {
  const n = Math.imul(x + seed, 374761393) + Math.imul(y, 668265263)
  const scrambled = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((scrambled ^ (scrambled >>> 16)) >>> 0) / 4294967295
}

function noise(x: number, y: number, seed: number): number {
  const i = Math.floor(x), j = Math.floor(y)
  const u = smooth(x - i), v = smooth(y - j)
  return mix(mix(hash(i, j, seed), hash(i + 1, j, seed), u), mix(hash(i, j + 1, seed), hash(i + 1, j + 1, seed), u), v)
}

function cloudStamp(seed: number, depth: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 176
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (!context) return canvas
  const pixels = context.createImageData(canvas.width, canvas.height)
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const u = (x + .5) / canvas.width, v = (y + .5) / canvas.height
      const center = .49 + (noise(u * 4.7, 6, seed) - .5) * .31
      const shape = Math.sin(u * Math.PI) ** .72 * clamp(1 - (Math.abs(v - center) / .47) ** 2)
      const billow = noise(u * 8 + 1.3, v * 4, seed) * .58 + noise(u * 18.7, v * 9.2, seed + 7) * .29
        + noise(u * 39.1, v * 17.3, seed + 13) * .13
      const fade = smooth(u * 8) * smooth((1 - u) * 8) * smooth(v * 8) * smooth((1 - v) * 7)
      const density = smooth((shape * .70 + billow * .42 - .43) * 2.85)
      const ink = clamp((1 - v) * .90 + (1 - density) * .17)
      const p = (y * canvas.width + x) * 4
      pixels.data[p] = mix(37 - depth * 13, 181, ink)
      pixels.data[p + 1] = mix(52 - depth * 11, 188, ink)
      pixels.data[p + 2] = mix(80 - depth * 8, 217, ink)
      pixels.data[p + 3] = density * fade * 241
    }
  }
  context.putImageData(pixels, 0, 0)
  return canvas
}

function driftCloud(x: number, width: number, distance: number) {
  if (distance === 0) return x
  const margin = .08
  const span = 1 + width + margin * 2
  return wrap((x + width + margin + distance) / span) * span - width - margin
}

function paintClouds(
  context: CanvasRenderingContext2D, stamps: readonly HTMLCanvasElement[],
  time: number, driftTime: number, amount: number,
) {
  const banks = [
    [-.48, .035, 1.1, .31, .33, .043],
    [.34, .083, .94, .27, .46, -.054],
    [-.17, .15, .97, .36, .56, .074],
    [.41, .205, .86, .32, .62, -.086],
  ]
  context.save()
  for (const [index, [homeX, y, w, h, alpha, glide]] of banks.entries()) {
    const rate = .056 + index * .012
    const phase = 1.19 * index
    const sway = Math.sin((time - driftTime) * rate + phase) * glide
    const x = driftCloud(homeX + sway, w, driftTime * Math.abs(glide) * rate)
    const rise = Math.sin((time * rate + phase) * .76) * .011
    context.globalAlpha = alpha * amount
    context.drawImage(stamps[index % stamps.length], x, y + rise, w, h)
  }
  context.restore()
}

function scatteredParticles(count: number, seed: number) {
  return Array.from({ length: count }, (_, index) => ({
    x: hash(index, 1, seed), y: hash(index, 2, seed), size: hash(index, 3, seed),
    pace: hash(index, 4, seed), phase: hash(index, 5, seed),
  }))
}

const PARTICLES = scatteredParticles(64, 417)
const RAIN_STROKE_BANDS = 4
const RAIN_LAYERS = [
  {
    particles: scatteredParticles(144, 611), minimum: 42, areaPerStreak: 6700,
    length: [7, 17], speed: [105, 235], width: [.48, .72], opacity: [.105, .205], slope: .16,
  },
  {
    particles: scatteredParticles(45, 977), minimum: 14, areaPerStreak: 21800,
    length: [13, 29], speed: [185, 380], width: [.82, 1.18], opacity: [.24, .39], slope: .21,
  },
] as const

function paintRain(
  context: CanvasRenderingContext2D, width: number, height: number,
  time: number, amount: number, detail: number, color: Rgb,
) {
  // Streaks complete their fall outside the viewport before re-entering at the opposite edge.
  const margin = 36
  const spanX = width + margin * 2
  const spanY = height + margin * 2
  context.save()
  context.lineCap = 'round'
  for (const layer of RAIN_LAYERS) {
    const count = Math.round(clamp(width * height / layer.areaPerStreak, layer.minimum, layer.particles.length) * detail)
    // Batch similar strokes to keep the denser rain cheap to draw.
    for (let band = 0; band < RAIN_STROKE_BANDS; band++) {
      const style = band / (RAIN_STROKE_BANDS - 1)
      context.lineWidth = mix(layer.width[0], layer.width[1], style)
      context.strokeStyle = rgba(color, amount * mix(layer.opacity[0], layer.opacity[1], style))
      context.beginPath()
      for (let index = band; index < count; index += RAIN_STROKE_BANDS) {
        const { x, y, size, pace, phase } = layer.particles[index]
        const slope = layer.slope + (phase - .5) * .10
        const distance = time * mix(layer.speed[0], layer.speed[1], pace)
        const xx = wrap(x - distance * slope / spanX) * spanX - margin
        const yy = wrap(y + distance / spanY) * spanY - margin
        const length = mix(layer.length[0], layer.length[1], size)
        context.moveTo(xx, yy)
        context.lineTo(xx - length * slope, yy + length)
      }
      context.stroke()
    }
  }
  context.restore()
}

function paintSnow(
  context: CanvasRenderingContext2D, width: number, height: number, time: number,
  amount: number, detail: number, color: Rgb,
) {
  const count = Math.round(Math.min(PARTICLES.length, 24 + width * .028) * detail)
  for (let i = 0; i < count; i++) {
    const { x, y, size, pace, phase } = PARTICLES[i]
    const near = i % 6 === 0
    const breeze = Math.sin(time * (.34 + pace * .22) + phase * TWO_PI) * (.021 + pace * .029)
    const xx = wrap(x + breeze + time * (.003 + pace * .008)) * width
    const yy = wrap(y + time * (near ? .034 + pace * .021 : .013 + pace * .015)) * (height + 22) - 11
    const radius = near ? 1.35 + size ** 2 * 1.45 : .53 + size ** 2 * 1.0
    const alpha = amount * (near ? .38 + size * .33 : .23 + size * .37)
    if (near) glow(context, xx, yy, radius * 2.45, color, alpha * .35)
    context.fillStyle = rgba(color, alpha)
    context.beginPath()
    context.arc(xx, yy, radius, 0, TWO_PI)
    context.fill()
  }
}

/** Paint one frame into the same canvas used by the glass's live refraction and color sampling. */
export function createBackground(canvas: HTMLCanvasElement) {
  const canvasContext = canvas.getContext('2d', { alpha: false })
  if (!canvasContext) throw new Error('Unable to start the background canvas.')
  const context = canvasContext
  const liquid = createLiquidSurface()
  let width = 1, height = 1
  let clouds: readonly HTMLCanvasElement[] | null = null
  let sunnySky: ReturnType<typeof createSunnySky> | null = null

  function resize(cssWidth: number, cssHeight: number, pixelRatio: number) {
    width = Math.max(1, cssWidth)
    height = Math.max(1, cssHeight)
    const pixelWidth = Math.max(1, Math.round(width * pixelRatio))
    const pixelHeight = Math.max(1, Math.round(height * pixelRatio))
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight
  }

  function render(frame: BackgroundFrame) {
    const { time, phase, cloudTime, cloudDriftTime, climate, audio, detail } = frame
    const daylight = climate.sunlight
    const narrow = clamp((1.9 - width / height) / 1.2)
    const palette = climate.palette
    const [air, satin] = palette.light
    const sunX = .805 + narrow * .025
    const cloudCenter = .49 + .17 * Math.sin((cloudTime - cloudDriftTime) * .048 + 2.1)
    const shadowExtent = .48
    const cloudX = driftCloud(cloudCenter - shadowExtent, shadowExtent * 2, cloudDriftTime * .17 * .048) + shadowExtent

    context.setTransform(canvas.width, 0, 0, canvas.height, 0, 0)
    context.fillStyle = gradient(context, [.12, 0, .85, 1], palette.sky, SKY)
    context.fillRect(0, 0, 1, 1)
    glow(context, .64 + Math.cos(time * .08) * .058, .194, .61, air, .30)
    glow(context, .86, .46, .54, satin, .14)
    if (daylight > .002) {
      sunnySky ??= createSunnySky()
      const sunY = Math.max(.175 + narrow * .022, 93 / height)
      context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0)
      sunnySky(context, width, height, time, sunX, sunY, daylight)
      context.setTransform(canvas.width, 0, 0, canvas.height, 0, 0)
    }
    if (climate.cloudCover > .035) {
      clouds ??= [cloudStamp(23, .15), cloudStamp(71, .87)]
      paintClouds(context, clouds, cloudTime, cloudDriftTime, climate.cloudCover)
    }

    liquid.render(context, width, height, detail, phase, climate, audio, cloudX, undefined, time)
    glow(context, .03, .21, .37, [6, 14, 30], .63 * (1 - daylight))
    glow(context, .98, .025, .34, [5, 16, 35], .52 * (1 - daylight))

    context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0)
    if (climate.rainfall > .002) paintRain(context, width, height, time, climate.rainfall, detail, palette.foam[2])
    if (climate.snowfall > .002) paintSnow(context, width, height, time, climate.snowfall, detail, palette.foam[2])
  }

  return { canvas, resize, render, destroy: liquid.destroy }
}
