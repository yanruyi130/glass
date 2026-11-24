import type { AudioInput } from './background'
import type { Climate } from './climate'
import { clamp, mix } from './material'

const SURFACE_ROWS = 76

export function getLiquidMotion(audio: AudioInput) {
  const energy = Math.sqrt(clamp(audio.energy))
  const swell = clamp(audio.low) * energy
  const bend = clamp(audio.mid) * energy
  const shimmer = Math.sqrt(clamp(audio.high)) * energy
  return { swell, bend, shimmer, speed: 1 + .24 * energy + .69 * swell + .12 * bend }
}

type Motion = ReturnType<typeof getLiquidMotion>
type SurfaceSample = { v: number; rolled: number; sink: number; tail: number; shoulder: number }

function skin(x: number, phase: number, amplitude: number, motion: Motion) {
  const world = x - .116 * phase
  const angle = world * 4.64 + 1.58
  const sweep = Math.sin(.61 * angle + .91 + phase * .06)
  const run = angle + (.68 + .52 * motion.bend) * sweep
  const bend = Math.cos(run)
  const shoulder = Math.sin(1.34 * angle + .29 - phase * .073)
  const lift = amplitude * (1 + .77 * motion.swell)
  return {
    world,
    near: x - .069 * phase,
    lift,
    rim: .44 + lift * (.206 * bend - .093 * shoulder),
    fold: .155 + lift * (.036 * sweep + .051 * shoulder),
    base: lift * (.072 * bend + .026 * sweep),
    shear: .13 * shoulder + (.07 + .12 * motion.bend) * sweep,
    foldAxis: .288 + (.072 + .036 * motion.bend) * sweep + .060 * shoulder,
    foldLift: (.13 + .095 * bend + .072 * shoulder) * lift,
    light: clamp(.35 + .35 * Math.cos(run - .33) + .39 * Math.cos(.83 * angle - .8)),
  }
}

// A section through the sheet has a rolling lip, a returning slope and a
// broad basin. Its projected Y can turn back at the lip, exposing both faces.
function sampleSurface(
  points: Float32Array, offset: number, section: ReturnType<typeof skin>,
  sample: SurfaceSample, phase: number,
) {
  const { world, near, lift, rim, fold, base, shear, foldAxis, foldLift } = section
  const { v, rolled, sink, tail } = sample
  const turn = world + shear * v + .21 * v * v
  const nearTurn = near + shear * v * .65 + .14 * v * v
  const flare = .5 + .5 * Math.cos(nearTurn * 6.64 - .90 + phase * .048)
  const shoulders = flare * flare
  const hollow = (1 - flare) * (1 - flare)
  const slope = .5 + .5 * Math.sin(turn * 4.07 - 4.28 * v + .8)
  const distance = (v - foldAxis) * 7.2
  const dome = 1 / (1 + distance * distance)
  const innerFold = foldLift * dome * dome * (1 - v)
  const nearFold = lift * shoulders * sample.shoulder
  const depth = base + .27 * v + (.074 + fold * .42) * tail + innerFold
    + lift * ((.56 * shoulders - .17 * hollow) * sink + .086 * slope * v * (1 - v)) + nearFold * .12
  points[offset] = rim + (1.34 - rim) * v - fold * rolled + innerFold * .41 - nearFold * .16
    + lift * (.058 * hollow - .165 * shoulders) * sink
  points[offset + 1] = depth
  points[offset + 2] = 1.02 * shoulders * sink + .13 * slope * v + innerFold * 1.72 + .020 * (1 - sink)
}

