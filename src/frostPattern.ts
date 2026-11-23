import { roundedRectangle, type GlassShape, type ShapeGeometry } from './shape'

export interface FrostClearRegion { x: number; y: number; width: number; height: number }
type Point = readonly [number, number]

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const smooth = (value: number) => value * value * (3 - 2 * value)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function hash(x: number, y: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const a = smooth(x - ix), b = smooth(y - iy)
  return lerp(lerp(hash(ix, iy), hash(ix + 1, iy), a), lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), a), b)
}

function contourRoots(shape: GlassShape, geometry: ShapeGeometry, random: () => number) {
  const outline = shape.outline(geometry)
  let perimeter = 0
  let winding = 0
  const edges = outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length]
    const dx = b.x - a.x, dy = b.y - a.y
    const start = perimeter
    const length = Math.hypot(dx, dy)
    perimeter += length
    winding += a.x * b.y - b.x * a.y
    return { a, dx, dy, start, length }
  })
  const direction = Math.sign(winding)
  const count = 16
  const phase = random()
  return Array.from({ length: count }, (_, i) => {
    const distance = (((i + .20 + random() * .62) / count + phase) % 1) * perimeter
    const edge = edges.find(({ start, length }) => distance < start + length) ?? edges[edges.length - 1]
    const t = (distance - edge.start) / edge.length
    const nx = -edge.dy * direction / edge.length, ny = edge.dx * direction / edge.length
    const x = edge.a.x + edge.dx * t + nx * geometry.width * .002
    const y = edge.a.y + edge.dy * t + ny * geometry.width * .002
    return [x / geometry.width + .5, y / geometry.height + .5, Math.atan2(ny, nx), .015 + random() * .16] as const
  })
}

