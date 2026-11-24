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
  wave: { amplitude: 1.23, wavelength: 21.5, travel: .86, twist: .93, period: 8.4 },
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
    fine: { across: 152, along: 84, width: 920, height: 545 },
    compact: { across: 96, along: 56, width: 710, height: 470 },
  },
} as const

type Quality = typeof FILM.quality[keyof typeof FILM.quality]
type Inspection = 'wireframe' | 'side'

const VERTEX = `
  attribute float cavity;
  varying vec3 vSurface;
  varying vec3 vNormal;
  varying vec3 vViewNormal;
  varying float vCavity;

  void main() {
    vSurface = position;
    vNormal = normal;
    vViewNormal = normalMatrix * normal;
    vCavity = cavity;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
  varying vec3 vSurface;
  varying vec3 vNormal;
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

  float reflectionStrip(vec3 ray, vec3 center, vec2 span, float tilt) {
    vec3 horizontal = normalize(cross(vec3(0.0, 1.0, 0.0), center));
    vec3 vertical = cross(center, horizontal);
    vec2 position = vec2(dot(ray, horizontal), dot(ray, vertical));
    // The two spans represent the long and short sides of an environment light.
    position = vec2(position.x + tilt * position.y, position.y - tilt * position.x) / span;
    return exp(-dot(position, position)) * smoothstep(0.18, 0.78, dot(ray, center));
  }

  void main() {
    float face = gl_FrontFacing ? 1.0 : -1.0;
    vec3 n = normalize(vNormal) * face;
    vec3 eye = normalize(cameraPosition - vSurface);
    vec3 light = normalize(vec3(0.49, 0.75, 0.41));
    vec3 reflected = reflect(-eye, n);
    float diffuse = max(0.0, dot(n, light));
    float facing = max(0.0, dot(n, eye));
    vec2 uv = gl_FragCoord.xy / uFrame;
    float distanceFromFocus = (length(cameraPosition - vSurface) - uLight.z) / uLight.w;
    float focus = 1.0 / (1.0 + distanceFromFocus * distanceFromFocus);
    float lower = 1.0 - smoothstep(-1.45, 1.19, vSurface.y);
    float density = clamp(0.37 * vCavity + 0.52 * lower + 0.17 * smoothstep(-4.3, 4.4, vSurface.z), 0.0, 1.0);
    float tone = clamp(0.19 + 0.62 * diffuse - 0.30 * vCavity - 0.38 * lower, 0.0, 1.0);
    vec3 blue = mix(uDeep, uCobalt, smoothstep(0.03, 0.58, tone));
    vec3 body = mix(blue, uLake, smoothstep(0.28, 0.86, tone));

    float roughness = uOptics.z + 0.20 * (1.0 - focus);
    float fresnelBase = pow((uIor - 1.0) / (uIor + 1.0), 2.0);
    float fresnel = mix(fresnelBase, 1.0, pow(1.0 - facing, 5.0));
    vec3 viewRay = -(mat3(viewMatrix) * eye);
    vec3 refracted = refract(viewRay, normalize(vViewNormal) * face, 1.0 / uIor);
    vec2 units = vec2(uFrame.y / uFrame.x, 1.0);
    vec2 shift = (refracted.xy - viewRay.xy) * uOptics.y * (1.5 + 0.75 * density);
    float blur = 0.003 + roughness * (0.016 + 0.033 * (1.0 - focus) + 0.011 * density);
    vec3 environment = readEnvironment(uv + shift * units, blur * units);
    // Longer optical paths absorb more warm light, revealing the deeper blue.
    float opticalDepth = mix(0.23, 1.48, density) * (1.0 + 0.37 * (1.0 - facing));
    vec3 transmission = environment * exp(-uAbsorption * opticalDepth);
    float clarity = uOptics.x * mix(0.93, 0.39, density) * (1.0 - 0.42 * fresnel);
    vec3 base = mix(body, transmission, clarity);

    float soft = reflectionStrip(reflected, normalize(vec3(-0.26, 0.55, -0.79)), vec2(0.87, 0.10 + 0.30 * roughness), 0.28);
    float ribbon = reflectionStrip(reflected, normalize(vec3(0.46, 0.25, -0.85)), vec2(0.68, 0.028 + 0.13 * roughness), -0.19);
    float shade = reflectionStrip(reflected, normalize(vec3(-0.10, 0.06, -0.99)), vec2(0.79, 0.14 + 0.16 * roughness), 0.09);
    // The dark and bright strips share the same reflection ray and the same
    // deformed normal, so they stretch and turn with the surface.
    base = mix(base, mix(uDeep, uCobalt, 0.26 + 0.18 * diffuse), uLight.x * shade * (0.24 + 0.38 * fresnel));
    float violet = 0.13 * reflectionStrip(reflected, normalize(vec3(-0.68, 0.39, -0.62)), vec2(0.34, 0.16), 0.23);
    base = mix(base, uLavender, violet * (1.0 - shade));
    base = mix(base, uCyan, uLight.x * soft * (0.23 + 0.19 * fresnel));

    float edgeLight = reflectionStrip(reflected, normalize(vec3(0.44, -0.12, -0.89)), vec2(0.52, 0.12 + 0.14 * roughness), -0.15);
    float rim = pow(1.0 - facing, mix(20.0, 10.0, roughness)) * (0.08 + 0.59 * edgeLight + 0.20 * ribbon + 0.13 * soft);
    float key = pow(max(0.0, dot(n, normalize(light + eye))), mix(64.0, 20.0, roughness));
    float specular = clamp(uLight.x * ((0.18 + 0.40 * fresnel) * ribbon + 0.16 * soft + 0.12 * key)
      + uLight.y * rim * (0.37 + 0.63 * focus), 0.0, 0.65);
    vec2 reflectionUV = vec2(0.53 + reflected.x * 0.31, 0.66 + reflected.y * 0.23);
    vec3 reflectedEnvironment = (texture2D(uEnvironment, reflectionUV + vec2(0.06, 0.04)).rgb
      + texture2D(uEnvironment, reflectionUV - vec2(0.06, 0.04)).rgb) * 0.5;
    vec3 glint = mix(uGlint, reflectedEnvironment, 0.19 * soft);
    gl_FragColor = vec4(mix(base, glint, specular), 1.0);
    #include <colorspace_fragment>
  }
`

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
  const sections = Array.from({ length: along + 1 }, (_, row) => {
    const depth = row / along
    const curl = (depth - .29) * 5.8
    return {
      depth, z: mix(-10.4, 9.2, depth), curl: 1 / (1 + curl * curl),
      returnCurve: Math.exp(-17.2 * depth), outer: (1 - depth) ** 3,
      foreground: depth * depth * (3 - 2 * depth),
    }
  })
  return { geometry, positions, cavities, sections, across, along, stride }
}

