type Puff = readonly [x: number, y: number, radiusX: number, radiusY: number]

const CLOUDS = [
  { seed: 31, x: -.083, y: .064, width: .355, height: .206, speed: .0014, opacity: .82 },
  { seed: 67, x: .257, y: .176, width: .421, height: .262, speed: .0020, opacity: .98 },
  { seed: 14, x: .792, y: .202, width: .297, height: .160, speed: .0011, opacity: .79 },
] as const

function hash(x: number, y: number, seed: number) {
  const n = Math.imul(x ^ (seed * 73), 374761393) + Math.imul(y, 668265263)
  const h = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function smooth(value: number) {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

function noise(x: number, y: number, seed: number) {
  const row = Math.floor(y)
  const column = Math.floor(x)
  const u = smooth(x - column)
  const v = smooth(y - row)
  const a = hash(column, row, seed) * (1 - u) + hash(column + 1, row, seed) * u
  const b = hash(column, row + 1, seed) * (1 - u) + hash(column + 1, row + 1, seed) * u
  return a * (1 - v) + b * v
}

function createCloud(seed: number) {
  const cloud = document.createElement('canvas')
  cloud.width = 384
  cloud.height = 160
  const context = cloud.getContext('2d')
  if (!context) return cloud

  const base: Puff[] = [
    [.15, .64, .13, .14], [.25, .58, .16, .22], [.36, .48, .147, .31],
    [.49, .43, .158, .34], [.61, .53, .155, .26], [.72, .58, .135, .22],
    [.84, .64, .14, .14], [.54, .66, .34, .15],
  ]
  const puffs: Puff[] = base.map(([x, y, radiusX, radiusY], index) => [
    x, y + (hash(index, 1, seed) - .5) * .105,
    radiusX * (.85 + .24 * hash(index, 2, seed)),
    radiusY * (.78 + .35 * hash(index, 3, seed)),
  ])
  const image = context.createImageData(cloud.width, cloud.height)
  for (let j = 0; j < cloud.height; j++) {
    for (let i = 0; i < cloud.width; i++) {
      const x = i / cloud.width
      const y = j / cloud.height
      const broad = noise(x * 12, y * 8, seed)
      const fine = noise(x * 29, y * 18, seed + 7)
      const wisps = noise(x * 64, y * 29, seed + 12)
      let thickness = 0
      let light = 0
      let weight = 0

      for (const [cx, cy, radiusX, radiusY] of puffs) {
        const dx = (x - cx + (broad - .5) * .016) / radiusX
        const dy = (y - cy + (fine - .5) * .026) / radiusY
        const volume = Math.max(0, 1 - dx * dx - dy * dy)
        thickness = Math.max(thickness, volume)
        if (volume === 0) continue
        const surface = Math.sqrt(volume)
        light += volume * smooth(.39 + surface * .45 + dx * .22 - dy * .46)
        weight += volume
      }

      const density = thickness + (broad - .46) * .19 + (fine - .5) * .135 + (wisps - .5) * .07
      const opacity = smooth((density - .035) / .46) * (.62 + .38 * smooth((.87 - y) / .30))
      if (opacity === 0) continue
      const lit = smooth((weight ? light / weight : .7) * 1.13 + (broad - .4) * .19 + (fine - .5) * .07)
      const index = (j * cloud.width + i) * 4
      image.data[index] = 168 + lit * 84
      image.data[index + 1] = 207 + lit * 47
      image.data[index + 2] = 236 + lit * 19
      image.data[index + 3] = opacity * 255
    }
  }
  context.putImageData(image, 0, 0)
  return cloud
}

/** Baked density samples drift at different speeds in normalized background coordinates. */
export function createDayClouds() {
  const clouds = CLOUDS.map(cloud => ({ ...cloud, image: createCloud(cloud.seed) }))
  return (context: CanvasRenderingContext2D, time: number, daylight: number, narrow: number) => {
    context.save()
    for (const [index, cloud] of clouds.entries()) {
      const width = cloud.width * (1 + narrow * .35)
      const span = 1 + width + .16
      const x = (cloud.x + width + .08 + time * cloud.speed) % span - width - .08
      const y = cloud.y + Math.sin(time * (.09 + index * .033) + index) * .012 + narrow * .025
      context.globalAlpha = daylight * cloud.opacity
      context.drawImage(cloud.image, x, y, width, cloud.height)
    }
    context.restore()
  }
}
