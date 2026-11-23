import { clamp } from './material'
import type { GlassShape, Point, ShapeGeometry } from './shape'

type Vector = [number, number, number]
export const CAMERA = 1150

export interface Projection {
  center: Point
  axes: [Vector, Vector, Vector]
  geometry: ShapeGeometry
  scale: number
  spread: number
  open: number
}

export const layerDepth = (projection: Projection, index: number) => (index - 2.5) * projection.spread

export function project(projection: Projection, point: Point, depth: number): Point {
  const { axes: [u, v, n], scale, center } = projection
  const x = (u[0] * point.x + v[0] * point.y + n[0] * depth) * scale
  const y = (u[1] * point.x + v[1] * point.y + n[1] * depth) * scale
  const z = (u[2] * point.x + v[2] * point.y + n[2] * depth) * scale
  const w = 1 - z / CAMERA
  return { x: center.x + x / w, y: center.y + y / w }
}

export function projectedBounds(projection: Projection) {
  const { width, height } = projection.geometry
  const points = [0, 5].flatMap(index => [-1, 1].flatMap(x => [-1, 1].map(y =>
    project(projection, { x: x * width / 2, y: y * height / 2 }, layerDepth(projection, index)),
  )))
  return {
    left: Math.min(...points.map(point => point.x)), right: Math.max(...points.map(point => point.x)),
    top: Math.min(...points.map(point => point.y)), bottom: Math.max(...points.map(point => point.y)),
  }
}

export function makeProjection(width: number, height: number, shape: GlassShape, open: number, gap: number, offset: Point): Projection {
  const tilt = open * .95
  const rotation = open * -.32
  const cx = Math.cos(tilt), sx = Math.sin(tilt), cz = Math.cos(rotation), sz = Math.sin(rotation)
  const projection: Projection = {
    center: { x: 0, y: 0 }, geometry: shape.size(width), scale: 1,
    axes: [[cz, sz, 0], [-sz * cx, cz * cx, sx], [sz * sx, -cz * sx, cx]],
    spread: open * gap, open,
  }
  const side = width < 600 ? 11 : 22
  const top = 68
  const bottom = 23
  const extent = projectedBounds(projection)
  projection.scale = Math.min(1, (width - 2 * side) / (extent.right - extent.left), (height - top - bottom) / (extent.bottom - extent.top))
  const bounds = projection.scale < 1 ? projectedBounds(projection) : extent
  projection.center = {
    x: clamp(width / 2 + offset.x, side - bounds.left, Math.max(side - bounds.left, width - side - bounds.right)),
    y: clamp(height * .5 + offset.y, top - bounds.top, Math.max(top - bounds.top, height - bottom - bounds.bottom)),
  }
  return projection
}

/** Invert the planar homography at the layer's plane, then test its actual contour. */
export function hitLayer(projection: Projection, shape: GlassShape, point: Point): number {
  const { axes: [u, v, n], center, scale, geometry } = projection
  const x = point.x - center.x
  const y = point.y - center.y
  const a = u[0] + x * u[2] / CAMERA, b = v[0] + x * v[2] / CAMERA
  const c = u[1] + y * u[2] / CAMERA, d = v[1] + y * v[2] / CAMERA
  const determinant = a * d - b * c
  for (let index = 5; index >= 0; index--) {
    const depth = layerDepth(projection, index)
    const h = x / scale - depth * (n[0] + x * n[2] / CAMERA)
    const k = y / scale - depth * (n[1] + y * n[2] / CAMERA)
    const local = { x: (h * d - b * k) / determinant, y: (a * k - h * c) / determinant }
    if (shape.distance(local, geometry) < 4) return index
  }
  return -1
}