export function createLiquidSurface() {
  const texture = document.createElement('canvas')
  const context = texture.getContext('2d')!
  const samples = Array.from({ length: SURFACE_ROWS + 1 }, (_, index): SurfaceSample => {
    // More vertices at the curved lip, where the surface can fold over itself.
    const v = (index / SURFACE_ROWS) ** 1.54
    return {
      v,
      rolled: (1 - Math.exp(-26 * v)) * Math.exp(-5.9 * v),
      sink: v * v * (3 - 2 * v),
      tail: 1 - Math.exp(-12 * v),
      shoulder: (1 + ((v - .77) * 8.4) ** 2) ** -2,
    }
  })
  const lighting = new Float32Array(samples.length * 2)
  let points = new Float32Array(0)
  let depthBuffer = new Float32Array(0)
  let image: ImageData | undefined

  function render(
    target: CanvasRenderingContext2D, width: number, height: number, detail: number,
    phase: number, climate: Climate, audio: AudioInput, cloudX: number,
  ) {
    const columns = Math.max(2, Math.min(Math.round(450 * detail), Math.round(width * .71)))
    const rows = Math.max(2, Math.min(Math.round(348 * detail), Math.round(height * .72)))
    const columnStride = samples.length * 3
    if (!image || image.width !== columns || image.height !== rows) {
      texture.width = columns
      texture.height = rows
      image = context.createImageData(columns, rows)
      points = new Float32Array((columns + 2) * columnStride)
      depthBuffer = new Float32Array(rows)
    }

    const motion = getLiquidMotion(audio)
    const { palette, cloudCover, sunlight, waveAmplitude } = climate
    const xStep = (2 * width / height) / columns
    const pixels = image.data
    const stride = columns * 4
    pixels.fill(0)

    for (let column = -1; column <= columns; column++) {
      const section = skin((column + .5) / columns, phase, waveAmplitude, motion)
      const offset = (column + 1) * columnStride
      for (let j = 0; j < samples.length; j++) {
        sampleSurface(points, offset + 3 * j, section, samples[j], phase)
      }
    }

    const shade = palette.undertow[0]
    const body = palette.current[2]
    const glint = palette.light[1]
    const lip = palette.foam[2]
    const lightX = .25 + .17 * sunlight
    const lightY = -.52
    const lightZ = Math.sqrt(1 - lightX * lightX - lightY * lightY)

    for (let column = 0; column < columns; column++) {
      const x = (column + .5) / columns
      const offset = (column + 1) * columnStride
      const shadow = cloudCover * .095 / (1 + 13 * (x - cloudX) ** 2)
      const hx = lightX - (x - .5) * .34
      const hy = lightY + .06
      const hz = lightZ + 1
      const reflectionScale = 1 / Math.hypot(hx, hy, hz)
      const section = skin(x, phase, waveAmplitude, motion)
      let crest = Infinity
      depthBuffer.fill(-Infinity)

      for (let j = 0; j < samples.length; j++) {
        const p = offset + 3 * j
        const before = j > 0 ? p - 3 : p
        const after = j < SURFACE_ROWS ? p + 3 : p
        const dy = points[after] - points[before]
        const dz = points[after + 1] - points[before + 1]
        const acrossY = points[p + columnStride] - points[p - columnStride]
        const acrossZ = points[p + columnStride + 1] - points[p - columnStride + 1]
        const face = dy < 0 ? -1 : 1
        const nx = (acrossY * dz - acrossZ * dy) * face
        const ny = -xStep * dz * face
        const nz = xStep * dy * face
        const inverse = 1 / Math.sqrt(Math.max(1e-16, nx * nx + ny * ny + nz * nz))
        const diffuse = clamp((nx * lightX + ny * lightY + nz * lightZ) * inverse)
        const reflected = clamp((nx * hx + ny * hy + nz * hz) * inverse * reflectionScale)
        const grazing = 1 - nz * inverse
        const { v } = samples[j]
        const form = points[p + 2]
        const gloss = reflected ** 4
        const film = gloss * gloss * (.27 + .065 * motion.shimmer)
        const rimLight = clamp(1 - v / .15) * grazing ** 6 * section.light * (.25 + .05 * motion.shimmer)
        lighting[j * 2] = clamp(.10 + .30 * diffuse + .73 * form - shadow)
        lighting[j * 2 + 1] = (film + gloss * .15) * (.26 + .74 * form) + rimLight
        crest = Math.min(crest, points[p] * rows)
      }

      // Project the continuous section and resolve front/back by depth. The
      // light band is carried by the same curved surface that hides the fold.
      for (let j = 0; j < SURFACE_ROWS; j++) {
        const p = offset + 3 * j
        const start = points[p] * rows
        const end = points[p + 3] * rows
        if (Math.abs(end - start) < .001) continue
        const d = 1 / (end - start)
        const top = Math.max(0, Math.ceil(Math.min(start, end) - .5))
        const bottom = Math.min(rows, Math.ceil(Math.max(start, end) - .5))
        const a = lighting[j * 2], b = lighting[j * 2 + 2]
        const sa = lighting[j * 2 + 1], sb = lighting[j * 2 + 3]
        let index = top * stride + column * 4
        for (let y = top; y < bottom; y++, index += stride) {
          const f = clamp((y + .5 - start) * d)
          const depth = mix(points[p + 1], points[p + 4], f)
          if (depth <= depthBuffer[y]) continue
          depthBuffer[y] = depth
          const tone = mix(a, b, f)
          const edge = (1 - clamp((y + .5 - crest) / 1.75)) * section.light
          const sheen = clamp(mix(sa, sb, f) + edge * .82, 0, .76)
          const absorption = .80 + tone * .20
          const red = mix(shade[0], body[0], tone) * absorption
          const green = mix(shade[1], body[1], tone) * absorption
          const blue = mix(shade[2], body[2], tone) * absorption
          pixels[index] = mix(red, mix(glint[0], lip[0], edge * .68), sheen)
          pixels[index + 1] = mix(green, mix(glint[1], lip[1], edge * .68), sheen)
          pixels[index + 2] = mix(blue, mix(glint[2], lip[2], edge * .68), sheen)
          pixels[index + 3] = 250
        }
      }

      // Cover the first partial scanline at the silhouette. Interpolating the
      // coverage alone keeps its narrow reflection stable at different sizes.
      const edgeRow = Math.floor(crest)
      if (edgeRow >= 0 && edgeRow < rows - 1) {
        const index = edgeRow * stride + column * 4
        if (pixels[index + 3] === 0) {
          pixels[index] = pixels[index + stride]
          pixels[index + 1] = pixels[index + stride + 1]
          pixels[index + 2] = pixels[index + stride + 2]
        }
        pixels[index + 3] = (edgeRow + 1 - crest) * 250
      }
    }
    context.putImageData(image, 0, 0)
    target.drawImage(texture, 0, 0, 1, 1)
  }

  return { render }
}
