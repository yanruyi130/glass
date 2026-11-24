import type { AudioInput } from './background'
import type { Climate } from './climate'
import { clamp, mix } from './material'

const FOLDS = [
  { offset: 0, rate: .67, phase: .35, depth: .175, height: .082, color: 'cobalt' },
  { offset: .118, rate: .86, phase: 1.94, depth: .20, height: .112, color: 'current' },
  { offset: .261, rate: .73, phase: 3.17, depth: .236, height: .138, color: 'fold' },
  { offset: .413, rate: .55, phase: 4.08, depth: .27, height: .123, color: 'undertow' },
] as const

const MAIN_FOLD = 1
const smooth = (value: number) => {
  const t = clamp(value)
  return t * t * (3 - 2 * t)
}

// Cross-section through a raised fold and the trough behind it. The derivatives
// of this section and the moving crest give the actual surface normals.
const SECTION_LAST = 319
const SECTION_SCALE = 92
const SECTION_START = -.25
const elevation = new Float32Array(SECTION_LAST + 1)
const derivative = new Float32Array(SECTION_LAST + 1)
for (let index = 0; index <= SECTION_LAST; index++) {
  const cross = SECTION_START + index / SECTION_SCALE
  const ridge = (cross - .60) * 1.38
  const trough = (cross - 1.76) * 1.18
  const raised = Math.exp(-ridge * ridge)
  const recessed = .47 * Math.exp(-trough * trough)
  elevation[index] = raised - recessed
  derivative[index] = -2.76 * ridge * raised + 2.36 * trough * recessed
}

const columns = (width: number) => ({
  crest: new Float32Array(width + 2),
  depth: new Float32Array(width + 2),
  height: new Float32Array(width + 2),
})

