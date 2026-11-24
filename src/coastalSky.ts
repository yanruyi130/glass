const clamp = (v: number) => Math.max(0, Math.min(1, v))
const smooth = (v: number) => {
  const t = clamp(v)
  return t * t * (3 - 2 * t)
}

function hash(x: number, y: number, seed: number) {
  let n = Math.imul(x + Math.imul(seed, 1973), 3284157443) + Math.imul(y, 1911520717)
  n = Math.imul(n ^ n >>> 17, 1274126177)
  return ((n ^ n >>> 16) >>> 0) / 4294967295
}

function noise(x: number, y: number, seed: number) {
  const i = Math.floor(x), j = Math.floor(y)
  const u = smooth(x - i), v = smooth(y - j)
  const first = hash(i, j, seed) * (1 - u) + hash(i + 1, j, seed) * u
  const second = hash(i, j + 1, seed) * (1 - u) + hash(i + 1, j + 1, seed) * u
  return first * (1 - v) + second * v
}

function cloudAtlas(seed: number, stretched: boolean) {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 168
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const pixels = ctx.createImageData(canvas.width, canvas.height)
  const heights = [.62, .57, .47, .46, .53, .43, .58, .67]
  const puffs = heights.map((y, i) => {
    const random = hash(i, 5, seed)
    const x = .135 + i * .103 + (hash(i, 1, seed) - .5) * .06
    const width = Math.min(.078 + random * .125, Math.min(x, 1 - x) * .91)
    return { x, y: y + (hash(i, 2, seed) - .5) * .18, width,
      height: (stretched ? .13 : .16) + hash(i, 3, seed) * (stretched ? .17 : .29) }
  })
  for (let py = 0; py < canvas.height; py++) {
    const y = (py + .5) / canvas.height
    for (let px = 0; px < canvas.width; px++) {
      const x = (px + .5) / canvas.width
      const coarse = noise(x * 13 + .22, y * 6.7, seed)
      const detail = noise(x * 28 + 8.5, y * 16, seed + 7)
      const fine = noise(x * 78, y * 45, seed + 13)
      const grain = noise(x * 149, y * 84, seed + 11)
      const turbulence = .57 * coarse + .26 * detail + .11 * fine + .06 * grain
      let fluid = 0
      for (const puff of puffs) {
        const dx = (x - puff.x) / puff.width, dy = (y - puff.y) / puff.height
        const density = Math.max(0, 1 - dx * dx - dy * dy)
        fluid = Math.max(fluid, density)
      }
      const density = fluid * .73 + (turbulence - .48) * .96
      const edge = smooth(Math.min(x, 1 - x) * 20) * smooth(Math.min(y, 1 - y) * 10)
      const opacity = smooth((density - .03) / .33) * edge
      if (opacity < .002) continue
      const shade = clamp(.07 + y * .71 + (.55 - coarse) * .49 + (.50 - detail) * .27 + (.48 - fine) * .11 - (1 - fluid) * .11)
      const warmLight = smooth((1 - y) * .9 + x * .23)
      const i = (py * canvas.width + px) * 4
      pixels.data[i] = 249 - 69 * shade + 2 * warmLight
      pixels.data[i + 1] = 251 - 55 * shade + 1 * warmLight
      pixels.data[i + 2] = 250 - 39 * shade + 1.3 * fine
      pixels.data[i + 3] = opacity * 255
    }
  }
  ctx.putImageData(pixels, 0, 0)
  return canvas
}

export function createCoastalSky() {
  const clouds = [
    { image: cloudAtlas(73, false), x: -.12, y: .115, span: .42, height: .215, speed: .00195, alpha: .83 },
    { image: cloudAtlas(137, false), x: .27, y: .169, span: .44, height: .245, speed: .00136, alpha: .94 },
    { image: cloudAtlas(34, true), x: .67, y: .301, span: .31, height: .116, speed: .00095, alpha: .70 },
    { image: cloudAtlas(97, true), x: -.03, y: .363, span: .37, height: .072, speed: .00109, alpha: .54 },
  ]
  return (ctx: CanvasRenderingContext2D, width: number, height: number, time: number, horizon: number, lightX: number, lightY: number) => {
    const skyline = horizon * height
    ctx.save()
    const sky = ctx.createLinearGradient(0, 0, 0, skyline)
    sky.addColorStop(0, '#3178ad')
    sky.addColorStop(.46, '#609fc7')
    sky.addColorStop(.78, '#97c4d9')
    sky.addColorStop(1, '#b7d9e5')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, width, Math.ceil(skyline + 1))
    ctx.beginPath()
    ctx.rect(0, 0, width, Math.ceil(skyline + 1))
    ctx.clip()
    const sunX = lightX * width, sunY = lightY * height
    const r = Math.min(width * .32, height * .34)
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, r)
    glow.addColorStop(0, 'rgba(255,251,238,.44)')
    glow.addColorStop(.19, 'rgba(248,245,229,.21)')
    glow.addColorStop(.66, 'rgba(219,232,231,.09)')
    glow.addColorStop(1, 'rgba(200,228,240,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, width, skyline)
    const narrow = clamp((1.8 - width / height) / 1.15)
    for (const cloud of clouds) {
      const span = cloud.span * (1 + narrow * .27)
      const period = 1 + span + .16
      const origin = (cloud.x + time * cloud.speed + span + .08) % period - span - .08
      ctx.globalAlpha = cloud.alpha
      ctx.drawImage(cloud.image, origin * width, cloud.y * height, span * width, cloud.height * height * (1 - narrow * .07))
    }
    ctx.restore()
  }
}
