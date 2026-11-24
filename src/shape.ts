import { TURNTABLE } from './turntableLayout'

export interface Point { x: number; y: number }
export interface ShapeGeometry { width: number; height: number; radius: number }

export type ShapeId = 'rounded-rectangle' | 'cassette' | 'radio' | 'turntable'

export interface GlassShape {
  id: ShapeId
  label: string
  preview: { path: string; viewBox: string }
  size(stageWidth: number): ShapeGeometry
  distance(point: Point, geometry: ShapeGeometry): number
  outline(geometry: ShapeGeometry): Point[]
  distanceGLSL?: string
}

/** The contour is shared by the optics, projected hit targets, and surface slot. */
export const roundedRectangle = {
  id: 'rounded-rectangle',
  label: '圆角矩形',
  preview: {
    path: 'M9 1.5H91Q98.5 1.5 98.5 9V56.4Q98.5 63.9 91 63.9H9Q1.5 63.9 1.5 56.4V9Q1.5 1.5 9 1.5Z',
    viewBox: '0 0 100 65.4',
  },
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
} satisfies GlassShape

function roundedProfile(
  id: ShapeId, label: string, aspect: number, corner: number, maxWidth: number,
): GlassShape {
  const radius = corner * 100
  const height = aspect * 100
  const arc = 'A' + radius + ' ' + radius + ' 0 0 1 '
  const path = [
    'M' + radius + ' 0', 'H' + (100 - radius), arc + '100 ' + radius,
    'V' + (height - radius), arc + (100 - radius) + ' ' + height,
    'H' + radius, arc + '0 ' + (height - radius), 'V' + radius, arc + radius + ' 0', 'Z',
  ].join(' ')
  return {
    id, label, preview: { path, viewBox: '-1 -1 102 ' + (height + 2) },
    size(stageWidth) {
      const width = Math.min(maxWidth, stageWidth * .735)
      return { width, height: width * aspect, radius: width * corner }
    },
    distance: roundedRectangle.distance,
    outline: roundedRectangle.outline,
  }
}

export const GLASS_SHAPES: Record<ShapeId, GlassShape> = {
  'rounded-rectangle': roundedRectangle,
  cassette: roundedProfile('cassette', '极简玻璃磁带', .62, .043, 360),
  radio: roundedProfile('radio', '极简玻璃收音机', .465, .081, 396),
  turntable: roundedProfile('turntable', '唱片机', TURNTABLE.body.height / 100, TURNTABLE.body.corner / 100, TURNTABLE.body.width),
}
