import { PLAYER_CLEAR_REGIONS } from './playerLayout'
import type { ShapeGeometry } from './shape'

export interface RainWaterField {
  width: number
  height: number
  pixels: Uint8Array
  version: number
}

interface Point { x: number; y: number }
interface Packet extends Point {
  mass: number
  visibleMass: number
  vx: number
  vy: number
  pinning: number
  moisture: number
  moving: boolean
  age: number
  steering: number
  forkAt: number
  side: number
  mergeDelay: number
  momentum: number
  span: number
  path: Point[]
  tributary: boolean
}

const PLATE_W = 360, PLATE_H = 236
const WIDTH = 320, HEIGHT = 210
const X_SCALE = WIDTH / PLATE_W, Y_SCALE = HEIGHT / PLATE_H
const STEP = 1 / 120
const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n))
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const ease = (x: number) => x * x * (3 - 2 * x)

function hash(x: number, y: number) {
  let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

function grain(x: number, y: number) {
  const col = Math.floor(x), row = Math.floor(y)
  const dx = ease(x - col), dy = ease(y - row)
  return mix(mix(hash(col, row), hash(col + 1, row), dx),
    mix(hash(col, row + 1), hash(col + 1, row + 1), dx), dy)
}

export function createRainWaterField() {
  const length = WIDTH * HEIGHT
  const frame: RainWaterField = { width: WIDTH, height: HEIGHT, pixels: new Uint8Array(length * 4), version: 0 }
  const wetness = new Float32Array(length)
  const liquid = new Float32Array(length)
  const drying = new Float32Array(length)
  const reserve = new Float32Array(length)
  const breakup = new Float32Array(length)
  const marked = new Uint8Array(length)
  const dampPixels: number[] = []
  const packets: Packet[] = []
  let seed = 0x682cf3a4, remainder = 0, birth = .56, speed = 1, previous: number | undefined
  let lastAmount = -1
  let initialized = false

  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const i = y * WIDTH + x
    const broad = grain(x * .20 + 8, y * .13 + 70)
    const fine = .30 * grain(x * .58, y * .63 + 11) + broad * .70
    breakup[i] = clamp((fine - .19) / .65)
    drying[i] = Math.exp(-(0.14 + (1 - fine) ** 3 * 1.5) * STEP)
    const u = (x + .5) / WIDTH, v = (y + .5) / HEIGHT
    let openness = 1
    for (const area of PLAYER_CLEAR_REGIONS) {
      const dx = Math.max(0, area.x - u, u - area.x - area.width) * PLATE_W
      const dy = Math.max(0, area.y - v, v - area.y - area.height) * PLATE_H
      openness = Math.min(openness, .13 + .87 * ease(clamp(Math.hypot(dx, dy) / (9 + broad * 4))))
    }
    reserve[i] = openness
  }

  function random() {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 4294967296
  }

  function wetAt(x: number, y: number) {
    const px = x * X_SCALE - .5, py = y * Y_SCALE - .5
    const col = Math.floor(px), row = Math.floor(py)
    if (col < 0 || col >= WIDTH - 1 || row < 0 || row >= HEIGHT - 1) return 0
    const start = row * WIDTH + col
    const dx = px - col, dy = py - row
    return mix(mix(wetness[start], wetness[start + 1], dx),
      mix(wetness[start + WIDTH], wetness[start + WIDTH + 1], dx), dy)
  }

  function footprint(a: Point, b: Point, radius: number, stamp: (index: number, strength: number, t: number) => void) {
    const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - radius) * X_SCALE))
    const x1 = Math.min(WIDTH - 1, Math.ceil((Math.max(a.x, b.x) + radius) * X_SCALE))
    const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - radius) * Y_SCALE))
    const y1 = Math.min(HEIGHT - 1, Math.ceil((Math.max(a.y, b.y) + radius) * Y_SCALE))
    const dx = b.x - a.x, dy = b.y - a.y, segment = dx * dx + dy * dy || 1
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = (x + .5) / X_SCALE - a.x, py = (y + .5) / Y_SCALE - a.y
      const t = clamp((px * dx + py * dy) / segment)
      const dist = ((px - t * dx) ** 2 + (py - t * dy) ** 2) / (radius * radius)
      if (dist < 1) stamp(y * WIDTH + x, (1 - dist) ** 1.38, t)
    }
  }

  function deposit(a: Point, b: Point, radius: number, load: number) {
    footprint(a, b, radius, (pixel, strength) => {
      const portion = load * strength * (.11 + .89 * breakup[pixel] ** 1.6)
      if (portion < .001) return
      wetness[pixel] += (1 - wetness[pixel]) * portion
      if (!marked[pixel]) {
        dampPixels.push(pixel)
        marked[pixel] = 1
      }
    })
  }

  function packet(x: number, y: number, mass: number, moving: boolean): Packet {
    return {
      x, y, mass, visibleMass: mass, moving, vx: 0, vy: 0,
      pinning: .22 + random() * .25, moisture: .15 + random() * .15, steering: (random() - .5) * 3.7,
      age: 0, forkAt: moving && random() < .42 ? y + 25 + random() * 75 : Infinity,
      side: random() < .5 ? -1 : 1, mergeDelay: 0, momentum: 0,
      span: 5.5, path: [], tributary: false,
    }
  }

  function arrive(initial = false) {
    const local = !initial && packets.length > 0 && random() < .30 ? packets[Math.floor(random() * packets.length)] : null
    const edge = random()
    let x = edge < .23 ? 28 + random() * 36 : edge < .70 ? 209 + random() * 124 : 69 + random() * 132
    let y = 16 + random() * 101
    if (local) {
      x = local.x + (random() - .5) * 5.5
      y = local.y + (local.moving ? 1 : -1) * (9 + random() * 12)
    }
    x = clamp(x, 15, PLATE_W - 15)
    y = clamp(y, 13, PLATE_H - 22)
    if (packets.some(p => Math.hypot(p.x - x, p.y - y) < 5.5)) return
    const moving = random() < (initial ? .62 : .32)
    const drop = packet(x, y, moving ? .49 + random() * .44 : .12 + random() * .40, moving)
    drop.age = initial ? .34 : 0
    if (initial && moving) {
      drop.vy = 25 + random() * 32
      drop.span = 10 + random() * 8
      drop.path.push({ x: x - drop.steering, y: y - drop.span })
    }
    packets.push(drop)
  }

  function coalesce() {
    for (let i = 0; i < packets.length; i++) for (let j = i + 1; j < packets.length; j++) {
      const a = packets[i], b = packets[j]
      if (a.mergeDelay > 0 || b.mergeDelay > 0) continue
      const reach = 2.1 + Math.sqrt(a.mass) + Math.sqrt(b.mass)
      if (Math.abs(a.x - b.x) > reach || Math.abs(a.y - b.y) > reach * 1.45) continue
      const anyMoving = a.moving || b.moving
      const lead = anyMoving ? (a.y >= b.y ? a : b) : (a.mass >= b.mass ? a : b)
      const donor = lead === a ? b : a
      const sum = lead.mass + donor.mass
      lead.momentum += (lead.mass * lead.vy + donor.mass * donor.vy) / sum - lead.vy
      lead.mass = sum
      lead.moving = anyMoving
      deposit(donor, lead, 1.6 + Math.sqrt(donor.mass), .28)
      packets.splice(lead === a ? j : i, 1)
      if (lead === a) j--
      else { i--; break }
    }
  }

  function advance(amount: number, targetSpeed: number) {
    speed = mix(speed, targetSpeed, .036)
    birth -= STEP * amount
    if (birth <= 0) {
      birth += .48 - Math.log(Math.max(.0001, random())) * .53
      if (packets.length < Math.min(9, 3 + Math.ceil(amount * 4))) arrive()
    }
    for (let index = dampPixels.length - 1; index >= 0; index--) {
      const pixel = dampPixels[index]
      wetness[pixel] *= drying[pixel]
      if (wetness[pixel] >= .0045) continue
      wetness[pixel] = 0
      marked[pixel] = 0
      dampPixels[index] = dampPixels[dampPixels.length - 1]
      dampPixels.pop()
    }

    for (let index = packets.length - 1; index >= 0; index--) {
      const water = packets[index]
      water.age += STEP
      water.mergeDelay -= STEP
      const surface = grain(water.x * .047 + 31, water.y * .039 + 11)
      const alreadyWet = wetAt(water.x, water.y + 4)
      const resistance = water.pinning * (.91 + surface * .66) - alreadyWet * .12
      if (water.moving) {
        water.mass = Math.max(.025, water.mass - STEP * (.032 + water.vy * .00074))
        if (water.mass < resistance * .74 && (surface > .49 || water.mass < .092)) water.moving = false
      } else {
        water.mass += STEP * water.moisture * amount * (.67 + surface * .65)
        if (water.mass > resistance + .065) water.moving = true
      }

      const previous = { x: water.x, y: water.y }
      const transfer = water.momentum * .075
      water.momentum -= transfer
      if (water.moving) {
        const drive = (40 + Math.min(.95, water.mass) * 57) * speed * speed
        const drag = (1.20 + surface * .62 - alreadyWet * .22) * speed
        water.vy = Math.max(0, (water.vy + drive * STEP + transfer) / (1 + drag * STEP))
        const downhill = (grain(water.x * .037 + 47, water.y * .044) - .5) * 13
        const channel = (wetAt(water.x + 2.7, water.y + 5) - wetAt(water.x - 2.7, water.y + 5)) * 9
        const boundary = (clamp(water.x, 15, PLATE_W - 15) - water.x) * 2
        water.vx = mix(water.vx, water.steering + downhill + channel + boundary, .027)
      } else {
        water.vy *= .915
        water.vx *= .927
      }
      water.x += water.vx * STEP
      water.y += water.vy * STEP
      water.visibleMass = mix(water.visibleMass, water.mass, .066)
      const spread = water.moving ? 7.8 + Math.min(25, water.vy * .28) + Math.sqrt(water.visibleMass) * 5 : 4.4 + water.visibleMass * 5
      water.span = mix(water.span, spread, .065)
      if (water.vy > 3) {
        const measure = 1.53 + Math.sqrt(water.mass) * 2.25
        deposit(previous, water, measure, STEP * (1.8 + water.vy * .14))
        const last = water.path[water.path.length - 1]
        if (!last || Math.hypot(previous.x - last.x, previous.y - last.y) >= 2.15) {
          water.path.push(previous)
          if (water.path.length > 24) water.path.shift()
        }
      }

      if (water.y > water.forkAt && water.mass > .63 && water.vy > 18 && surface > .54 && packets.length < 7) {
        const share = water.mass * (.15 + random() * .10)
        water.mass -= share
        water.forkAt = Infinity
        water.mergeDelay = .51
        const branch = packet(water.x + water.side * 1.5, water.y - .8, share, true)
        branch.vx = water.vx + water.side * (11 + random() * 6)
        branch.vy = water.vy * .57
        branch.path.push(previous)
        branch.steering += water.side * 5.2
        branch.forkAt = Infinity
        branch.mergeDelay = .57
        branch.tributary = true
        packets.push(branch)
      }
      if (water.y > PLATE_H + 28 || (water.tributary && water.age > 1.27 && water.mass < .31)) {
        if (water.tributary) deposit(previous, water, 2.3, clamp(water.mass * .8))
        packets.splice(index, 1)
      }
    }
    coalesce()
  }

  function expose(water: Packet) {
    const mass = Math.sqrt(Math.max(.05, water.visibleMass))
    const amplitude = clamp(.29 + mass * .66) * clamp(water.age / .26)
    const radius = 1.38 + mass * 2.58
    let near: Point = water
    let distance = 0
    let index = water.path.length - 1
    while (distance < water.span) {
      const far: Point = index >= 0 ? water.path[index--] : { x: near.x - water.vx * .018, y: near.y - 2.3 }
      const delta = Math.hypot(near.x - far.x, near.y - far.y)
      if (delta < .16) { near = far; continue }
      const part = Math.min(1, (water.span - distance) / delta)
      const end = { x: mix(near.x, far.x, part), y: mix(near.y, far.y, part) }
      // The raised parts of a stream emerge along its actual centerline, then flatten into the film.
      const neck = grain((near.x + end.x) * .134, (near.y + end.y) * .174 + 13)
      const from = distance / water.span
      const reach = delta * part / water.span
      const broad = radius * (.68 + .62 * neck) * (.64 + .36 * ease(clamp(from * 5.5)))
      footprint(near, end, broad, (pixel, mask, t) => {
        const along = from + reach * t
        const body = (.31 + .69 * ease(clamp(along * 4.3))) * (1 - ease(clamp((along - .41) / .59)))
        const shape = amplitude * body * (.62 + neck * .38)
        liquid[pixel] = Math.max(liquid[pixel], shape * mask)
      })
      distance += delta * part
      near = end
    }
  }

  function upload(amount: number) {
    liquid.fill(0)
    for (const water of packets) expose(water)
    for (let i = 0; i < length; i++) {
      const d = i * 4
      const film = wetness[i]
      const body = liquid[i]
      const opening = reserve[i] * clamp(amount * 1.2)
      frame.pixels[d] = Math.round(clamp(body + film * .125) * opening * 255)
      frame.pixels[d + 1] = Math.round(clamp(film * .91 + body * .12) * opening * 255)
    }
    frame.version++
  }

  return {
    sample(_geometry: ShapeGeometry, time: number, amount: number, slideSpeed: number) {
      const intensity = clamp(amount, 0, 2)
      const gap = previous === undefined ? 0 : time - previous
      previous = time
      if (gap < 0) {
        packets.length = 0
        wetness.fill(0)
        marked.fill(0)
        dampPixels.length = 0
        remainder = 0
        initialized = false
        seed = 0x682cf3a4
        birth = .56
      }
      if (!initialized && intensity > .01) {
        initialized = true
        speed = clamp(slideSpeed, .25, 2)
        const count = Math.min(7, Math.round(1 + intensity * 4))
        for (let i = 0; i < count; i++) arrive(true)
        lastAmount = -1
      }
      const start = frame.version
      // Never run a backlog of hidden-tab simulation in a single visible frame.
      remainder += gap > 0 && gap <= .20 ? Math.min(gap, .075) : 0
      const advanceNeeded = remainder + 1e-9 >= STEP
      while (remainder + 1e-9 >= STEP) {
        advance(intensity, clamp(slideSpeed, .25, 2))
        remainder -= STEP
      }
      if (advanceNeeded || intensity !== lastAmount || start === 0) {
        upload(intensity)
        lastAmount = intensity
      }
      return frame
    },
  }
}
