import type { ShapeGeometry } from './shape'

const FIELD_WIDTH = 360
const FIELD_HEIGHT = 240
const FLOOR = FIELD_HEIGHT / 2
const STEP = 1 / 120
const MAX_STEP_WINDOW = .09
export const RAIN_DROP_LIMIT = 16
export const RAIN_TRAIL_LIMIT = 16

interface Point {
  x: number
  y: number
}

interface Drop extends Point {
  volume: number
  radius: number
  releaseVolume: number
  inflow: number
  vx: number
  vy: number
  impulse: number
  drift: number
  age: number
  sliding: boolean
  stretch: number
  lastMark: Point | null
  absorbedBy: Drop | null
  absorbingFor: number
}

interface WetMark {
  start: Point
  end: Point
  width: number
  life: number
  age: number
}

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function roughness(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const smooth = (value: number) => value * value * (3 - 2 * value)
  const dx = smooth(x - ix), dy = smooth(y - iy)
  const hash = (a: number, b: number) => {
    let value = Math.imul(a, 374761393) + Math.imul(b, 668265263)
    value = Math.imul(value ^ value >>> 13, 1274126177)
    return ((value ^ value >>> 16) >>> 0) / 4294967296
  }
  return lerp(lerp(hash(ix, iy), hash(ix + 1, iy), dx), lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), dx), dy)
}