/** Local atlas channels: growth rank, condensation, crystal strength, crystal growth rank. */
export function createFrostPattern(shape: GlassShape, geometry: ShapeGeometry, clear: readonly FrostClearRegion[]) {
  const width = 448
  const height = Math.round(width * geometry.height / geometry.width)
  const count = width * height
  const pixels = new Uint8Array(count * 4)
  const crystalStrength = new Float32Array(count)
  const crystalAge = new Float32Array(count).fill(1)
  const field = new Uint16Array(count).fill(65535)
  const bins = new Uint32Array(1024)
  let state = 0x9bc43e61
  let plateArea = 0, eligibleArea = 0
  function random() {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
  const mistSeeds = [[.19,.22], [.44,.39], [.69,.18], [.83,.54], [.91,.09], [.28,.05], [.037,.48]]

  function stroke(a: Point, b: Point, widthAtRoot: number, opacity: number, start: number, end: number) {
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const length2 = dx * dx + dy * dy || 1
    const pad = widthAtRoot + 1
    for (let y = Math.max(0, Math.floor(Math.min(a[1],b[1]) - pad)); y < Math.min(height, Math.ceil(Math.max(a[1],b[1]) + pad)); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(a[0],b[0]) - pad)); x < Math.min(width, Math.ceil(Math.max(a[0],b[0]) + pad)); x++) {
        const along = clamp(((x + .5 - a[0]) * dx + (y + .5 - a[1]) * dy) / length2)
        const distance = Math.hypot(x + .5 - a[0] - dx * along, y + .5 - a[1] - dy * along)
        const coverage = smooth(clamp((widthAtRoot * (.95 - .22 * along) + .68 - distance) / 1.2))
        const i = y * width + x
        const value = coverage * opacity
        if (value > crystalStrength[i]) {
          crystalStrength[i] = value
          crystalAge[i] = lerp(start, end, along)
        }
      }
    }
  }

  const roots = shape === roundedRectangle ? [
    [.067,.13,.32,.018], [.22,.018,1.18,.058], [.31,.024,1.65,.137], [.49,.014,1.91,.063],
    [.66,.01,1.21,.118], [.88,.017,2.04,.027], [.965,.11,2.57,.136], [.981,.32,2.86,.084],
    [.97,.58,3.47,.099], [.022,.43,-.47,.043], [.017,.64,-.59,.126], [.116,.937,-1.53,.168],
    [.92,.937,-2.14,.129], [.76,.955,-1.72,.073], [.475,.22,.74,.182], [.824,.37,2.25,.148],
  ] : contourRoots(shape, geometry, random)
  for (const [u,v,angle,birth] of roots) {
    let origin: Point = [u * width, v * height]
    let heading = angle + (random() - .5) * .38
    const length = 31 + random() * 62
    const segments = 7 + Math.floor(random() * 6)
    const branchChance = .69 + random() * .27
    for (let j = 0; j < segments; j++) {
      const growth = j / segments
      heading += (random() - .49) * .32
      const size = length / segments
      const tip: Point = [origin[0] + Math.cos(heading) * size, origin[1] + Math.sin(heading) * size]
      const opening = birth + growth * (.20 + length * .001)
      stroke(origin, tip, .88 - growth * .43, .85 - growth * .32, opening, opening + .025)
      for (const side of [-1, 1]) if (random() < branchChance && j > 0) {
        const branchAngle = heading + side * (.49 + random() * .70)
        const reach = (9 + length * .22 * random()) * (1 - growth * .61)
        const joint: Point = [origin[0] + Math.cos(branchAngle) * reach * .57, origin[1] + Math.sin(branchAngle) * reach * .57]
        const endAngle = branchAngle + (random() - .55) * .46
        const end: Point = [joint[0] + Math.cos(endAngle) * reach * .46, joint[1] + Math.sin(endAngle) * reach * .46]
        stroke(origin, joint, .63 - growth * .2, .76, opening + .017, opening + .052)
        stroke(joint, end, .42, .55 + random() * .16, opening + .052, opening + .08)
        if (random() > .28) {
          const fork = branchAngle + side * (.42 + random() * .42)
          const twig: Point = [joint[0] + Math.cos(fork) * reach * .34, joint[1] + Math.sin(fork) * reach * .34]
          stroke(joint, twig, .36, .55, opening + .061, opening + .11)
        }
      }
      origin = tip
    }
  }

  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = (x + .5) / width, v = (y + .5) / height
    const depth = -shape.distance({ x: (u - .5) * geometry.width, y: (v - .5) * geometry.height }, geometry) * width / geometry.width
    const i = y * width + x, out = i * 4
    pixels[out] = 255
    pixels[out + 3] = 255
    if (depth < 0) continue
    plateArea++
    const cloud = .56 * noise(x * .023 + 7, y * .028 + 41) + .29 * noise(x * .060 + 30, y * .069 + 21) + .15 * noise(x * .158 + 11, y * .13)
    const grain = .68 * hash(x + 810, y + 145) + .32 * noise(x * .40, y * .43)
    let mask = 1
    for (const region of clear) {
      const dx = Math.max(region.x - u, u - region.x - region.width, 0) * width
      const dy = Math.max(region.y - v, v - region.y - region.height, 0) * height
      const feather = 5 + cloud * 13 + grain * 1.8
      mask = Math.min(mask, smooth(clamp(Math.hypot(dx, dy) / feather)))
    }
    if (mask < .01) continue
    eligibleArea++
    let cluster = 0
    for (const [cx,cy] of mistSeeds) {
      const zone = clamp(1 - Math.hypot((u - cx) * 6.2, (v - cy) * 4.5))
      cluster += zone * zone
    }
    const priority = depth * (1.13 - cloud * .70) + (1 - cloud) * 47 - cluster * 38 + (1 - mask) * 24
    const slot = Math.round(clamp((priority + 36) / 177) * (bins.length - 1))
    field[i] = slot
    bins[slot]++
    pixels[out + 1] = Math.round(mask * clamp(.14 + grain * .62 + cloud * .21) * 255)
    pixels[out + 2] = Math.round(mask * crystalStrength[i] * 255)
    pixels[out + 3] = Math.round(clamp(crystalAge[i]) * 255)
  }
  let accumulated = 0
  const rank = bins.map(value => {
    const midpoint = accumulated + value / 2
    accumulated += value
    return Math.round(clamp(midpoint / plateArea) * 255)
  })
  for (let i = 0; i < count; i++) {
    const slot = field[i]
    if (slot >= bins.length) continue
    const channel = i * 4
    pixels[channel] = rank[slot]
    if (shape !== roundedRectangle) pixels[channel + 3] = Math.max(rank[slot], pixels[channel + 3])
  }
  return { width, height, pixels, maxCoverage: Math.min(.60, eligibleArea / Math.max(1,plateArea)) }
}
