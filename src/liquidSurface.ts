import type { AudioInput } from './background'
import type { Climate } from './climate'
import { clamp, mix } from './material'

const SOFT_FOLDS = [
  { center: .55, incline: .29, radius: .248, bulge: .195, curl: .087, rate: .72, offset: 2.6 },
  { center: .69, incline: -.49, radius: .306, bulge: .227, curl: .123, rate: .91, offset: -.8 },
  { center: .932, incline: .27, radius: .326, bulge: .266, curl: .119, rate: 1.09, offset: .8 },
] as const

type Fold = typeof SOFT_FOLDS[number]
type Section = { center: number; radius: number; bulge: number; twist: number; depth: number; curl: number; axis: number }

function smooth(value: number) {
  const t = clamp(value)
  return t * t * (3 - 2 * t)
}

export function getLiquidMotion(audio: AudioInput) {
  const drive = Math.sqrt(clamp(audio.energy))
  const swell = clamp(audio.low) * drive
  const bend = clamp(audio.mid) * drive
  const shimmer = Math.sqrt(clamp(audio.high)) * drive
  return { swell, bend, shimmer, speed: 1 + .96 * swell + .23 * bend }
}

type Motion = ReturnType<typeof getLiquidMotion>

function section(fold: Fold, x: number, distance: number, phase: number, amplitude: number, motion: Motion): Section {
  // Move along an unbounded continuous profile. The small shape drift uses the
  // same clock so the bulges, thickness and reflected light travel together.
  const u = (x - distance * fold.rate) * 5.1 + fold.offset
  const slow = u * .58 + fold.offset * .47 + phase * .071
  const asymmetry = Math.sin(slow)
  const curve = Math.sin(u + (.46 + .57 * motion.bend) * asymmetry)
  const pinch = Math.cos(u * 1.32 - phase * .10 + .8)
  const breadth = Math.cos(slow + .78)
  const swell = amplitude * (1 + .66 * motion.swell)
  return {
    center: fold.center + fold.incline * (x - .5) + swell * (.115 * curve + .052 * asymmetry),
    radius: fold.radius * (1 + swell * (.28 * breadth + (.13 + .09 * motion.bend) * pinch)),
    bulge: fold.bulge * (1 + swell * (.33 * asymmetry + .12 * curve)),
    twist: swell * (.077 * pinch + (.051 + .053 * motion.bend) * breadth),
    depth: swell * (.061 * curve + .041 * asymmetry),
    curl: fold.curl * (.79 + swell * (.36 * curve + .20 * pinch)),
    axis: -.22 + swell * ((.24 + motion.bend * .12) * asymmetry + .08 * pinch),
  }
}

