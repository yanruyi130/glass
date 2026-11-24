import type { Climate, Rgb } from './climate'
import { createCoastalSea } from './coastalSea'
import { createCoastalSky } from './coastalSky'
import { clamp, mix } from './material'

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

type Point = readonly [number, number]
type Cubic = readonly [number, number, number, number, number, number]
type Curve = readonly [Point, Cubic, Cubic]
type Axis = readonly [number, number, number, number]

const FOUR = [0, .33, .66, 1]
const FIVE = [0, .27, .54, .74, 1]
const SKY = [0, .36, .7, 1]
const TWO_PI = Math.PI * 2
const COAST_HORIZON = .46

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

function trace(context: CanvasRenderingContext2D, curve: Curve, offset: number, reversed = false) {
  const [start, first, second] = curve
  if (reversed) {
    context.lineTo(second[4], second[5] + offset)
    context.bezierCurveTo(second[2], second[3] + offset, second[0], second[1] + offset, first[4], first[5] + offset)
    context.bezierCurveTo(first[2], first[3] + offset, first[0], first[1] + offset, start[0], start[1] + offset)
  } else {
    context.moveTo(start[0], start[1] + offset)
    for (const [x1, y1, x2, y2, x3, y3] of [first, second]) {
      context.bezierCurveTo(x1, y1 + offset, x2, y2 + offset, x3, y3 + offset)
    }
  }
}

function cubic(start: number, a: number, b: number, end: number, t: number) {
  const s = 1 - t
  return start * s ** 3 + 3 * a * s * s * t + 3 * b * s * t * t + end * t ** 3
}

function heightAt(curve: Curve, x: number) {
  const [start, first, second] = curve
  const [x0, y0] = x <= first[4] ? start : [first[4], first[5]]
  const [x1, y1, x2, y2, x3, y3] = x <= first[4] ? first : second
  let low = 0, high = 1
  for (let step = 0; step < 10; step++) {
    const middle = (low + high) / 2
    if (cubic(x0, x1, x2, x3, middle) < x) low = middle
    else high = middle
  }
  return cubic(y0, y1, y2, y3, (low + high) / 2)
}

function bend(curve: Curve, phase: number, amplitude: number, offset: number, detail: number): Curve {
  const y = (x: number, height: number) => height + amplitude * (
    Math.sin(x * 4.8 + phase + offset) * .017
      + Math.sin(x * 8.7 - phase * .76 + offset * 1.35) * .011
      + Math.sin(x * 13 + phase * 1.51 + offset) * (.002 + detail * .006)
  )
  const move = ([x1, y1, x2, y2, x3, y3]: Cubic): Cubic => [x1, y(x1, y1), x2, y(x2, y2), x3, y(x3, y3)]
  return [[curve[0][0], y(...curve[0])], move(curve[1]), move(curve[2])]
}

function sheetPath(context: CanvasRenderingContext2D, curve: Curve, offset: number) {
  context.beginPath()
  trace(context, curve, offset)
  context.lineTo(curve[2][4], 1.3)
  context.lineTo(curve[0][0], 1.3)
  context.closePath()
}

function sheet(context: CanvasRenderingContext2D, curve: Curve, offset: number, fill: CanvasGradient) {
  sheetPath(context, curve, offset)
  context.fillStyle = fill
  context.fill()
}

function sheetGlow(
  context: CanvasRenderingContext2D, curve: Curve, x: number, y: number, radius: number, color: Rgb, alpha: number,
) {
  if (alpha < .002) return
  context.save()
  sheetPath(context, curve, 0)
  context.clip()
  glow(context, x, y, radius, color, alpha)
  context.restore()
}