export function createLiquidSurface() {
  const texture = document.createElement('canvas')
  const context = texture.getContext('2d')!
  let image: ImageData | undefined
  let profiles = FOLDS.map(() => columns(0))

  function render(
    target: CanvasRenderingContext2D, width: number, height: number, detail: number,
    phase: number, climate: Climate, audio: AudioInput, cloudX: number,
  ) {
    // Shade a small, smooth field before scaling it into the live stage canvas.
    const fieldWidth = Math.max(2, Math.min(Math.round(420 * detail), Math.round(width * .55)))
    const fieldHeight = Math.max(2, Math.min(Math.round(266 * detail), Math.round(height * .58)))
    if (!image || image.width !== fieldWidth || image.height !== fieldHeight) {
      texture.width = fieldWidth
      texture.height = fieldHeight
      image = context.createImageData(fieldWidth, fieldHeight)
      profiles = FOLDS.map(() => columns(fieldWidth))
    }
    const pixels = image.data
    pixels.fill(0)
    const narrow = clamp((1.85 - width / height) / 1.1)
    const drive = Math.sqrt(clamp(audio.energy))
    const swell = clamp(audio.low) * drive
    const bend = clamp(audio.mid) * drive
    const shimmer = Math.sqrt(clamp(audio.high)) * drive
    const aspect = height / width
    const { palette } = climate

    for (const [layer, fold] of FOLDS.entries()) {
      const { crest, depth, height: rise } = profiles[layer]
      const t = phase * fold.rate + fold.phase

      // Each crest travels through a moving field across x. A slower opposing
      // mode broadens and narrows the folds without shifting the whole picture.
      for (let column = 0; column < crest.length; column++) {
        const x = (column - .5) / fieldWidth
        const traveling = 5.6 * x - t
        const counter = 8.25 * x + .47 * t + fold.phase
        const curl = Math.sin(3.9 * x - .67 * t + 1.5)
        const broad = .058 * Math.sin(traveling) + .032 * Math.sin(counter)
        const musicShape = .046 * swell * Math.sin(traveling - .5)
          + .064 * bend * Math.sin(7.3 * x - .72 * t + fold.phase)
          + .0045 * shimmer * Math.sin(19 * x - 1.38 * t)
        const approach = .78 - .46 * x + .132 * Math.sin(5.45 * x + 1.06)
          + .042 * Math.sin(4.8 * x + fold.phase)
        const perspective = narrow * (.028 * x - .112 * (1 - x))
        crest[column] = approach + fold.offset + perspective + .034 * climate.sunlight
          + climate.waveAmplitude * (broad + musicShape)
        depth[column] = fold.depth * (1 + .22 * curl + .30 * bend * Math.cos(traveling - .9))
        rise[column] = fold.height * (1 + .19 * Math.sin(traveling + .85) + .65 * swell)
      }

      const [shadow, , body] = palette[fold.color]
      const [air, tint, sun] = palette.light
      const sparkle = .52 + .33 * Math.sin(.62 * t + .2)
      const edgeSoftness = layer === 0 ? .024 : .062 + layer * .007
      const lightColor = layer === 0 ? air : layer === MAIN_FOLD ? palette.foam[1] : tint
      const shadowOpacity = .17 * climate.cloudCover

      for (let x = 0; x < fieldWidth; x++) {
        const at = x + 1
        const u = (x + .5) / fieldWidth
        const edge = crest[at] - edgeSoftness * .42
        const widthOfFold = depth[at]
        const heightOfFold = rise[at]
        const edgeSlope = (crest[at + 1] - crest[at - 1]) * .5 * fieldWidth
        const depthSlope = (depth[at + 1] - depth[at - 1]) * .5 * fieldWidth
        const heightSlope = (rise[at + 1] - rise[at - 1]) * .5 * fieldWidth
        const curvature = clamp((crest[at + 1] - 2 * crest[at] + crest[at - 1]) * fieldWidth * fieldWidth * .16, -.65, .65)
        const reflected = .24 + .76 / (1 + 19 * (u - sparkle) ** 2)
        const warm = climate.sunlight * .11 / (1 + 35 * (u - .805) ** 2)
        const cloud = 1 - shadowOpacity / (1 + 12 * (u - cloudX) ** 2)
        const lightR = mix(lightColor[0], sun[0], warm)
        const lightG = mix(lightColor[1], sun[1], warm)
        const lightB = mix(lightColor[2], sun[2], warm)

        for (let y = Math.max(0, Math.floor(edge * fieldHeight)); y < fieldHeight; y++) {
          const v = (y + .5) / fieldHeight
          const opacity = smooth((v - edge) / edgeSoftness)
          if (opacity <= 0) continue
          const cross = (v - crest[at]) / widthOfFold
          const section = Math.min(SECTION_LAST, Math.max(0, Math.round((cross - SECTION_START) * SECTION_SCALE)))
          const dy = derivative[section] * heightOfFold / widthOfFold
          const dx = aspect * (heightSlope * elevation[section] - dy * (edgeSlope + cross * depthSlope))
          const normal = 1 / Math.sqrt(1 + dx * dx + dy * dy)

          // Soft key light, wide reflected light, and a smaller gloss on the
          // turning face. Lighting follows the same field as the silhouette.
          const diffuse = clamp((.78 + .36 * dx - .51 * dy) * normal)
          const reflection = clamp((.88 - .34 * dx + .33 * dy) * normal)
          const broadLight = reflection ** 4
          const glossyLight = broadLight * broadLight * reflection * reflection
          const face = .87 + .16 * elevation[section] + .085 * curvature
          const tone = clamp((.055 + .82 * diffuse) * face)
          const gloss = clamp((.22 * broadLight + (.48 + .13 * shimmer) * glossyLight)
            * reflected * (.78 + .32 * elevation[section]), 0, .57)
          const shade = cloud * (.84 + .16 * diffuse)
          const pixel = (y * fieldWidth + x) * 4
          const alpha = opacity + pixels[pixel + 3] / 255 * (1 - opacity)
          const blend = opacity / alpha
          pixels[pixel] = mix(pixels[pixel], mix(mix(shadow[0], body[0], tone) * shade, lightR, gloss), blend)
          pixels[pixel + 1] = mix(pixels[pixel + 1], mix(mix(shadow[1], body[1], tone) * shade, lightG, gloss), blend)
          pixels[pixel + 2] = mix(pixels[pixel + 2], mix(mix(shadow[2], body[2], tone) * shade, lightB, gloss), blend)
          pixels[pixel + 3] = alpha * 255
        }
      }
    }
    context.putImageData(image, 0, 0)
    target.drawImage(texture, 0, 0, 1, 1)
  }

  function crestAt(x: number) {
    const { crest } = profiles[MAIN_FOLD]
    const position = clamp(x) * (crest.length - 2) + .5
    const index = Math.floor(position)
    return mix(crest[index], crest[index + 1], position - index)
  }

  return { render, crestAt }
}