export function createSurfaceWeather() {
  const frame = {
    drops: new Float32Array(RAIN_DROP_LIMIT * 4),
    trails: new Float32Array(RAIN_TRAIL_LIMIT * 8),
  }
  const drops: Drop[] = []
  const marks: WetMark[] = []
  let seed = 79
  let lastTime: number | undefined
  let carried = 0
  let nextArrival = .34
  let speed = 1
  let primed = false

  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return (seed + .5) / 4294967296
  }

  function seedsAt(amount: number, initial = false) {
    const moving = random() < (initial ? .27 : .22)
    const radius = moving ? 2.75 + random() * 1.28 : 2.05 + random() * 1.55
    const volume = radius ** 3
    const releaseVolume = (3.65 + random() * 1.16) ** 3
    const inflow = Math.max(4, (releaseVolume - volume) * .12) + random() * 8
    const nearby = !initial && drops.length > 0 && random() < .29
      ? drops[Math.floor(random() * drops.length)]
      : null
    let x = nearby
      ? nearby.x + (random() - .5) * 16
      : (random() - .48) * FIELD_WIDTH * .89
    let y = nearby ? nearby.y - 7 - random() * 18 : -91 + random() * 152
    x = clamp(x, -FIELD_WIDTH * .445, FIELD_WIDTH * .445)
    y = clamp(y, -99, 78)
    // Keep arrivals away from the ink block, with room for occasional slides past it.
    if (x < 35 && y > 40 && (!nearby || random() < .64)) y = 16 + random() * 21
    if (drops.some(drop => Math.hypot(drop.x - x, drop.y - y) < drop.radius + radius + 1.0)) return

    drops.push({
      x, y, volume, radius, releaseVolume, inflow: inflow * (.78 + amount * .22),
      vx: 0, vy: moving && initial ? 17 + random() * 24 : 0, impulse: 0,
      drift: (random() - .5) * 3.6, age: initial ? .35 : 0, sliding: moving,
      stretch: 1, lastMark: null, absorbedBy: null, absorbingFor: 0,
    })
  }

  function join(a: Drop, b: Drop) {
    // The lower lobe leads the combined drop. Ease the transfer of momentum
    // and the visible radius while the other lobe draws into it.
    const sliding = a.sliding || b.sliding
    const lead = sliding ? (a.y >= b.y ? a : b) : (a.volume >= b.volume ? a : b)
    const donor = lead === a ? b : a
    const volume = lead.volume + donor.volume
    const momentum = (lead.vy * lead.volume + donor.vy * donor.volume) / volume
    lead.impulse += momentum - lead.vy
    lead.volume = volume
    lead.sliding = sliding || volume >= lead.releaseVolume
    donor.absorbedBy = lead
    donor.lastMark = null
  }

  function advance(amount: number, targetSpeed: number) {
    speed = lerp(speed, targetSpeed, 1 - Math.exp(-STEP * 6))
    nextArrival -= STEP * (1.72 * amount)
    if (nextArrival <= 0) {
      // Randomly spaced arrivals are independent of the drops already moving.
      nextArrival += .36 - Math.log(random()) * .58
      const ceiling = Math.min(RAIN_DROP_LIMIT, Math.ceil(5 + amount * 9))
      if (drops.length < ceiling) seedsAt(amount)
    }

    for (const mark of marks) mark.age += STEP
    while (marks.length > 0 && marks[0].age >= marks[0].life) marks.shift()
    for (const drop of drops) {
      drop.age += STEP
      if (drop.absorbedBy) {
        const lead = drop.absorbedBy
        const attraction = 1 - Math.exp(-STEP * 14)
        drop.x = lerp(drop.x, lead.x, attraction)
        drop.y = lerp(drop.y, lead.y, attraction)
        drop.absorbingFor += STEP
        continue
      }

      if (!drop.sliding) {
        drop.volume += drop.inflow * STEP
        if (drop.volume >= drop.releaseVolume) drop.sliding = true
      }
      drop.radius = lerp(drop.radius, Math.cbrt(drop.volume), 1 - Math.exp(-STEP * 9))
      if (!drop.sliding) continue

      const surface = roughness(drop.x * .048 + 21, drop.y * .035 + 36)
      const resistance = 1.30 + surface * .36
      const gravity = 70 + Math.min(43, drop.radius * 8.5)
      const transfer = drop.impulse * (1 - Math.exp(-STEP * 9))
      drop.impulse -= transfer
      drop.vy = Math.max(0, (drop.vy + STEP * gravity * speed ** 2 + transfer) / (1 + STEP * resistance * speed))
      const lateralField = (roughness(drop.x * .034 + 67, drop.y * .024 + 18) - .5) * 6.8
      const boundary = (clamp(drop.x, -159, 159) - drop.x) * 1.1
      drop.vx = lerp(drop.vx, drop.drift + lateralField + boundary, 1 - Math.exp(-STEP * 2.4))
      drop.x += drop.vx * STEP
      drop.y += drop.vy * STEP
      drop.stretch = lerp(drop.stretch, 1 + .92 * clamp(drop.vy / 86), 1 - Math.exp(-STEP * 11))

      if (!drop.lastMark) drop.lastMark = { x: drop.x, y: drop.y }
      const end = { x: drop.x, y: drop.y - drop.radius * .8 }
      if (end.y - drop.lastMark.y >= 6.6) {
        marks.push({
          start: drop.lastMark, end, width: .45 + drop.radius * .075,
          life: clamp(30 / Math.max(34, drop.vy), .34, .74), age: 0,
        })
        if (marks.length > RAIN_TRAIL_LIMIT) marks.shift()
        drop.lastMark = end
      }
    }

    for (let i = 0; i < drops.length; i++) {
      const a = drops[i]
      if (a.absorbedBy || a.age < .18) continue
      for (let j = i + 1; j < drops.length; j++) {
        const b = drops[j]
        if (b.absorbedBy || b.age < .18) continue
        if (Math.hypot(a.x - b.x, a.y - b.y) <= (a.radius + b.radius) * .91) {
          join(a, b)
          if (a.absorbedBy) break
        }
      }
    }

    for (let i = drops.length - 1; i >= 0; i--) {
      const drop = drops[i]
      if (drop.absorbingFor >= .21 || drop.y - drop.radius * drop.stretch > FLOOR + 1) drops.splice(i, 1)
    }
  }

  return {
    sample(geometry: ShapeGeometry, time: number, rainAmount: number, slideSpeed: number) {
      if (lastTime !== undefined && time < lastTime) {
        seed = 79
        drops.length = 0
        marks.length = 0
        nextArrival = .34
        carried = 0
        primed = false
      }
      // Missing time is discarded so changing tab never advances drops in one jump.
      const gap = lastTime === undefined ? 0 : time - lastTime
      const delta = gap > .20 ? 0 : clamp(gap, 0, MAX_STEP_WINDOW)
      const amount = clamp(rainAmount, 0, 2)
      const targetSpeed = clamp(slideSpeed, .25, 2)
      lastTime = time
      frame.drops.fill(0)
      frame.trails.fill(0)
      if (amount <= .01) return frame
      if (!primed) {
        primed = true
        speed = targetSpeed
        const count = Math.min(RAIN_DROP_LIMIT, Math.round(2 + amount * 8))
        for (let i = 0; i < count; i++) seedsAt(amount, true)
      }

      carried += delta
      while (carried + 1e-9 >= STEP) {
        advance(amount, targetSpeed)
        carried -= STEP
      }

      const scaleX = geometry.width / FIELD_WIDTH
      const scaleY = geometry.height / FIELD_HEIGHT
      const scale = Math.min(scaleX, scaleY)
      const visibility = clamp(amount * 1.8)
      drops.forEach((drop, index) => {
        const arrival = clamp(drop.age / .37)
        const absorption = 1 - clamp(drop.absorbingFor / .21)
        const radius = drop.radius * scale * Math.sqrt(arrival * absorption * visibility)
        frame.drops.set([drop.x * scaleX, drop.y * scaleY, radius, drop.stretch], index * 4)
      })
      marks.forEach((mark, index) => {
        const fade = (.32 + .68 * clamp(mark.age / .05)) * (1 - clamp(mark.age / mark.life)) ** 1.75
        frame.trails.set([
          mark.start.x * scaleX, mark.start.y * scaleY, mark.end.x * scaleX, mark.end.y * scaleY,
          mark.width * scale, fade * visibility, 0, 0,
        ], index * 8)
      })
      return frame
    },
  }
}