function ribbon(context: CanvasRenderingContext2D, curve: Curve, offset: number, width: number, fill: CanvasGradient) {
  context.beginPath()
  trace(context, curve, offset)
  trace(context, curve, offset + width, true)
  context.closePath()
  context.fillStyle = fill
  context.fill()
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
  context: CanvasRenderingContext2D, curve: Curve, width: number, height: number,
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

  for (let i = 0; i < Math.round(8 * detail); i++) {
    const { x, size, pace, phase } = PARTICLES[i + 48]
    const cycle = wrap(phase + time * (.17 + pace * .19))
    if (cycle >= .74) continue
    const age = cycle / .74
    const place = .29 + x * .66
    const yy = (heightAt(curve, place) + .043 + size * .07) * height
    const radius = 1.5 + (5 + size * 12) * age
    context.strokeStyle = rgba(color, amount * .37 * smooth(age * 8) * (1 - age) ** 1.8)
    context.lineWidth = .8
    context.beginPath()
    context.ellipse(place * width, yy, radius, radius * (.20 + size * .045), -.08, 0, TWO_PI)
    context.stroke()
  }
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
  let width = 1, height = 1
  let clouds: readonly HTMLCanvasElement[] | null = null
  let coastalSky: ReturnType<typeof createCoastalSky> | null = null
  let coastalSea: ReturnType<typeof createCoastalSea> | null = null
  const coastBuffer = document.createElement('canvas')
  const coastContext = coastBuffer.getContext('2d', { alpha: false })!

  function paintCoast(target: CanvasRenderingContext2D, { time, phase, detail, audio, climate }: BackgroundFrame) {
    const narrow = clamp((1.6 - width / height) / .9)
    const lightX = .805 + narrow * .025
    const lightY = Math.max(.175 + narrow * .022, 93 / height)
    target.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0)
    coastalSky ??= createCoastalSky()
    coastalSea ??= createCoastalSea()
    coastalSky(target, width, height, time, COAST_HORIZON, lightX, lightY)
    coastalSea(target, width, height, phase, detail, lightX, COAST_HORIZON, audio, climate.waveAmplitude, climate.sunlight)
  }

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
    if (daylight >= .999) {
      paintCoast(context, frame)
      return
    }
    const narrow = clamp((1.9 - width / height) / 1.2)
    const t = phase * .178
    const amplitude = climate.waveAmplitude * (1 + .29 * audio.low * audio.energy)

    const fine = audio.mid * audio.energy
    const glint = audio.high * audio.energy
    const cobalt = bend([
      [-.18, .96],
      [.07, .87, .22 + narrow * .05, .36, .51, .36],
      [.77, .35, .87, .38, 1.17, .06 + narrow * .2],
    ], t, amplitude, .21, fine)
    const current = bend([
      [-.18, 1.05 - narrow * .11],
      [.09, 1.03, .29 - narrow * .08, .42, .53, .49],
      [.78, .56, .91, .63 - narrow * .07, 1.16, .20 + narrow * .05],
    ], t, amplitude, .44, fine)
    const fold = bend([
      [-.18, 1.13 - narrow * .05],
      [.12, 1.13, .33, .62, .55, .65],
      [.79, .67, .87, .85, 1.17, .53],
    ], t, amplitude, 1.16, fine * .7)
    const undertow = bend([
      [-.18, 1.19],
      [.08, 1.18, .36, .89, .58, .85],
      [.78, .81, .92, 1.08, 1.17, .91],
    ], t, amplitude * .79, 1.64, fine * .5)

    const palette = climate.palette
    const [air, satin, accent] = palette.light
    const shade: Rgb = [11, 22, 45]
    const shineX = .60 + .083 * Math.sin(t * .74 + .32)
    const sheen = .94 + .06 * Math.sin(t * 1.28)
    const cloudCenter = .49 + .17 * Math.sin((cloudTime - cloudDriftTime) * .048 + 2.1)
    const shadowExtent = .48
    const cloudX = driftCloud(cloudCenter - shadowExtent, shadowExtent * 2, cloudDriftTime * .17 * .048) + shadowExtent

    context.setTransform(canvas.width, 0, 0, canvas.height, 0, 0)
    context.fillStyle = gradient(context, [.12, 0, .85, 1], palette.sky, SKY)
    context.fillRect(0, 0, 1, 1)
    glow(context, .64 + Math.cos(t * .42) * .058, .194, .61, air, .30)
    glow(context, .86, .46, .54, satin, .14)
    if (climate.cloudCover > .035) {
      clouds ??= [cloudStamp(23, .15), cloudStamp(71, .87)]
      paintClouds(context, clouds, cloudTime, cloudDriftTime, climate.cloudCover)
    }

    sheet(context, cobalt, -.043, gradient(context, [0, .36, 1, .71], palette.distant, FOUR))
    sheet(context, cobalt, 0, gradient(context, [.08, .32, .82, .86], palette.cobalt, FIVE))
    sheetGlow(context, cobalt, shineX, heightAt(cobalt, shineX) + .055, .41, air, .33 * sheen)
    sheetGlow(context, cobalt, .89, .56, .39, shade, .21)
    sheetGlow(context, cobalt, cloudX, heightAt(cobalt, cloudX) + .015, .33, shade, climate.cloudCover * .30)
    ribbon(context, cobalt, .004, .006, gradient(context, [.18, .48, 1, .26], [air, satin, satin, air], FOUR, [0, .51, .29, 0]))

    sheet(context, current, 0, gradient(context, [.11, .71, .91, .53], palette.current, FIVE))
    sheetGlow(context, current, shineX - .06, heightAt(current, shineX - .06) + .064, .32, satin, .25 * sheen + glint * .10)
    sheetGlow(context, current, cloudX + .12, heightAt(current, cloudX + .12) + .081, .36, shade, climate.cloudCover * .34)
    ribbon(context, current, -.011, .087, gradient(context, [.04, .8, .98, .37], [air, air, satin, satin], FOUR, [0, .23, .25, .08]))
    ribbon(context, current, .001, .027 + .0019 * glint, gradient(context, [.13, .7, .97, .48], palette.foam, FIVE, [.08, .42, .90, .56, .13]))
    const shimmer = glint > .002 ? bend(current, t * 1.5, glint * .08, 2.9, glint * .25) : current
    ribbon(context, shimmer, .001, .0027 + glint * .0011, gradient(context,
      [.21, .6, .88, .48], [accent, palette.foam[2], accent], [0, .5, 1], [0, .94, 0]))
    ribbon(context, current, .038, .0035, gradient(context, [.25, .71, .89, .53], [air, shade, air], [0, .44, 1], [0, .28, 0]))

    sheet(context, fold, -.013, gradient(context, [.12, .92, .9, .69], palette.foldRim, FOUR))
    sheet(context, fold, .008, gradient(context, [.21, .58, .81, 1.04], palette.fold, FOUR))
    sheetGlow(context, fold, shineX + .025, heightAt(fold, shineX) + .055, .43, air, .22)
    ribbon(context, fold, .008, .004, gradient(context, [.26, .9, 1, .66], [air, satin, air], [0, .42, 1], [0, .57, 0]))

    sheet(context, undertow, 0, gradient(context, [.12, .92, 1, .98], palette.undertow, FOUR))
    glow(context, .03, .21, .37, [6, 14, 30], .63)
    glow(context, .98, .025, .34, [5, 16, 35], .52)

    context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0)
    if (climate.rainfall > .002) paintRain(context, current, width, height, time, climate.rainfall, detail, palette.foam[2])
    if (climate.snowfall > .002) paintSnow(context, width, height, time, climate.snowfall, detail, palette.foam[2])

    if (daylight > .002) {
      if (coastBuffer.width !== canvas.width) coastBuffer.width = canvas.width
      if (coastBuffer.height !== canvas.height) coastBuffer.height = canvas.height
      paintCoast(coastContext, frame)
      context.save()
      context.globalAlpha = daylight
      context.drawImage(coastBuffer, 0, 0, width, height)
      context.restore()
    }
  }

  return { canvas, resize, render, destroy: () => coastalSea?.dispose() }
}
