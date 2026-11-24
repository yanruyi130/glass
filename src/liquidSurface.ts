import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, DynamicDrawUsage, LinearFilter,
  Mesh, PerspectiveCamera, Scene, ShaderMaterial, SRGBColorSpace, Vector2, Vector3, Vector4, WebGLRenderer,
} from 'three'
import { clamp, mix } from './material'

const FILM = {
  palette: {
    deep: '#091d56', cobalt: '#184bc7', lake: '#0e82bb', cyan: '#6cd7e9', lavender: '#9b9bdb', glint: '#e6fbff',
    sky: [
      [0, '#77badb'], [.24, '#a6c2d3'], [.42, '#d4d5d9'], [.59, '#efe4d5'], [1, '#c5dfeb'],
    ],
  },
  wave: { amplitude: 1.04, travel: .69, localBend: .73, disturbance: .86, span: 8.6, response: 10.4 },
  fold: { neck: .43, roll: .63 },
  optics: {
    transmission: .82,
    absorption: [1.88, .93, .17],
    refraction: .103,
    refractiveIndex: 1.38,
    roughness: .24,
    reflection: .82,
    rimLight: .73,
    focusDepth: 9.0,
    focusRange: 4.9,
  },
  quality: {
    fine: { across: 152, along: 96, width: 920, height: 545 },
    compact: { across: 96, along: 66, width: 710, height: 470 },
  },
} as const

type Quality = typeof FILM.quality[keyof typeof FILM.quality]
type Inspection = 'wireframe' | 'side'

const VERTEX = `
  attribute float cavity;
  varying vec2 vSurfaceYZ;
  varying vec3 vViewPosition;
  varying vec3 vViewNormal;
  varying float vCavity;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vSurfaceYZ = position.yz;
    vViewPosition = viewPosition.xyz;
    vViewNormal = normalMatrix * normal;
    vCavity = cavity;
    gl_Position = projectionMatrix * viewPosition;
  }
`