export const surfaceWeatherGLSL = `
uniform float u_weatherRain, u_weatherFrost, u_frostCoverage;
uniform sampler2D u_frostPattern;
uniform vec3 u_weatherLight;
uniform vec4 u_rainDrops[${RAIN_DROP_LIMIT}], u_rainTrails[${RAIN_TRAIL_LIMIT * 2}];

vec4 weatherOver(vec4 base, vec3 color, float opacity) {
  return vec4(color * opacity, opacity) + base * (1.0 - opacity);
}

vec4 frostSurface(vec2 p) {
  vec2 uv = p / (u_half * 2.0) + .5;
  vec4 textureField = texture2D(u_frostPattern, uv);
  float mist = textureField.g * (1.0 - smoothstep(-.012, .014, textureField.r - u_frostCoverage));
  float crystal = textureField.b * (1.0 - smoothstep(-.008, .017, textureField.a - u_frostCoverage));
  if (max(mist, crystal) < .004) return vec4(0.0);

  vec2 ripple = vec2(textureField.g - .46, textureField.b - .31) * vec2(1.35, 1.15);
  vec3 refracted = scene(screenPoint(p + ripple));
  vec3 diffuse = (
    refracted * 2.0 + scene(screenPoint(p + vec2(-.67, .39))) + scene(screenPoint(p + vec2(.57, -.40)))
  ) * .25;
  vec3 sheen = mix(u_weatherLight, vec3(.90, .966, 1.0), .64);
  vec3 vapor = mix(diffuse, sheen, .59 + textureField.g * .07);
  vec3 facets = mix(refracted * (.93 + .08 * textureField.g), sheen, .76);
  vec4 cover = weatherOver(vec4(0.0), vapor, mist * .46 * u_weatherFrost);
  cover = weatherOver(cover, facets, crystal * .69 * u_weatherFrost);
  return vec4(cover.rgb / max(cover.a, .0001), cover.a);
}

vec4 weatherSurface(vec2 p, float inside) {
  vec4 accumulated = vec4(0.0);
  if (u_weatherFrost > .002 && u_frostCoverage > 0.0) {
    vec4 frost = frostSurface(p);
    accumulated = weatherOver(accumulated, frost.rgb, frost.a);
  }

  if (u_weatherRain > .002) {
    float pixel = clamp(max(length(dFdx(p)), length(dFdy(p))), .35, 2.1);
    for (int i = 0; i < ${RAIN_TRAIL_LIMIT}; ++i) {
      vec4 path = u_rainTrails[i * 2];
      vec2 wet = u_rainTrails[i * 2 + 1].xy;
      if (wet.y <= .001 || p.y < path.y - 2.0 || p.y > path.w + 2.0
        || p.x < min(path.x, path.z) - 2.0 || p.x > max(path.x, path.z) + 2.0) continue;
      vec2 direction = path.zw - path.xy;
      float along = clamp(dot(p - path.xy, direction) / max(0.001, dot(direction, direction)), 0.0, 1.0);
      vec2 offset = p - (path.xy + direction * along);
      float contact = band(length(offset), 0.0, wet.x + pixel * .24);
      vec3 transmitted = scene(screenPoint(p - offset * .80 + vec2(0.0, .7)));
      vec3 tint = mix(transmitted, u_weatherLight, .08);
      accumulated = weatherOver(accumulated, tint, u_weatherRain * contact * wet.y * .46);
    }

    for (int i = 0; i < ${RAIN_DROP_LIMIT}; ++i) {
      vec4 drop = u_rainDrops[i];
      if (drop.z < .30) continue;
      vec2 delta = p - drop.xy;
      float motion = drop.w - 1.0;
      float height = drop.z * (delta.y < 0.0 ? drop.w : 1.0 + .12 * motion);
      if (abs(delta.x) > drop.z + pixel || abs(delta.y) > height + pixel) continue;
      float y = delta.y / height;
      float width = drop.z * (1.0 - .31 * motion * smoothstep(.05, .87, -y));
      vec2 q = vec2(delta.x / width, y);
      float radius = length(q);
      float feather = min(.25, pixel * .47 / drop.z);
      float profile = 1.0 - smoothstep(1.0 - feather, 1.0 + feather, radius);
      if (profile <= .001) continue;

      float dome = sqrt(max(0.0, 1.0 - dot(q, q)));
      // Curved normal magnifies and bends the very same frame seen by the base lens.
      vec2 shifted = p - delta * (.24 + .29 * dome) + vec2(-.40, .75) * (1.0 - dome);
      vec3 transmission = scene(screenPoint(shifted));
      vec2 n = q / max(.001, radius);
      float facing = dot(normalize(vec2(-.62, -.79)), n);
      float shadow = band(radius, .81, .19) * smoothstep(-.36, .92, -facing);
      float edge = band(radius, .82, .14) * max(0.0, facing);
      float spark = exp(-dot(q - vec2(-.30, -.39), q - vec2(-.30, -.39)) * 21.0);
      float bounce = exp(-dot(q - vec2(.27, .43), q - vec2(.27, .43)) * 16.0);
      vec3 droplet = transmission * (1.0 - .31 * shadow);
      vec3 light = mix(transmission, u_weatherLight, .82);
      droplet = mix(droplet, light, min(.77, spark * .77 + edge * .20 + bounce * .16));
      float opacity = profile * u_weatherRain * (.59 + .34 * max(spark, shadow));
      accumulated = weatherOver(accumulated, droplet, opacity);
    }
  }

  return vec4(accumulated.rgb / max(.0001, accumulated.a), accumulated.a * inside);
}
`
