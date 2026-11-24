import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, DynamicDrawUsage, LinearFilter,
  Mesh, PerspectiveCamera, Scene, ShaderMaterial, SRGBColorSpace, Vector2, Vector3, Vector4, WebGLRenderer,
} from 'three'
import type { AudioInput } from './background'
import type { Climate, Rgb } from './climate'
import { clamp, mix } from './material'

const ACROSS = 144
const ALONG = 76
const ROW = ACROSS + 1

const FILM = {
  travel: .83,
  period: 8.4,
  relief: 1.16,
  musicResponse: 0,
  transmission: .64,
  refraction: .058,
  softness: .019,
  reflection: .48,
  rimLight: .44,
  focusDepth: 9.0,
  focusRange: 5.0,
  raster: { width: 860, height: 520 },
} as const

export function getLiquidMotion(audio: AudioInput) {
  const energy = Math.sqrt(clamp(audio.energy)) * FILM.musicResponse
  const swell = clamp(audio.low) * energy
  const bend = clamp(audio.mid) * energy
  const shimmer = Math.sqrt(clamp(audio.high)) * energy
  return { swell, bend, shimmer, speed: 1 + .24 * energy + .69 * swell + .12 * bend }
}

type Motion = ReturnType<typeof getLiquidMotion>
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
  uniform vec3 uShade, uBody, uFill, uGlint;
  uniform float uSun, uShimmer, uCloud, uCloudX;
  uniform vec2 uFrame;
  uniform vec3 uOptics;
  uniform vec4 uLight;
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

  void main() {
    float face = gl_FrontFacing ? 1.0 : -1.0;
    vec3 n = normalize(vNormal) * face;
    vec3 eye = normalize(cameraPosition - vSurface);
    vec3 light = normalize(vec3(0.42 + 0.17 * uSun, 0.73, 0.42));
    vec3 reflected = reflect(-eye, n);
    vec3 halfDirection = normalize(light + eye);
    float diffuse = max(0.0, dot(n, light));
    float gloss = max(0.0, dot(n, halfDirection));
    float facing = max(0.0, dot(n, eye));
    vec2 uv = gl_FragCoord.xy / uFrame;
    float cloudX = uv.x - uCloudX;
    float cloud = uCloud / (1.0 + 12.0 * cloudX * cloudX);
    float distanceFromFocus = (length(cameraPosition - vSurface) - uLight.z) / uLight.w;
    float focus = 1.0 / (1.0 + distanceFromFocus * distanceFromFocus);
    float foldedDepth = 1.0 - smoothstep(-1.12, 0.89, vSurface.y);
    float shadow = vCavity * mix(0.46, 0.65, focus);
    float tone = clamp(0.12 + diffuse * 0.58 + facing * 0.12 - shadow - cloud * 0.095 - 0.29 * foldedDepth, 0.0, 1.0);
    vec3 base = mix(uShade, uBody, tone) * (0.64 + 0.36 * diffuse - 0.26 * foldedDepth - 0.11 * vCavity);

    // A broad studio reflection and a small grazing reflection use the same
    // normal as the diffuse light. Neither is attached to a mesh boundary.
    float broad = pow(gloss, mix(3.5, 8.0, focus));
    float core = pow(gloss, mix(9.0, 31.0, focus));
    float fresnel = pow(1.0 - facing, 4.5);
    vec3 viewNormal = normalize(vViewNormal) * face;
    float density = 0.31 * vCavity + 0.32 * smoothstep(-4.4, 4.8, vSurface.z) + 0.34 * foldedDepth;
    vec2 units = vec2(uFrame.y / uFrame.x, 1.0);
    vec2 shift = viewNormal.xy * uOptics.y * (1.0 + (1.0 - facing) * 0.55);
    float blur = uOptics.z * (0.68 + 0.84 * (1.0 - focus) + density * 0.90);
    vec3 environment = readEnvironment(uv + shift * units, blur * units);
    vec3 transmission = mix(environment * mix(uBody, vec3(1.0), 0.57), uFill, 0.09) * (1.0 - foldedDepth * 0.26);
    base = mix(base, transmission, uOptics.x * (0.39 + facing * 0.56) * (1.0 - density * 0.81));

    float reflectedSky = max(0.0, dot(reflected, normalize(vec3(0.19, 0.29, -0.94))));
    float skyReflection = 0.30 * pow(reflectedSky, 7.0) + 0.38 * pow(reflectedSky, mix(15.0, 36.0, focus));
    float rim = pow(fresnel, 2.65) * (0.21 + 0.79 * smoothstep(0.30, 0.94, reflectedSky));
    base = mix(base, uFill, 0.23 * broad + 0.035 * fresnel);
    float specular = clamp(uLight.x * (0.45 * core + skyReflection * (0.51 + 0.09 * uShimmer))
      + uLight.y * rim * (0.54 + 0.46 * focus), 0.0, 0.64);
    vec2 reflectionUV = vec2(0.53 + reflected.x * 0.31, 0.66 + reflected.y * 0.23);
    vec3 reflectedEnvironment = (texture2D(uEnvironment, reflectionUV + vec2(0.06, 0.04)).rgb
      + texture2D(uEnvironment, reflectionUV - vec2(0.06, 0.04)).rgb) * 0.5;
    vec3 glint = mix(uGlint, reflectedEnvironment, 0.14 * broad);
    gl_FragColor = vec4(mix(base, glint, specular), 1.0);
    #include <colorspace_fragment>
  }