function deform(surface: ReturnType<typeof makeSurfaceGeometry>, width: number, time: number) {
  const { geometry, positions, cavities, sections, across, along, stride } = surface
  const { amplitude, wavelength, travel, twist, period } = FILM.wave
  const span = width * 2
  const waveScale = (2 * Math.PI / .31) / wavelength
  const offset = time * travel
  const cycle = time * (2 * Math.PI / period)
  for (let col = 0; col < stride; col++) {
    const x = -width + span * col / across
    const advected = (x - offset) * waveScale
    const sweep = .31 * advected + 1.18
    const bend = Math.sin(sweep + .27 * Math.sin(.58 * sweep - .7))
    const shoulder = Math.cos(.68 * sweep + .86)
    for (const [row, { depth, z: base, curl, returnCurve, outer, foreground }] of sections.entries()) {
      // Distance along the sheet shifts the flex phase. Adjacent sections
      // continue into each other as the raised edge rolls toward the viewer.
      const flexing = Math.sin(cycle - .23 * advected + depth * 1.48)
      const roll = twist * (1.16 * bend + .59 * flexing) * curl
      const z = base + 1.74 * returnCurve + outer * (1.20 * bend + .63 * shoulder) + roll
      const u = advected + twist * (.91 * Math.sin(.31 * z + .72 * bend) + .54 * flexing * curl)
      const v = z + .78 * Math.sin(.28 * u - .25 * z + .34)
      const axis = -2.12 + 3.27 * Math.sin(.259 * u - .52) + .56 * flexing
      const crest = (v - axis) / (2.24 + .40 * shoulder + .38 * flexing)
      const incline = .82 * Math.sin(.248 * u - .51) + .18 * Math.sin(.512 * u + .14)
      const height = 1.42 + 1.30 * incline + .33 * flexing
      const ridge = Math.exp(-crest * crest) * height
      const trough = (v - axis - 4.45) / 2.48
      const hollow = Math.exp(-trough * trough) * (.43 - .19 * Math.sin(.40 * u - .36 * v))
      const basin = .62 * Math.cos(.47 * u + .34 * v + 2.71) + .30 * Math.sin(.42 * v - .36 * u)
      const acrossBasin = (v - 3.12 - 1.18 * bend) / 3.22
      const front = basin * (.48 + 1.57 * Math.exp(-acrossBasin * acrossBasin)) * foreground
      // Low-contrast, continuous irregularity in the domain. It travels with
      // the film and keeps broadened reflections from forming regular bands.
      const ripple = .043 * Math.sin(.86 * u + .63 * v) * Math.sin(.75 * v - .18 * u + .25 * flexing)
      const y = -.37 + amplitude * (ridge - hollow + front + ripple - .86 * (1 - incline) * outer) - 1.13 * returnCurve
      positions.setXYZ(row * stride + col, x, y, z)
    }
  }

  const sx = across / span
  const sz = along / (sections[along].z - sections[0].z)
  for (let row = 0; row <= along; row++) {
    for (let col = 0; col < stride; col++) {
      const i = row * stride + col
      const y = positions.getY(i)
      const left = positions.getY(col > 0 ? i - 1 : i)
      const right = positions.getY(col < across ? i + 1 : i)
      const far = positions.getY(row > 0 ? i - stride : i)
      const near = positions.getY(row < along ? i + stride : i)
      const curvature = (left + right - 2 * y) * sx * sx + (far + near - 2 * y) * sz * sz
      cavities.setX(i, clamp(curvature * .72))
    }
  }

  positions.needsUpdate = true
  cavities.needsUpdate = true
  geometry.computeVertexNormals()
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
