/* Grid, trimmed luminance, and contrast hysteresis adapted from Glasswork under MIT. */
import type { BackgroundReading } from './material'
import { layerDepth, project, type Projection } from './projection'
import type { Point } from './shape'

const GRID = [.24, .5, .76].flatMap(y => [.18, .34, .5, .66, .82].map(x => ({ x, y })))
const INK_GRID = [.72, .78, .85].flatMap(y => [.1, .2, .3, .4, .5].map(x => ({ x, y })))

export function samplePositions(projection: Projection, layer: 'blur' | 'ink' = 'blur') {
  const { width, height } = projection.geometry
  const depth = layerDepth(projection, layer === 'ink' ? 5 : 1)
  const grid = layer === 'ink' ? INK_GRID : GRID
  return grid.map(point => project(projection, {
    x: (point.x - .5) * width,
    y: (point.y - .5) * height,
  }, depth))
}

export function createBackgroundSampler() {
  const probe = document.createElement('canvas')
  probe.width = 5
  probe.height = 3
  const context = probe.getContext('2d', { willReadFrequently: true })!

  return (source: HTMLCanvasElement, points: Point[], width: number, height: number): BackgroundReading => {
    for (const [index, point] of points.entries()) {
      const px = Math.max(0, Math.min(source.width - 1, Math.round(point.x * source.width / width)))
      const py = Math.max(0, Math.min(source.height - 1, Math.round(point.y * source.height / height)))
      context.drawImage(source, px, py, 1, 1, index % 5, Math.floor(index / 5), 1, 1)
    }
    const pixels = context.getImageData(0, 0, 5, 3).data
    const values = points.map((_, index) => {
      const [r, g, b] = pixels.subarray(index * 4, index * 4 + 3)
      return (r * .2126 + g * .7152 + b * .0722) / 255
    }).sort((a, b) => a - b)
    const middle = values.slice(2, -2)
    const mean = middle.reduce((sum, value) => sum + value, 0) / middle.length
    let chroma = 0
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b] = pixels.subarray(i, i + 3)
      chroma += Math.max(r, g, b) - Math.min(r, g, b)
    }
    return { luminance: mean, texture: values[12] - values[2], chroma: chroma / (255 * points.length) }
  }
}
