import type { PlayerLayout } from './playerLayout'
import type { Point, ShapeGeometry, ShapeId } from './shape'

type Slot = { x: number; y: number; width: number; height: number }

function toLocal(slot: Slot, { width, height }: ShapeGeometry): Slot {
  return { x: slot.x * width, y: slot.y * height, width: slot.width * width, height: slot.height * height }
}

function center(slot: Slot): Point {
  return { x: slot.x + slot.width / 2, y: slot.y + slot.height / 2 }
}

function frame(context: CanvasRenderingContext2D, slot: Slot, corner: number, alpha: number) {
  context.globalAlpha = alpha
  context.beginPath()
  context.roundRect(slot.x, slot.y, slot.width, slot.height, corner)
  context.stroke()
}

function reel(context: CanvasRenderingContext2D, slot: Slot, angle: number) {
  const { x, y } = center(slot)
  const radius = Math.min(slot.width, slot.height) / 2

  context.save()
  context.translate(x, y)
  context.rotate(angle)

  context.globalAlpha = .23
  context.beginPath()
  for (const factor of [.98, .62, .22]) {
    const r = radius * factor
    context.moveTo(r, 0)
    context.arc(0, 0, r, 0, Math.PI * 2)
  }
  context.stroke()

  context.globalAlpha = .32
  context.beginPath()
  for (let spoke = 0; spoke < 5; spoke++) {
    const bearing = spoke * Math.PI * 2 / 5
    const x = Math.cos(bearing) * radius
    const y = Math.sin(bearing) * radius
    context.moveTo(x * .68, y * .68)
    context.lineTo(x * .89, y * .89)
  }
  context.stroke()

  context.globalAlpha = .14
  context.beginPath()
  context.arc(0, 0, radius * .37, -.95, .24)
  context.stroke()
  context.restore()
}

function paintCassette(
  context: CanvasRenderingContext2D, geometry: ShapeGeometry, layout: PlayerLayout, angle: number,
) {
  if (!layout.reels || !layout.tapePath) return

  const window = toLocal(layout.tapePath, geometry)
  const supply = toLocal(layout.reels[0], geometry)
  const takeUp = toLocal(layout.reels[1], geometry)
  frame(context, window, window.height * .23, .19)

  const left = center(supply)
  const right = center(takeUp)
  const separation = Math.min(supply.height, takeUp.height) * .21
  context.globalAlpha = .16
  context.beginPath()
  for (const side of [-1, 1]) {
    context.moveTo(left.x + supply.width * .47, left.y + separation * side)
    context.lineTo(right.x - takeUp.width * .47, right.y + separation * side)
  }
  context.stroke()

  reel(context, supply, angle)
  reel(context, takeUp, angle * .94 + .58)
}

function paintGrille(context: CanvasRenderingContext2D, grille: Slot) {
  frame(context, grille, Math.min(grille.width, grille.height) * .20, .12)
  const { x, y } = center(grille)

  context.globalAlpha = .21
  context.beginPath()
  for (let index = -3; index <= 3; index++) {
    const extent = grille.width * (.34 - .012 * index * index)
    const row = y + index * grille.height * .093
    context.moveTo(x - extent, row)
    context.lineTo(x + extent, row)
  }
  context.stroke()
}

function paintReadout(context: CanvasRenderingContext2D, display: Slot) {
  frame(context, display, display.height * .19, .17)

  const baseline = display.y + display.height * .96
  context.globalAlpha = .16
  context.beginPath()
  for (let index = 0; index <= 10; index++) {
    const x = display.x + display.width * (.075 + .085 * index)
    const length = display.height * (index % 5 === 0 ? .070 : .042)
    context.moveTo(x, baseline)
    context.lineTo(x, baseline - length)
  }
  context.stroke()
}

function paintRadio(context: CanvasRenderingContext2D, geometry: ShapeGeometry, layout: PlayerLayout) {
  if (layout.grille) paintGrille(context, toLocal(layout.grille, geometry))
  if (layout.display) paintReadout(context, toLocal(layout.display, geometry))
  if (layout.volume) {
    const slot = toLocal(layout.volume, geometry)
    const { x, y } = center(slot)
    context.globalAlpha = .14
    context.beginPath()
    context.arc(x, y, Math.min(slot.width, slot.height) * .58, Math.PI * .17, Math.PI * .83)
    context.stroke()
  }
}

/** Draw only translucent hardware details. Playback controls are in the projected DOM. */
export function paintDeviceInk(
  context: CanvasRenderingContext2D, shapeId: ShapeId, geometry: ShapeGeometry, layout: PlayerLayout,
  spinRadians = 0,
) {
  if (shapeId === 'rounded-rectangle') return

  context.save()
  context.strokeStyle = '#fff'
  context.lineWidth = Math.max(.65, geometry.width * .00235)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  if (shapeId === 'cassette') paintCassette(context, geometry, layout, spinRadians)
  else if (shapeId === 'radio') paintRadio(context, geometry, layout)
  context.restore()
}
