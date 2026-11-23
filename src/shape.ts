export interface Point { x: number; y: number }
export interface ShapeGeometry { width: number; height: number; radius: number }

export interface GlassShape {
  size(stageWidth: number): ShapeGeometry
  distance(point: Point, geometry: ShapeGeometry): number
  outline(geometry: ShapeGeometry): Point[]
  distanceGLSL: string
}

/** The contour is shared by the optics, projected hit targets, and surface slot. */
export const roundedRectangle: GlassShape = {
  size(stageWidth) {
    const width = Math.min(360, stageWidth * .735)
    return { width, height: width * .654, radius: Math.min(32, width * .104) }
  },
  distance({ x, y }, { width, height, radius }) {
    const dx = Math.abs(x) - width / 2 + radius
    const dy = Math.abs(y) - height / 2 + radius
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius
  },
  outline({ width, height, radius }) {
    const right = width / 2 - radius
    const bottom = height / 2 - radius
    const corners = [[right, -bottom], [right, bottom], [-right, bottom], [-right, -bottom]]
    return corners.flatMap(([x, y], corner) => Array.from({ length: 13 }, (_, step) => {
      const angle = (corner - 1 + step / 12) * Math.PI / 2
      return { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius }
    }))
  },
  distanceGLSL: `
float contour(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}`,
}

export const GLASS_SHAPES = { 'rounded-rectangle': roundedRectangle }
export type ShapeId = keyof typeof GLASS_SHAPES
