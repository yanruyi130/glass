import type { AudioInput } from './background'
import type { Climate } from './climate'
import { clamp, mix } from './material'

const NEAR = .8
const FAR = 36
const RAIN_DEPTH = 3.6
const EYE_HEIGHT = 1.04
const FOCAL_LENGTH = .96
const TRAVEL_PER_PHASE = .56

// Every harmonic samples the same advected world X, with independent headings
// in depth. The field extends past both sides of the viewport without a wrap.
const WAVES = [
  { x: 1.65, z: .94, offset: .55, height: .132 },
  { x: 2.63, z: -1.22, offset: 2.02, height: .075 },
  { x: 4.17, z: 1.53, offset: 3.57, height: .031 },
  { x: 8.35, z: -3.71, offset: 1.48, height: .007 },
] as const

function smooth(value: number) {
  const t = clamp(value)
  return t * t * (3 - 2 * t)
}

export function getLiquidMotion(audio: AudioInput) {
  const drive = Math.sqrt(clamp(audio.energy))
  const swell = clamp(audio.low) * drive
  const bend = clamp(audio.mid) * drive
  const shimmer = Math.sqrt(clamp(audio.high)) * drive
  return { swell, bend, shimmer, speed: 1 + .88 * swell + .22 * bend }
}

function depthRows(count: number) {
  return Array.from({ length: count }, (_, index) => {
    // Equal inverse-depth steps have equal screen spacing on still water.
    const inverse = mix(1 / FAR, 1 / NEAR, index / (count - 1))
    const z = 1 / inverse
    return {
      z,
      projection: FOCAL_LENGTH * inverse,
      fade: smooth((z - 3) / 16),
      visibility: 1 - smooth((z - 12) / (FAR - 12)),
      ripple: 1 / (1 + .06 * z * z),
    }
  })
}

