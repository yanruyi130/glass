import { Euler, Matrix4, PerspectiveCamera, Plane, Quaternion, Raycaster, Vector2, Vector3, MathUtils } from 'three'
import { roundedRectangle, type GlassShape, type Point, type ShapeGeometry } from './shape'

const CAMERA_DISTANCE = 1150
export const PITCH_RANGE = .82
export const YAW_RANGE = 1.05

export interface ViewRotation { pitch: number; yaw: number }

export interface Projection {
  width: number
  height: number
  camera: PerspectiveCamera
  orientation: Quaternion
  shape: GlassShape
  geometry: ShapeGeometry
  fittingOutline: Point[]
  scale: number
  spread: number
  open: number
}

export const layerDepth = (projection: Projection, index: number) => (index - 2.5) * projection.spread

export function project(projection: Projection, point: Point, depth: number): Point {
  const { orientation, scale, camera, width, height } = projection
  const pointInView = new Vector3(point.x, -point.y, depth).multiplyScalar(scale).applyQuaternion(orientation).project(camera)
  return { x: (1 + pointInView.x) * width / 2, y: (1 - pointInView.y) * height / 2 }
}

/** Project the full CSS rectangle onto the same perspective plane as the Ink layer. */
export function inkPlaneTransform(projection: Projection) {
  const { width, height, scale, orientation, geometry, camera } = projection
  const local = new Matrix4().set(
    1, 0, 0, -geometry.width / 2,
    0, -1, 0, geometry.height / 2,
    0, 0, 1, layerDepth(projection, 5),
    0, 0, 0, 1,
  )
  const model = new Matrix4().makeRotationFromQuaternion(orientation).scale(new Vector3(scale, scale, scale))
  const clip = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(model).multiply(local).elements
  const divisor = clip[15]
  const x = (column: number) => (clip[column] + clip[column + 3]) * width / (2 * divisor)
  const y = (column: number) => (clip[column + 3] - clip[column + 1]) * height / (2 * divisor)
  return 'matrix3d(' + [x(0), y(0), 0, clip[3] / divisor, x(4), y(4), 0, clip[7] / divisor,
    0, 0, 1, 0, x(12), y(12), 0, 1].join(',') + ')'
}

export function projectedBounds(projection: Projection) {
  const { orientation, scale, camera, width, height, fittingOutline } = projection
  const point = new Vector3()
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const index of [0, 5]) {
    const depth = layerDepth(projection, index)
    for (const { x, y } of fittingOutline) {
      point.set(x, -y, depth).multiplyScalar(scale).applyQuaternion(orientation).project(camera)
      const sx = (1 + point.x) * width / 2, sy = (1 - point.y) * height / 2
      left = Math.min(left, sx)
      right = Math.max(right, sx)
      top = Math.min(top, sy)
      bottom = Math.max(bottom, sy)
    }
  }
  return { left, right, top, bottom }
}

export function makeProjection(width: number, height: number, shape: GlassShape, open: number, gap: number, view: ViewRotation): Projection {
  const fov = MathUtils.radToDeg(2 * Math.atan(height / (2 * CAMERA_DISTANCE)))
  const camera = new PerspectiveCamera(fov, width / height, 1, CAMERA_DISTANCE * 3)
  camera.position.z = CAMERA_DISTANCE
  camera.updateMatrixWorld()

  const baseTilt = open * .95
  const pitchRange = view.pitch >= 0 ? Math.min(PITCH_RANGE, 1.19 - baseTilt) : PITCH_RANGE - open * .17
  const tilt = baseTilt + view.pitch * pitchRange / PITCH_RANGE
  const orientation = new Quaternion().setFromEuler(new Euler(-tilt, view.yaw, open * .32, 'ZYX'))
  const geometry = shape.size(width)
  const fittingOutline = shape === roundedRectangle
    ? [-1, 1].flatMap(x => [-1, 1].map(y => ({ x: x * geometry.width / 2, y: y * geometry.height / 2 })))
    : shape.outline(geometry)
  const projection: Projection = {
    width, height, camera, orientation, shape, geometry, fittingOutline, scale: 1, spread: open * gap, open,
  }
  const side = width < 600 ? (shape === roundedRectangle ? 11 : 17) : 22
  const top = width < 320 ? 90 : 68
  const fits = () => {
    const bounds = projectedBounds(projection)
    return bounds.left >= side && bounds.right <= width - side && bounds.top >= top && bounds.bottom <= height - 23
  }
  // Fit wide angles on a phone by scaling uniformly around the fixed pivot.
  if (!fits()) {
    let low = 0, high = 1
    for (let i = 0; i < 8; i++) {
      projection.scale = (low + high) / 2
      if (fits()) low = projection.scale
      else high = projection.scale
    }
    projection.scale = low
  }
  return projection
}

/** Intersect each rendered plane in world space before testing its signed-distance mask. */
export function hitLayer(projection: Projection, point: Point): number {
  const { width, height, camera, orientation, scale, geometry, shape } = projection
  const raycaster = new Raycaster()
  raycaster.setFromCamera(new Vector2(point.x / width * 2 - 1, 1 - point.y / height * 2), camera)
  const normal = new Vector3(0, 0, 1).applyQuaternion(orientation)
  const inverse = orientation.clone().invert()
  const plane = new Plane()
  const intersection = new Vector3()
  for (let index = 5; index >= 0; index--) {
    plane.normal.copy(normal)
    plane.constant = -layerDepth(projection, index) * scale
    if (!raycaster.ray.intersectPlane(plane, intersection)) continue
    intersection.applyQuaternion(inverse).divideScalar(scale)
    if (shape.distance({ x: intersection.x, y: -intersection.y }, geometry) <= 0) return index
  }
  return -1
}