export function createLiquidSurface() {
  const texture = document.createElement('canvas')
  const context = texture.getContext('2d')!
  let image: ImageData | undefined

  function render(
    target: CanvasRenderingContext2D, width: number, height: number, detail: number,
    phase: number, climate: Climate, audio: AudioInput, cloudX: number,
  ) {
    const fieldWidth = Math.max(2, Math.min(Math.round(476 * detail), Math.round(width * .7)))
    const fieldHeight = Math.max(2, Math.min(Math.round(366 * detail), Math.round(height * .75)))
    if (!image || image.width !== fieldWidth || image.height !== fieldHeight) {
      texture.width = fieldWidth
      texture.height = fieldHeight
      image = context.createImageData(fieldWidth, fieldHeight)
    }

    const { palette, sunlight, cloudCover } = climate
    const motion = getLiquidMotion(audio)
    const distance = phase * .105
    const aspect = width / height
    const halfPixel = .5 / fieldHeight
    const stride = fieldWidth * 4
    const pixels = image.data
    const diffuseX = .30 + .13 * sunlight
    const diffuseY = -.48
    const diffuseZ = Math.sqrt(1 - diffuseX * diffuseX - diffuseY * diffuseY)
    const shades = [palette.distant[0], palette.fold[0], palette.undertow[0]]
    const bodies = [palette.distant[2], palette.current[2], palette.current[1]]

    // The overlapping contours are the visible sections of three rounded
    // surfaces at separate depths. The nearest face hides the parts behind it.
    for (const [index, fold] of SOFT_FOLDS.entries()) {
      const shade = shades[index]
      const body = bodies[index]
      const lit = palette.light[1]
      const tint = palette.light[0]
      const next = SOFT_FOLDS[index + 1]
      const transmitted = index === 0 ? .055 : index === 1 ? .043 : .028
      const amplitude = climate.waveAmplitude
      const step = 1 / fieldWidth
      const derivativeScale = .5 * fieldWidth / aspect
      let previous = section(fold, -.5 * step, distance, phase, amplitude, motion)
      let current = section(fold, .5 * step, distance, phase, amplitude, motion)
      pixels.fill(0)

      for (let column = 0; column < fieldWidth; column++) {
        const x = (column + .5) * step
        const after = section(fold, x + step, distance, phase, amplitude, motion)
        const { center, radius, bulge, twist, curl, axis } = current
        const dCenter = (after.center - previous.center) * derivativeScale
        const dRadius = (after.radius - previous.radius) * derivativeScale
        const dBulge = (after.bulge - previous.bulge) * derivativeScale
        const dTwist = (after.twist - previous.twist) * derivativeScale
        const dDepth = (after.depth - previous.depth) * derivativeScale
        const dCurl = (after.curl - previous.curl) * derivativeScale
        const dAxis = (after.axis - previous.axis) * derivativeScale
        previous = current
        current = after

        const upper = center - radius
        const lower = center + radius
        const start = Math.max(0, Math.floor(upper * fieldHeight))
        const end = Math.min(fieldHeight, Math.ceil(lower * fieldHeight))
        const front = next && section(next, x, distance, phase, amplitude, motion)
        const frontEdge = front ? front.center - front.radius : 2
        const shadow = cloudCover * .09 / (1 + 12 * (x - cloudX) ** 2)
        const rayX = diffuseX - (x - .5) * .34
        const rayY = diffuseY - .17 + .09 * Math.sin(x * 2.6 + .7)
        const rayZ = diffuseZ + 1
        const halfScale = 1 / Math.hypot(rayX, rayY, rayZ)
        let pixel = start * stride + column * 4

        for (let row = start; row < end; row++, pixel += stride) {
          const y = (row + .5) / fieldHeight
          const s = clamp((y - center) / radius, -1, 1)
          const cap = Math.sqrt(1 - s * s)
          // Wrap a broad, off-centre fold into the rounded cross-section.
          // Both derivatives also account for the moving ridge inside the silhouette.
          const offset = s - axis
          const roll = 1 / (1 + 4.6 * offset * offset)
          const rollSlope = -9.2 * offset * roll * roll
          const thickness = bulge + twist * s + curl * roll
          const dSection = (twist + curl * rollSlope) * cap - thickness * s / Math.max(cap, .095)
          const slopeY = dSection / radius
          const slopeX = dDepth + (dBulge + dTwist * s + dCurl * roll - curl * rollSlope * dAxis) * cap
            - slopeY * (dCenter + s * dRadius)
          const normalZ = 1 / Math.sqrt(1 + slopeX * slopeX + slopeY * slopeY)
          const diffuse = clamp((diffuseZ - slopeX * diffuseX - slopeY * diffuseY) * normalZ)
          const reflected = clamp((rayZ - slopeX * rayX - slopeY * rayY) * normalZ * halfScale)
          const gloss = reflected * reflected
          const softLight = gloss * gloss
          const grazing = (1 - normalZ) * (1 - normalZ)
          const contact = 1 - smooth((frontEdge - y) / .115)
          const tone = clamp(.23 + diffuse * .52 + cap * .12 - contact * .15 - shadow)
          const sheen = clamp(softLight * .14 + softLight * softLight * (.32 + motion.shimmer * .13)
            + grazing * diffuse * .059, 0, .53)
          const edge = clamp((Math.min(y - upper, lower - y) + halfPixel) * fieldHeight)
          const opacity = edge * (1 - transmitted - grazing * .10)
          const red = mix(shade[0], body[0], tone)
          const green = mix(shade[1], body[1], tone)
          const blue = mix(shade[2], body[2], tone)
          pixels[pixel] = mix(red, mix(tint[0], lit[0], softLight), sheen)
          pixels[pixel + 1] = mix(green, mix(tint[1], lit[1], softLight), sheen)
          pixels[pixel + 2] = mix(blue, mix(tint[2], lit[2], softLight), sheen)
          pixels[pixel + 3] = opacity * 255
        }
      }

      context.putImageData(image, 0, 0)
      target.drawImage(texture, 0, 0, 1, 1)
    }
  }

  return { render }
}
