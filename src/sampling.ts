/* Grid and trimmed luminance adapted from Glasswork under MIT. */
import { playerLayout } from './playerLayout'
import { layerDepth, project, type Projection } from './projection'
import type { Point, ShapeId } from './shape'

const INK_GRID = [.30, .55, .81].flatMap(y => [.06, .26, .46, .66, .86].map(x => ({ x, y })))

export function sampleInkPositions(projection: Projection, appearance: ShapeId) {
  const { width, height } = projection.geometry
  const depth = layerDepth(projection, 5)
  const text = playerLayout(appearance).trackText
  return INK_GRID.map(point => project(projection, {
    x: (text.x + point.x * text.width - .5) * width,
    y: (text.y + point.y * text.height - .5) * height,
  }, depth))
}

export function createBackgroundSampler() {
  const probe = document.createElement('canvas')
  probe.width = 5
  probe.height = 3
  const context = probe.getContext('2d', { willReadFrequently: true })!

  return (source: HTMLCanvasElement, points: Point[], width: number, height: number) => {
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
    return middle.reduce((sum, value) => sum + value, 0) / middle.length
  }
}