export function createLiquidSurface() {
  const texture = document.createElement('canvas')
  const context = texture.getContext('2d')!
  let image: ImageData | undefined
  let rows: ReturnType<typeof depthRows> = []
  let rainRow = 0
  let rainProfile = new Float32Array(0)

  function render(
    target: CanvasRenderingContext2D, width: number, height: number, detail: number,
    phase: number, climate: Climate, audio: AudioInput, cloudX: number,
  ) {
    const fieldWidth = Math.max(2, Math.min(Math.round(428 * detail), Math.round(width * .58)))
    const fieldHeight = Math.max(2, Math.min(Math.round(278 * detail), Math.round(height * .65)))
    if (!image || image.width !== fieldWidth || image.height !== fieldHeight) {
      texture.width = fieldWidth
      texture.height = fieldHeight
      image = context.createImageData(fieldWidth, fieldHeight)
      rows = depthRows(Math.max(67, Math.round(fieldHeight * .49)))
      rainRow = rows.findIndex(row => row.z <= RAIN_DEPTH)
      rainProfile = new Float32Array(fieldWidth)
    }

    const pixels = image.data
    pixels.fill(0)
    const stride = fieldWidth * 4
    const { palette } = climate
    const { swell, bend, shimmer } = getLiquidMotion(audio)
    const distance = phase * TRAVEL_PER_PHASE
    const aspect = width / height
    const narrow = clamp((1.55 - aspect) / 1.2)
    const horizon = (.345 + narrow * .048) * fieldHeight
    const waveAmplitude = climate.waveAmplitude
    const amplitudes = [
      WAVES[0].height * (1 + .79 * swell),
      WAVES[1].height * (1 + .65 * swell + .19 * bend),
      WAVES[2].height * (1 + 1.07 * bend),
      WAVES[3].height * (1 + .77 * shimmer),
    ]
    const distantBody = palette.distant[2]
    const distantShade = palette.cobalt[1]
    const nearBody = palette.current[1]
    const nearShade = palette.undertow[0]
    const glossColor = palette.light[1]

    for (let column = 0; column < fieldWidth; column++) {
      const screenX = (column + .5) / fieldWidth
      const lateral = (screenX - .5) * aspect / FOCAL_LENGTH
      const cloud = 1 - climate.cloudCover * .14 / (1 + 10 * (screenX - cloudX) ** 2)
      const sun = climate.sunlight * .14 / (1 + 17 * (screenX - .805) ** 2)
      let lastY = horizon, lastRed = distantBody[0], lastGreen = distantBody[1], lastBlue = distantBody[2], lastAlpha = 0

      // Each projected column is traversed from far to near. If a ridge folds
      // over a more distant slope, its nearer spans replace that slope.
      for (const [rowIndex, row] of rows.entries()) {
        const worldX = lateral * row.z - distance
        let elevation = 0, slopeX = 0, slopeZ = 0
        for (let component = 0; component < WAVES.length; component++) {
          const wave = WAVES[component]
          const depthResponse = component < 2 ? 1 - .57 * row.fade : row.ripple
          const amplitude = amplitudes[component] * waveAmplitude * depthResponse
          const angle = wave.x * worldX + wave.z * row.z + wave.offset
          const slope = amplitude * Math.cos(angle)
          elevation += amplitude * Math.sin(angle)
          slopeX += slope * wave.x
          slopeZ += slope * wave.z
        }

        const viewHeight = EYE_HEIGHT - elevation
        const screenY = horizon + viewHeight * row.projection * fieldHeight
        if (rowIndex === rainRow) rainProfile[column] = screenY / fieldHeight
        const normalScale = 1 / Math.sqrt(1 + slopeX * slopeX + slopeZ * slopeZ)
        const diffuse = clamp((.86 - .32 * slopeX + .40 * slopeZ) * normalScale)
        const viewY = viewHeight / row.z
        const viewScale = 1 / Math.sqrt(1 + lateral * lateral + viewY * viewY)
        const facing = clamp((slopeX * lateral + viewY + slopeZ) * normalScale * viewScale)

        // Half-vector specular follows the same slopes as the projected waves.
        const halfX = .19 - lateral * viewScale
        const halfY = .96 + viewY * viewScale
        const halfZ = -.21 - viewScale
        const reflected = clamp((halfY - slopeX * halfX - slopeZ * halfZ) * normalScale
          / Math.sqrt(halfX * halfX + halfY * halfY + halfZ * halfZ))
        const shine = reflected ** 5
        const fresnel = (1 - facing) ** 4
        const contrast = 1 - .61 * row.fade
        const tone = clamp(.51 + (diffuse - .72) * contrast + elevation * .56)
        const gloss = clamp((shine * .22 + shine * shine * (.36 + .13 * shimmer))
          * (1 - .55 * row.fade) + fresnel * (.07 + sun), 0, .57)
        const mist = row.fade * .78
        const red = mix(mix(mix(nearShade[0], distantShade[0], mist), mix(nearBody[0], distantBody[0], mist), tone) * cloud, glossColor[0], gloss)
        const green = mix(mix(mix(nearShade[1], distantShade[1], mist), mix(nearBody[1], distantBody[1], mist), tone) * cloud, glossColor[1], gloss)
        const blue = mix(mix(mix(nearShade[2], distantShade[2], mist), mix(nearBody[2], distantBody[2], mist), tone) * cloud, glossColor[2], gloss)
        const alpha = row.visibility * 255

        const top = Math.max(0, Math.ceil(Math.min(lastY, screenY) - .5))
        const bottom = Math.min(fieldHeight, Math.ceil(Math.max(lastY, screenY) - .5))
        if (top < bottom) {
          const step = 1 / (screenY - lastY)
          let fraction = (top + .5 - lastY) * step
          let pixel = top * stride + column * 4
          for (let y = top; y < bottom; y++, pixel += stride, fraction += step) {
            pixels[pixel] = mix(lastRed, red, fraction)
            pixels[pixel + 1] = mix(lastGreen, green, fraction)
            pixels[pixel + 2] = mix(lastBlue, blue, fraction)
            pixels[pixel + 3] = mix(lastAlpha, alpha, fraction)
          }
        }
        lastY = screenY
        lastRed = red
        lastGreen = green
        lastBlue = blue
        lastAlpha = alpha
      }
    }
    context.putImageData(image, 0, 0)
    target.drawImage(texture, 0, 0, 1, 1)
  }

  // Rain rings sample a stable middle distance in the same projected surface.
  function crestAt(x: number) {
    if (!rainProfile.length) return .63
    const position = clamp(x * rainProfile.length - .5, 0, rainProfile.length - 1)
    const index = Math.floor(position)
    return mix(rainProfile[index], rainProfile[Math.min(index + 1, rainProfile.length - 1)], position - index)
  }

  return { render, crestAt }
}
