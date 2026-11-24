import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, DynamicDrawUsage, LinearFilter,
  Mesh, PerspectiveCamera, Scene, ShaderMaterial, SRGBColorSpace, Vector2, WebGLRenderer,
} from 'three'
import type { AudioInput } from './background'
import type { Climate, Rgb } from './climate'
import { clamp, mix } from './material'

const ACROSS = 144
const ALONG = 76
const ROW = ACROSS + 1
const ADVANCE = .92

export function getLiquidMotion(audio: AudioInput) {
  const energy = Math.sqrt(clamp(audio.energy))
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
    float tone = clamp(0.10 + diffuse * 0.56 + facing * 0.14 - vCavity * 0.39 - cloud * 0.095, 0.0, 1.0);
    vec3 base = mix(uShade, uBody, tone) * (0.73 + 0.27 * diffuse - 0.10 * vCavity);

    // A broad studio reflection and a small grazing reflection use the same
    // normal as the diffuse light. Neither is attached to a mesh boundary.
    float broad = pow(gloss, 5.0);
    float core = pow(gloss, 23.0);
    float rim = pow(1.0 - facing, 3.1);
    vec3 viewNormal = normalize(vViewNormal) * face;
    float density = smoothstep(-5.5, 3.6, vSurface.z) * 0.34 + vCavity * 0.46;
    vec2 units = vec2(uFrame.y / uFrame.x, 1.0);
    vec2 shift = viewNormal.xy * (0.047 + (1.0 - facing) * 0.031);
    vec3 environment = readEnvironment(uv + shift * units, (0.013 + density * 0.020) * units);
    vec3 transmission = mix(environment * mix(uBody, vec3(1.0), 0.66), uFill, 0.12);
    base = mix(base, transmission, (0.23 + facing * 0.39) * (1.0 - density * 0.74));
    float reflectedSky = max(0.0, dot(reflected, normalize(vec3(0.31, 0.31, -0.90))));
    float skyReflection = (0.19 * pow(reflectedSky, 9.0) + 0.34 * pow(reflectedSky, 29.0)) * (0.24 + 0.76 * rim);
    base = mix(base, uFill, 0.29 * broad + 0.044 * rim);
    float specular = clamp(0.29 * core + (1.0 + uShimmer * 0.14) * skyReflection, 0.0, 0.48);
    gl_FragColor = vec4(mix(base, uGlint, specular), 1.0);
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
  return { depth, z: mix(-9.7, 7.4, depth), returnCurve: Math.exp(-18 * depth), outer: (1 - depth) ** 3 }
})

function deform(
  surface: ReturnType<typeof makeSurfaceGeometry>, width: number, phase: number, amplitude: number, motion: Motion,
) {
  const { geometry, positions, cavities } = surface
  const span = width * 2
  const drive = amplitude * (1 + .72 * motion.swell)
  const offset = phase * ADVANCE
  const flex = .70 + .64 * motion.bend
  const drift = phase * .091
  for (let col = 0; col < ROW; col++) {
    const x = -width + span * col / ACROSS
    const advected = x - offset
    const sweep = Math.sin(advected * .31 + drift)
    const turn = Math.cos(advected * .48 - drift * .64 + .7)
    for (const [row, { depth, z: base, returnCurve, outer }] of sections.entries()) {
      // One continuous map from lattice coordinates to world space. The
      // far boundary curls beneath the rising surface in world Y and Z.
      const z = base + 1.65 * returnCurve + outer * (1.21 * sweep + .52 * turn)
      const u = advected + flex * (.94 * Math.sin(.29 * z + sweep) + .78 * Math.sin(.51 * z - .33 * advected - drift))
      const v = z + .82 * Math.sin(.34 * u - .25 * z + drift)
      const crest = -3.85 + 2.52 * Math.sin(.22 * u + .92 + drift * .72)
      const acrossCrest = (v - crest) / (2.06 + .48 * turn)
      const ridge = Math.exp(-acrossCrest * acrossCrest)
      const crestLift = 1.12 + .85 * Math.cos(.26 * u + .65 - drift * .46)
      const basin = .64 * Math.sin(.39 * u + .37 * v + 2.1) + .43 * Math.cos(.41 * v - .41 * u + 1.08)
      const shoulder = Math.cos(.71 * u + .23 * z + 2.73 + .41 * sweep)
      const nearWeight = depth * depth * (3 - 2 * depth)
      const acrossBasin = (v - 3.08 - .93 * sweep) / 3.24
      const front = (1.46 * Math.exp(-acrossBasin * acrossBasin) * shoulder + .46 * basin) * nearWeight
      const y = -.44 + drive * (ridge * crestLift + basin * .60 + front) - 1.28 * returnCurve
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
    phase: number, climate: Climate, audio: AudioInput, cloudX: number, inspection?: Inspection,
  ) {
    if (!renderer || context?.isContextLost()) return
    const scale = Math.min(.92, 815 * detail / width, 505 * detail / height)
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
      camera.position.set(0, 3.08 + .34 * narrow, 8.35 + .87 * narrow)
      camera.lookAt(0, .53, -.49)
    }
    camera.updateProjectionMatrix()
    if (import.meta.env.DEV) material.wireframe = inspection === 'wireframe'

    const motion = getLiquidMotion(audio)
    deform(surface, Math.max(8.8, 9.1 * aspect), phase, climate.waveAmplitude, motion)
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