const FRAGMENT = `
  uniform vec3 uDeep, uCobalt, uLake, uCyan, uLavender, uGlint;
  uniform vec2 uFrame;
  uniform vec3 uOptics;
  uniform vec4 uLight;
  uniform vec3 uAbsorption;
  uniform float uIor;
  uniform sampler2D uEnvironment;
  varying vec2 vSurfaceYZ;
  varying vec3 vViewPosition;
  varying vec3 vViewNormal;
  varying float vCavity;

  vec3 readEnvironment(vec2 center, vec2 radius) {
    vec3 color = texture2D(uEnvironment, center).rgb * 0.36;
    color += texture2D(uEnvironment, center + vec2(radius.x, radius.y * 0.42)).rgb * 0.16;
    color += texture2D(uEnvironment, center - vec2(radius.x, radius.y * 0.42)).rgb * 0.16;
    color += texture2D(uEnvironment, center + vec2(-radius.x * 0.42, radius.y)).rgb * 0.16;
    color += texture2D(uEnvironment, center - vec2(-radius.x * 0.42, radius.y)).rgb * 0.16;
    return color;
  }

  float reflectionStrip(vec3 ray, vec3 rayDx, vec3 rayDy, vec3 center, vec2 span, float tilt) {
    vec3 horizontal = normalize(cross(vec3(0.0, 1.0, 0.0), center));
    vec3 vertical = cross(center, horizontal);
    vec3 major = horizontal + tilt * vertical;
    vec3 minor = vertical - tilt * horizontal;
    vec2 position = vec2(dot(ray, major), dot(ray, minor));
    // Filter narrow strips by the reflected ray's footprint in this pixel.
    vec2 dx = vec2(dot(rayDx, major), dot(rayDx, minor));
    vec2 dy = vec2(dot(rayDy, major), dot(rayDy, minor));
    vec2 footprint = min(vec2(0.12), 0.62 * sqrt(dx * dx + dy * dy));
    vec2 filtered = sqrt(span * span + footprint * footprint);
    vec2 normalized = position / filtered;
    float coverage = (span.x * span.y) / (filtered.x * filtered.y);
    return coverage * exp(-dot(normalized, normalized)) * smoothstep(0.18, 0.78, dot(ray, center));
  }

  float filteredRim(float facing, float exponent) {
    float halfWidth = clamp(0.5 * fwidth(facing), 0.001, 0.11);
    float near = max(0.0, facing - halfWidth);
    float far = min(1.0, facing + halfWidth);
    float integral = pow(1.0 - near, exponent + 1.0) - pow(1.0 - far, exponent + 1.0);
    return integral / ((far - near) * (exponent + 1.0));
  }

  void main() {
    // Rays, the eye and the shading normal meet in view space. The reflected
    // ray is then rotated back to sample the fixed world-space lights.
    vec3 normal = normalize(vViewNormal);
    vec3 eye = normalize(-vViewPosition);
    vec3 n = faceforward(normal, -eye, normal);
    mat3 worldToView = mat3(viewMatrix);
    vec3 light = worldToView * normalize(vec3(0.49, 0.75, 0.41));
    vec3 reflected = transpose(worldToView) * reflect(-eye, normal);
    vec3 rayDx = dFdx(reflected);
    vec3 rayDy = dFdy(reflected);
    float facing = clamp(abs(dot(normal, eye)), 0.0, 1.0);
    float faceWeight = smoothstep(0.0, 0.16, facing);
    float interior = smoothstep(0.045, 0.31, facing);
    float edgeDiffuse = 0.20 + 0.42 * abs(dot(normal, light));
    float diffuse = mix(edgeDiffuse, max(0.0, dot(n, light)), faceWeight);
    vec2 uv = gl_FragCoord.xy / uFrame;
    float distanceFromFocus = (length(vViewPosition) - uLight.z) / uLight.w;
    float focus = 1.0 / (1.0 + distanceFromFocus * distanceFromFocus);
    float lower = 1.0 - smoothstep(-1.45, 1.19, vSurfaceYZ.x);
    float cavity = vCavity * mix(0.42, 1.0, interior);
    float density = clamp(0.37 * cavity + 0.52 * lower + 0.17 * smoothstep(-4.3, 4.4, vSurfaceYZ.y), 0.0, 1.0);
    float tone = clamp(0.13 + 0.71 * diffuse - 0.24 * cavity - 0.29 * lower, 0.0, 1.0);
    vec3 blue = mix(uDeep, uCobalt, smoothstep(0.03, 0.58, tone));
    vec3 body = mix(blue, uLake, smoothstep(0.28, 0.86, tone));

    float roughness = uOptics.z + 0.20 * (1.0 - focus);
    float fresnelBase = pow((uIor - 1.0) / (uIor + 1.0), 2.0);
    float fresnel = mix(fresnelBase, 1.0, pow(1.0 - facing, 5.0));
    vec3 refracted = refract(-eye, n, 1.0 / uIor);
    vec2 units = vec2(uFrame.y / uFrame.x, 1.0);
    // Keep the foreground sample aligned at a tangent. Refraction and its
    // filter radius open together on the smoothly turning visible surface.
    vec2 shift = (refracted.xy + eye.xy) * uOptics.y * (1.5 + 0.75 * density) * interior;
    float blur = 0.003 + interior * roughness * (0.016 + 0.033 * (1.0 - focus) + 0.011 * density);
    vec3 environment = readEnvironment(uv + shift * units, blur * units);
    // Longer optical paths absorb more warm light, revealing the deeper blue.
    float opticalDepth = mix(0.23, 1.48, density) * (1.0 + 0.25 * (1.0 - facing));
    vec3 transmission = environment * exp(-uAbsorption * opticalDepth);
    float clarity = uOptics.x * mix(0.93, 0.39, density) * (1.0 - 0.19 * fresnel);
    vec3 base = mix(body, transmission, clarity);

    float soft = reflectionStrip(reflected, rayDx, rayDy, normalize(vec3(-0.26, 0.55, -0.79)), vec2(0.87, 0.10 + 0.30 * roughness), 0.28);
    float ribbon = reflectionStrip(reflected, rayDx, rayDy, normalize(vec3(0.46, 0.25, -0.85)), vec2(0.68, 0.028 + 0.13 * roughness), -0.19);
    float shade = reflectionStrip(reflected, rayDx, rayDy, normalize(vec3(-0.10, 0.06, -0.99)), vec2(0.79, 0.14 + 0.16 * roughness), 0.09);
    // The dark and bright strips share the same reflection ray and the same
    // deformed normal, so they stretch and turn with the surface.
    base = mix(base, mix(uDeep, uCobalt, 0.26 + 0.18 * diffuse), interior * uLight.x * shade * (0.24 + 0.38 * fresnel));
    float violet = 0.13 * reflectionStrip(reflected, rayDx, rayDy, normalize(vec3(-0.68, 0.39, -0.62)), vec2(0.34, 0.16), 0.23);
    base = mix(base, uLavender, violet * (1.0 - shade));
    base = mix(base, uCyan, uLight.x * soft * (0.23 + 0.19 * fresnel));

    float edgeLight = reflectionStrip(reflected, rayDx, rayDy, normalize(vec3(0.44, -0.12, -0.89)), vec2(0.52, 0.12 + 0.14 * roughness), -0.15);
    float rim = filteredRim(facing, mix(20.0, 10.0, roughness)) * (0.08 + 0.59 * edgeLight + 0.20 * ribbon + 0.13 * soft);
    float key = faceWeight * pow(max(0.0, dot(n, normalize(light + eye))), mix(64.0, 20.0, roughness));
    // Hand over the narrow reflection to the grazing rim on the same film.
    // A shared lobe avoids adding two creases around the turning point.
    float broadGlint = uLight.x * (0.16 * soft + 0.12 * key);
    float ribbonGlint = uLight.x * (0.18 + 0.28 * fresnel) * ribbon;
    float edgeGlint = uLight.y * rim * (0.37 + 0.63 * focus);
    float specular = clamp(broadGlint + mix(edgeGlint, ribbonGlint, interior), 0.0, 0.65);
    vec2 reflectionUV = vec2(0.53 + reflected.x * 0.31, 0.66 + reflected.y * 0.23);
    vec3 reflectedEnvironment = (texture2D(uEnvironment, reflectionUV + vec2(0.06, 0.04)).rgb
      + texture2D(uEnvironment, reflectionUV - vec2(0.06, 0.04)).rgb) * 0.5;
    vec3 glint = mix(uGlint, reflectedEnvironment, 0.19 * soft);
    gl_FragColor = vec4(mix(base, glint, specular), 1.0);
    #include <colorspace_fragment>
  }
`

