import { Euler, PerspectiveCamera, Plane, Quaternion, Raycaster, Vector2, Vector3, MathUtils } from 'three'
import type { GlassShape, Point, ShapeGeometry } from './shape'

const CAMERA_DISTANCE = 1150
export const PITCH_RANGE = .82
export const YAW_RANGE = 1.05

export interface ViewRotation { pitch: number; yaw: number }

export interface Projection {
  width: number
  height: number
  camera: PerspectiveCamera
  orientation: Quaternion
  geometry: ShapeGeometry
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

export function makeProjection(width: number, height: number, shape: GlassShape, open: number, gap: number, view: ViewRotation): Projection {
  const fov = MathUtils.radToDeg(2 * Math.atan(height / (2 * CAMERA_DISTANCE)))
  const camera = new PerspectiveCamera(fov, width / height, 1, CAMERA_DISTANCE * 3)
  camera.position.z = CAMERA_DISTANCE
  camera.updateMatrixWorld()

  const baseTilt = open * .95
  const pitchRange = view.pitch >= 0 ? Math.min(PITCH_RANGE, 1.19 - baseTilt) : PITCH_RANGE - open * .17
  const tilt = baseTilt + view.pitch * pitchRange / PITCH_RANGE
  const orientation = new Quaternion().setFromEuler(new Euler(-tilt, view.yaw, open * .32, 'ZYX'))
  const projection: Projection = {
    width, height, camera, orientation, geometry: shape.size(width), scale: 1, spread: open * gap, open,
  }
  const side = width < 600 ? 11 : 22
  const fits = () => {
    const bounds = projectedBounds(projection)
    return bounds.left >= side && bounds.right <= width - side && bounds.top >= 68 && bounds.bottom <= height - 23
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

/** Intersect each rendered plane in world space before testing its rounded mask. */
export function hitLayer(projection: Projection, shape: GlassShape, point: Point): number {
  const { width, height, camera, orientation, scale, geometry } = projection
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
    if (shape.distance({ x: intersection.x, y: -intersection.y }, geometry) < 4) return index
  }
  return -1
}