`

function makeSurfaceGeometry() {
  const positions = new BufferAttribute(new Float32Array(ROW * (ALONG + 1) * 3), 3).setUsage(DynamicDrawUsage)
  const normals = new BufferAttribute(new Float32Array(positions.count * 3), 3).setUsage(DynamicDrawUsage)
  const cavities = new BufferAttribute(new Float32Array(positions.count), 1).setUsage(DynamicDrawUsage)
  const indices = new Uint16Array(ACROSS * ALONG * 6)
  let index = 0
  for (let row = 0; row < ALONG; row++) {
    for (let col = 0; col < ACROSS; col++) {
      const a = row * ROW + col
      const b = a + 1
      const c = a + ROW
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
  return { geometry, positions, cavities }
}

const sections = Array.from({ length: ALONG + 1 }, (_, row) => {
  const depth = row / ALONG
  const curl = (depth - .29) * 5.8
  return {
    depth, z: mix(-10, 8.1, depth), curl: 1 / (1 + curl * curl),
    returnCurve: Math.exp(-17.2 * depth), outer: (1 - depth) ** 3,
    foreground: depth * depth * (3 - 2 * depth),
  }
})

function deform(
  surface: ReturnType<typeof makeSurfaceGeometry>, width: number, phase: number, time: number,
  amplitude: number, motion: Motion,
) {
  const { geometry, positions, cavities } = surface
  const span = width * 2
  const drive = FILM.relief * amplitude * (1 + .66 * motion.swell)
  const offset = phase * FILM.travel
  const cycle = time * (2 * Math.PI / FILM.period)
  const flex = .76 + .61 * motion.bend
  for (let col = 0; col < ROW; col++) {
    const x = -width + span * col / ACROSS
    const advected = x - offset
    const sweep = .31 * advected + 1.18
    const bend = Math.sin(sweep + .27 * Math.sin(.58 * sweep - .7))
    const shoulder = Math.cos(.68 * sweep + .86)
    for (const [row, { depth, z: base, curl, returnCurve, outer, foreground }] of sections.entries()) {
      // Distance along the sheet shifts the flex phase. Adjacent sections
      // continue into each other as the raised edge rolls toward the viewer.
      const flexing = Math.sin(cycle - .23 * advected + depth * 1.48)
      const roll = flex * (1.12 * bend + .55 * flexing) * curl
      const z = base + 1.74 * returnCurve + outer * (1.20 * bend + .63 * shoulder) + roll
      const u = advected + flex * (.91 * Math.sin(.31 * z + .72 * bend) + .48 * flexing * curl)
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
      const y = -.37 + drive * (ridge - hollow + front + ripple - .86 * (1 - incline) * outer) - 1.13 * returnCurve
      positions.setXYZ(row * ROW + col, x, y, z)
    }
  }

  const sx = ACROSS / span
  const sz = ALONG / (sections[ALONG].z - sections[0].z)
  for (let row = 0; row <= ALONG; row++) {
    for (let col = 0; col < ROW; col++) {
      const i = row * ROW + col
      const y = positions.getY(i)
      const left = positions.getY(col > 0 ? i - 1 : i)
      const right = positions.getY(col < ACROSS ? i + 1 : i)
      const far = positions.getY(row > 0 ? i - ROW : i)
      const near = positions.getY(row < ALONG ? i + ROW : i)
      const curvature = (left + right - 2 * y) * sx * sx + (far + near - 2 * y) * sz * sz
      cavities.setX(i, clamp(curvature * .72))
    }
  }

  positions.needsUpdate = true
  cavities.needsUpdate = true
  geometry.computeVertexNormals()
}

function useColor(output: Color, [r, g, b]: Rgb) {
  output.setRGB(r / 255, g / 255, b / 255, SRGBColorSpace)
}

export function createLiquidSurface() {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('webgl2', { alpha: true, antialias: true })
  const renderer = context && new WebGLRenderer({ canvas, context })
  const environmentCanvas = document.createElement('canvas')
  environmentCanvas.width = 288
  environmentCanvas.height = 192
  const environment = environmentCanvas.getContext('2d', { alpha: false })!
  const environmentTexture = new CanvasTexture(environmentCanvas)
  environmentTexture.colorSpace = SRGBColorSpace
  environmentTexture.minFilter = LinearFilter
  environmentTexture.generateMipmaps = false
  const surface = makeSurfaceGeometry()
  const scene = new Scene()
  const camera = new PerspectiveCamera(44, 1, .2, 60)
  const uniforms = {
    uShade: { value: new Color() }, uBody: { value: new Color() },
    uFill: { value: new Color() }, uGlint: { value: new Color() },
    uSun: { value: 0 }, uShimmer: { value: 0 },
    uCloud: { value: 0 }, uCloudX: { value: .5 },
    uFrame: { value: new Vector2() }, uEnvironment: { value: environmentTexture },
    uOptics: { value: new Vector3(FILM.transmission, FILM.refraction, FILM.softness) },
    uLight: { value: new Vector4(FILM.reflection, FILM.rimLight, FILM.focusDepth, FILM.focusRange) },
  }
  const material = new ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms, side: DoubleSide, forceSinglePass: true,
  })
  const mesh = new Mesh(surface.geometry, material)
  mesh.frustumCulled = false
  scene.add(mesh)
  renderer?.setClearColor(0, 0)

  function render(
    target: CanvasRenderingContext2D, width: number, height: number, detail: number,
    phase: number, climate: Climate, audio: AudioInput, cloudX: number, inspection?: Inspection, time = phase,
  ) {
    if (!renderer || context?.isContextLost()) return
    const scale = Math.min(.96, FILM.raster.width * detail / width, FILM.raster.height * detail / height)
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

    const motion = getLiquidMotion(audio)
    deform(surface, Math.max(8.8, 9.5 * aspect), phase, time, climate.waveAmplitude, motion)
    const { palette } = climate
    useColor(uniforms.uShade.value, palette.undertow[0])
    useColor(uniforms.uBody.value, palette.current[1])
    useColor(uniforms.uFill.value, palette.current[2])
    useColor(uniforms.uGlint.value, palette.foam[1])
    uniforms.uSun.value = climate.sunlight
    uniforms.uShimmer.value = motion.shimmer
    uniforms.uCloud.value = climate.cloudCover
    uniforms.uCloudX.value = cloudX
    // Capture the current environment before compositing the mesh into it.
    // The liquid resolves reflection and transmission in one depth-tested pass.
    environment.drawImage(target.canvas, 0, 0, environmentCanvas.width, environmentCanvas.height)
    environmentTexture.needsUpdate = true
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
    render, destroy,
    inspectGeometry: import.meta.env.DEV ? () => ({ geometry: surface.geometry, camera, material, canvas }) : undefined,
  }
}