function derivativeStencils(stations: readonly number[]) {
  return stations.map((station, index) => {
    const previous = Math.max(0, index - 1)
    const next = Math.min(stations.length - 1, index + 1)
    const before = station - stations[previous]
    const after = stations[next] - station
    return {
      previous, next,
      beforeRate: before > 0 ? 1 / before : 0,
      afterRate: after > 0 ? 1 / after : 0,
      afterWeight: before === 0 ? 1 : after === 0 ? 0 : before / (before + after),
      curvatureScale: before > 0 && after > 0 ? 2 / (before + after) : 0,
    }
  })
}

function makeSurfaceGeometry({ across, along }: Quality) {
  const stride = across + 1
  const positions = new BufferAttribute(new Float32Array(stride * (along + 1) * 3), 3).setUsage(DynamicDrawUsage)
  const normals = new BufferAttribute(new Float32Array(positions.count * 3), 3).setUsage(DynamicDrawUsage)
  const cavities = new BufferAttribute(new Float32Array(positions.count), 1).setUsage(DynamicDrawUsage)
  const indices = new Uint16Array(across * along * 6)
  let index = 0
  for (let row = 0; row < along; row++) {
    for (let col = 0; col < across; col++) {
      const a = row * stride + col
      const b = a + 1
      const c = a + stride
      const d = c + 1
      indices.set([a, c, b, b, c, d], index)
      index += 6
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', positions)
  geometry.setAttribute('normal', normals)
  geometry.setAttribute('cavity', cavities)
  geometry.setIndex(new BufferAttribute(indices, 1))
  const columns = Array.from({ length: stride }, (_, column) => {
    const station = 2 * column / across - 1
    // Use more columns where the foreground fills a larger part of the view.
    return station * (.48 + .52 * station * station)
  })
  const sections = Array.from({ length: along + 1 }, (_, row) => {
    const station = row / along
    // Reserve more rows for the far lip and the transition into the crest.
    const depth = station * (.64 + .36 * station)
    const curl = (depth - .29) * 5.8
    return {
      depth, z: mix(-10.4, 9.2, depth), curl: 1 / (1 + curl * curl),
      returnCurve: Math.exp(-17.2 * depth), outer: (1 - depth) ** 3,
      foreground: depth * depth * (3 - 2 * depth),
    }
  })
  const columnStencils = derivativeStencils(columns)
  const depthStencils = derivativeStencils(sections.map(section => section.z))
  return { geometry, positions, normals, cavities, columns, sections, columnStencils, depthStencils, stride }
}

function flowCell(x: number, t: number) {
  const cell = Math.imul(x ^ 0x4519, 0x9e3779b1) ^ Math.imul(t ^ 0x18cf, 0x85ebca77)
  const mixed = Math.imul(cell ^ (cell >>> 16), 0x7feb352d)
  return ((mixed ^ (mixed >>> 15)) >>> 0) / 0x80000000 - 1
}

function flowEase(fraction: number) {
  return fraction * fraction * fraction * (10 + fraction * (6 * fraction - 15))
}

function flowSpline(a: number, b: number, c: number, d: number, fraction: number) {
  // A cubic B-spline shares neighboring cells and their derivatives across
  // intervals. A cell boundary does not stop or restart a stretch.
  const square = fraction * fraction
  const cube = square * fraction
  const remaining = 1 - fraction
  return (a * remaining * remaining * remaining + b * (4 - 6 * square + 3 * cube)
    + c * (1 + 3 * fraction + 3 * square - 3 * cube) + d * cube) / 6
}

function pressureRow(x: number, t: number, fraction: number) {
  return flowSpline(flowCell(x - 1, t), flowCell(x, t), flowCell(x + 1, t), flowCell(x + 2, t), fraction)
}

function flowPressure(position: number, time: number) {
  const x = Math.floor(position)
  const t = Math.floor(time)
  const along = position - x
  const pressure = flowSpline(pressureRow(x, t - 1, along), pressureRow(x, t, along),
    pressureRow(x, t + 1, along), pressureRow(x, t + 2, along), time - t)
  return Math.tanh(pressure * 2.15)
}

function deform(surface: ReturnType<typeof makeSurfaceGeometry>, width: number, time: number) {
  const { positions, normals, cavities, columns, sections, columnStencils, depthStencils, stride } = surface
  const { amplitude, travel, localBend, disturbance, span, response } = FILM.wave
  // Integrate two slow, shallow speed variations rather than scaling time by
  // an instantaneous speed. The resulting travel always advances to the right.
  const offset = travel * (time + .062 * Math.sin(time * .119) / .119
    + .041 * (Math.sin(time * .053 + 1.4) - Math.sin(1.4)) / .053)
  const pressureTime = time / response
  for (let col = 0; col < stride; col++) {
    const x = width * columns[col]
    const station = (x - offset) / span
    // Entering and trailing parts sample the same evolving field, with a
    // short lag and a spatial offset along the direction of the pull.
    const leading = disturbance * flowPressure(station - .96, pressureTime + 3.81)
    const following = disturbance * flowPressure(station - 1.19, pressureTime + 3.56)
    const guide = disturbance * flowPressure(station * .67 + 4.73, pressureTime * .64 + 3.41)
    const ribbonPhase = 2.26 * station + .71 * guide + .55 * leading + .16
    const drift = Math.sin(ribbonPhase + .31 * Math.sin(.62 * ribbonPhase + .59 * following))
    const lean = .28 * Math.tanh((x - 2.5 * guide) / 5.1) + (.63 + .12 * following) * drift
    const bend = .81 * lean + .58 * guide + .31 * leading
    const tension = flowEase(clamp(.47 + .69 * leading + .39 * guide))
    const hingeY = .18 + .30 * bend
    const hingeZ = -1.10 + 2.65 * bend + .63 * following
    for (const [row, { depth, z: base, curl, returnCurve, outer, foreground }] of sections.entries()) {
      const pull = mix(leading, following, depth * (2 - depth))
      const roll = localBend * (1.04 * bend + .51 * pull) * curl
      const z = base + 1.74 * returnCurve + outer * (1.18 * bend + .38 * guide) + roll
      const axis = -2.89 + 2.97 * bend + 1.18 * pull + .59 * tension
      const reach = z - axis + (depth - .32) * (1.55 * guide + .71 * pull)
      // Shape the crest as a stretched shoulder with a tighter rise and a
      // longer release. A falling pull flattens and lengthens both slopes.
      const neck = localBend * FILM.fold.neck * tension
      const rise = .5 + .5 * Math.tanh((reach + 1.76) / (1.40 - neck - .31 * pull))
      const release = .5 - .5 * Math.tanh((reach - 1.53 + .62 * pull) / (2.36 + .48 * guide - .52 * pull))
      const lift = rise * release * (1.76 + 1.09 * lean + .70 * pull + .24 * guide)
      const trough = (reach - 4.35 - .43 * guide) / (2.92 - .41 * pull)
      const hollow = Math.exp(-trough * trough) * (.26 + .22 * pull)
      const basin = .56 * following + .35 * guide - .69 * lean + .27 * Math.sin(.34 * z + 1.15 * bend)
      const acrossBasin = (z - 2.68 - 1.43 * bend + .68 * pull) / (3.22 - .45 * pull)
      const front = basin * (.39 + 1.30 * Math.exp(-acrossBasin * acrossBasin)) * foreground
      const drape = (.88 * lean + .28 * guide - .65) * outer
      const y = -.36 + amplitude * (lift - hollow + front + drape) - 1.13 * returnCurve

      // The roll turns points around a local hinge. Its angle fades with
      // radius, preserving the continuous sheet through the turn.
      const dy = y - hingeY
      const dz = z - hingeZ
      const angle = localBend * FILM.fold.roll * tension * (.86 + .14 * pull) * Math.exp(-(dy * dy + dz * dz) / 4.5)
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      positions.setXYZ(row * stride + col, x, hingeY + dy * cos - dz * sin, hingeZ + dz * cos + dy * sin)
    }
  }

  // Differentiate the deformed positions along the sheet's two parameters.
  // The non-uniform stencil estimates the tangent at the vertex itself and
  // gives both triangles at each diagonal the same smooth normal field.
  const widthSquared = width * width
  for (const [row, depth] of depthStencils.entries()) {
    const rowStart = row * stride
    const farStart = depth.previous * stride
    const nearStart = depth.next * stride
    for (let col = 0; col < stride; col++) {
      const across = columnStencils[col]
      const i = rowStart + col
      const y = positions.getY(i)
      const z = positions.getZ(i)
      const left = rowStart + across.previous
      const right = rowStart + across.next
      const far = farStart + col
      const near = nearStart + col
      const dyLeft = (y - positions.getY(left)) * across.beforeRate
      const dyRight = (positions.getY(right) - y) * across.afterRate
      const dyFar = (y - positions.getY(far)) * depth.beforeRate
      const dyNear = (positions.getY(near) - y) * depth.afterRate
      const dzLeft = (z - positions.getZ(left)) * across.beforeRate
      const dzRight = (positions.getZ(right) - z) * across.afterRate
      const dzFar = (z - positions.getZ(far)) * depth.beforeRate
      const dzNear = (positions.getZ(near) - z) * depth.afterRate
      const dyAcross = mix(dyLeft, dyRight, across.afterWeight)
      const dyDepth = mix(dyFar, dyNear, depth.afterWeight)
      const dzAcross = mix(dzLeft, dzRight, across.afterWeight)
      const dzDepth = mix(dzFar, dzNear, depth.afterWeight)
      const nx = dyDepth * dzAcross - dzDepth * dyAcross
      const ny = width * dzDepth
      const nz = -width * dyDepth
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz)
      if (length <= 1e-8) {
        normals.setXYZ(i, 0, 1, 0)
        cavities.setX(i, 0)
        continue
      }
      const normalY = ny / length
      const normalZ = nz / length
      normals.setXYZ(i, nx / length, normalY, normalZ)

      // Measure how the sheet bends into its own normal, rather than using
      // world height as curvature when the depth tangent turns at the fold.
      const acrossBend = across.curvatureScale * (normalY * (dyRight - dyLeft) + normalZ * (dzRight - dzLeft))
        / (widthSquared + dyAcross * dyAcross + dzAcross * dzAcross)
      const depthBend = depth.curvatureScale * (normalY * (dyNear - dyFar) + normalZ * (dzNear - dzFar))
        / Math.max(.40, dyDepth * dyDepth + dzDepth * dzDepth)
      const concavity = Math.max(0, acrossBend + depthBend)
      const response = concavity * concavity
      cavities.setX(i, response / (.84 + response))
    }
  }

  positions.needsUpdate = true
  normals.needsUpdate = true
  cavities.needsUpdate = true
}

export function createLiquidSurface() {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('webgl2', { alpha: true, antialias: true })
  const renderer = context && new WebGLRenderer({ canvas, context })
  const environmentCanvas = document.createElement('canvas')
  environmentCanvas.width = 384
  environmentCanvas.height = 256
  const environment = environmentCanvas.getContext('2d', { alpha: false })!
  const { palette, optics } = FILM
  const gradient = environment.createLinearGradient(0, 0, environmentCanvas.width * .13, environmentCanvas.height)
  for (const [offset, color] of palette.sky) gradient.addColorStop(offset, color)
  environment.fillStyle = gradient
  environment.fillRect(0, 0, environmentCanvas.width, environmentCanvas.height)
  const environmentTexture = new CanvasTexture(environmentCanvas)
  environmentTexture.colorSpace = SRGBColorSpace
  environmentTexture.minFilter = LinearFilter
  environmentTexture.generateMipmaps = false
  let quality: Quality = FILM.quality.fine
  let surface = makeSurfaceGeometry(quality)
  const scene = new Scene()
  const camera = new PerspectiveCamera(44, 1, .2, 60)
  const uniforms = {
    uDeep: { value: new Color(palette.deep) }, uCobalt: { value: new Color(palette.cobalt) },
    uLake: { value: new Color(palette.lake) }, uCyan: { value: new Color(palette.cyan) },
    uLavender: { value: new Color(palette.lavender) }, uGlint: { value: new Color(palette.glint) },
    uFrame: { value: new Vector2() }, uEnvironment: { value: environmentTexture },
    uOptics: { value: new Vector3(optics.transmission, optics.refraction, optics.roughness) },
    uLight: { value: new Vector4(optics.reflection, optics.rimLight, optics.focusDepth, optics.focusRange) },
    uAbsorption: { value: new Vector3(...optics.absorption) },
    uIor: { value: optics.refractiveIndex },
  }
  const material = new ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms, side: DoubleSide, forceSinglePass: true,
  })
  const mesh = new Mesh(surface.geometry, material)
  mesh.frustumCulled = false
  scene.add(mesh)
  renderer?.setClearColor(0, 0)

  function paintEnvironment(target: CanvasRenderingContext2D) {
    target.drawImage(environmentCanvas, 0, 0, 1, 1)
  }

  function render(
    target: CanvasRenderingContext2D, width: number, height: number, detail: number, time: number, inspection?: Inspection,
  ) {
    if (!renderer || context?.isContextLost()) return
    const nextQuality = width < 620 || detail < .9 ? FILM.quality.compact : FILM.quality.fine
    if (quality !== nextQuality) {
      surface.geometry.dispose()
      quality = nextQuality
      surface = makeSurfaceGeometry(quality)
      mesh.geometry = surface.geometry
    }
    const scale = Math.min(.96, quality.width * detail / width, quality.height * detail / height)
    const frameWidth = Math.max(2, Math.round(width * scale))
    const frameHeight = Math.max(2, Math.round(height * scale))
    if (canvas.width !== frameWidth || canvas.height !== frameHeight) renderer.setSize(frameWidth, frameHeight, false)
    const aspect = width / height
    const narrow = clamp((1.55 - aspect) / .90)
    camera.aspect = aspect
    if (import.meta.env.DEV && inspection === 'side') {
      camera.fov = 50
      camera.position.set(12.9, 3.65, 4.1)
      camera.lookAt(0, .35, -.9)
    } else {
      camera.fov = 42 + 9 * narrow
      camera.position.set(.33, 3.03 + .31 * narrow, 8.35 + .87 * narrow)
      camera.lookAt(0, .54, -.49)
    }
    camera.updateProjectionMatrix()
    if (import.meta.env.DEV) material.wireframe = inspection === 'wireframe'

    // The visible backdrop and optical texture share the same fixed gradient.
    // Transmission and reflection resolve within one depth-tested mesh draw.
    deform(surface, Math.max(9.1, 10.1 * aspect), time)
    uniforms.uFrame.value.set(frameWidth, frameHeight)
    renderer.render(scene, camera)
    target.drawImage(canvas, 0, 0, 1, 1)
  }

  function destroy() {
    surface.geometry.dispose()
    material.dispose()
    environmentTexture.dispose()
    renderer?.dispose()
  }

  return {
    paintEnvironment, render, destroy,
    inspectGeometry: import.meta.env.DEV ? () => ({ geometry: surface.geometry, camera, material, canvas }) : undefined,
  }
}
