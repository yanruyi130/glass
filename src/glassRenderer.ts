/* WebGL blur, signed-distance lens and dispersion adapted from Glasswork by
 * Kubai087 (MIT). See public/licenses/glasswork-MIT.txt. */
import { CanvasTexture, DataTexture, ExtrudeGeometry, Group, LinearFilter, LinearMipmapLinearFilter, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Scene, ShaderMaterial, Shape, Vector2, Vector3, Vector4, WebGLRenderer } from 'three'
import type { Climate } from './climate'
import { paintDeviceInk } from './deviceInk'
import { createFrostPattern } from './frostPattern'
import { LAYERS, type EffectiveMaterial, type LayerId, type Material } from './material'
import { playerLayout, playerClearRegions } from './playerLayout'
import { layerDepth, type Projection } from './projection'
import { roundedRectangle, type GlassShape, type ShapeGeometry } from './shape'
import type { RainWaterField } from './rainWaterField'
import { surfaceWeatherGLSL } from './surfaceWeather'

export type SurfaceEffect = (context: CanvasRenderingContext2D, geometry: ShapeGeometry, time: number) => void

interface Frame {
  width: number
  height: number
  projection: Projection
  material: Material
  effective: EffectiveMaterial
  frostCoverage: number
  inkBrightness: number
  selected: LayerId | null
  time: number
  surfaceEffect: SurfaceEffect | null
  climate: Climate
  rainAmount: number
  rainField: RainWaterField | null
  reelAngle: number
}

const vertex = `
varying vec2 v_local;
uniform vec2 u_half;
uniform float u_pad;
void main() {
  v_local = vec2(position.x, -position.y) * (u_half + u_pad);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const fragment = `
precision highp float;
varying vec2 v_local;
uniform sampler2D u_background, u_ink, u_surface;
uniform float u_radius, u_open, u_weight, u_emphasis, u_aa;
uniform float u_inkBrightness, u_iconBottom, u_device;
uniform float u_weatherRim;
uniform int u_layer;
uniform vec2 u_view, u_half;
uniform float u_pad;
uniform vec3 u_tone;
uniform vec4 u_lens;
uniform vec3 u_style, u_tintColor;
uniform mat4 u_localToClip;
${roundedRectangle.distanceGLSL}

vec2 screenPoint(vec2 point) {
  vec2 p = vec2(point.x, -point.y) / (u_half + u_pad);
  vec4 clip = u_localToClip * vec4(p, 0.0, 1.0);
  return (vec2(clip.x, -clip.y) / clip.w * 0.5 + 0.5) * u_view;
}

vec3 scene(vec2 p) {
  return texture2D(u_background, clamp(p / u_view, 0.0, 1.0)).rgb;
}

// Gaussian-weighted 12-tap spiral from Glasswork's refract.js.
vec3 blurred(vec2 p, float radius) {
  if (radius < 0.4) return scene(p);
  vec3 sum = scene(p);
  float total = 1.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float relative = 2.2 * sqrt((fi + 0.5) / 12.0);
    float a = fi * 2.39996;
    float w = exp(-relative * relative * 0.5);
    sum += scene(p + vec2(cos(a), sin(a)) * relative * radius) * w;
    total += w;
  }
  return sum / total;
}
vec3 tone(vec3 color) {
  float luminance = dot(color, vec3(0.213, 0.715, 0.072));
  return clamp(mix(vec3(luminance), color, u_tone.y) * u_tone.z, 0.0, 1.0);
}
float distanceAt(vec2 p) {
  return contour(p, u_half, u_radius);
}
vec2 outward(vec2 p) {
  vec2 dx = vec2(0.45, 0.0), dy = dx.yx;
  vec2 delta = vec2(distanceAt(p + dx) - distanceAt(p - dx),
                    distanceAt(p + dy) - distanceAt(p - dy));
  return delta / max(0.0001, length(delta));
}
float band(float x, float center, float width) {
  float v = (x - center) / width;
  return exp(-v * v);
}

${surfaceWeatherGLSL}

// Every pass samples the source canvas at the projected coordinates of
// its own plane. The transparent passes never sample the composited stack.
void main() {
  vec2 p = v_local;
  float d = distanceAt(p);
  float aa = max(u_aa * 0.75, fwidth(d) * 0.55);
  float inside = 1.0 - smoothstep(-aa, aa, d);
  float depth = max(0.0, -d);
  vec2 uv = p / (u_half * 2.0) + 0.5;
  float openGuide = smoothstep(0.14, 0.86, u_open);
  vec3 color = vec3(0.0);
  float alpha = 0.0;

  if (u_layer == 0) {
    float shadowDistance = max(0.0, distanceAt(p - vec2(0.0, 7.0)));
    float nearCast = max(0.0, distanceAt(p - vec2(0.0, 2.0)));
    alpha = (band(shadowDistance, 0.0, 15.0) * 0.23 + band(nearCast, 0.0, 3.0) * 0.11) * u_style.x;
    color = vec3(0.012, 0.034, 0.072);
  } else {
    if (inside == 0.0 && (d > 4.0 || openGuide == 0.0)) discard;
    if (u_layer == 1) {
      color = tone(blurred(screenPoint(p), u_tone.x));
      alpha = inside;
    } else if (u_layer == 2) {
      float rim = min(u_lens.x, min(u_half.x, u_half.y) * 0.62);
      // Small device corners need less reach so adjacent edges do not split the image.
      vec2 inset = u_half - abs(p);
      float nearCorner = 1.0 - smoothstep(u_radius + 0.5, u_radius + rim * 0.66, max(inset.x, inset.y));
      rim = mix(rim, min(rim, u_radius + 2.0), nearCorner * u_device);
      if (depth < rim && inside > 0.0) {
        vec2 normal = outward(p);
        float falloff = pow(max(0.0, 1.0 - depth / rim), u_lens.z);
        float amount = u_lens.y * rim * falloff;
        if (amount > 0.015) {
          vec2 shift = -normal * amount;
          vec3 bent = blurred(screenPoint(p + shift), u_tone.x);
          float split = u_lens.w;
          if (split > 0.001 && amount > 0.75) {
            bent.r = blurred(screenPoint(p + shift * (1.0 + split)), u_tone.x).r;
            bent.b = blurred(screenPoint(p + shift * (1.0 - split)), u_tone.x).b;
          }
          color = tone(bent);
          alpha = inside * smoothstep(0.0, 1.3, amount) * mix(1.0, 0.87, openGuide);
        }
      }
    } else if (u_layer == 3) {
      color = u_tintColor;
      alpha = inside * u_style.y;
    } else if (u_layer == 4) {
      if (depth < 13.0 && inside > 0.0) {
        float facing = dot(outward(p), normalize(vec2(-0.75, -1.0)));
        float upper = pow(max(0.0, facing), 1.6);
        float lower = pow(max(0.0, -facing), 2.0);
        float catchLight = band(depth, 0.86, 0.8) * (0.11 + 0.68 * upper + 0.25 * lower);
        float bevel = band(depth, 4.0, 2.2) * (0.018 + 0.135 * upper + 0.037 * lower);
        float insideGlint = band(depth, 8.0, 2.8) * 0.035 * upper;
        vec3 baseLight = mix(vec3(0.67, 0.84, 1.0), vec3(1.0, 0.984, 0.925), 0.26 + upper * 0.64);
        color = mix(baseLight, u_weatherLight, 0.30 + upper * 0.16);
        alpha = inside * (catchLight + bevel + insideGlint) * u_style.z * u_weatherRim;
      }
    } else if (u_layer == 5) {
      float coverage = texture2D(u_ink, uv).a;
      vec3 backdrop = scene(screenPoint(p));
      float iconTone = 1.0 - smoothstep(0.4, 0.62, dot(mix(tone(backdrop), u_tintColor, u_style.y), vec3(0.213, 0.715, 0.072)));
      float inkTone = mix(u_inkBrightness, iconTone, step(p.y, u_iconBottom));
      vec3 darkInk = vec3(0.018, 0.029, 0.060) + backdrop * 0.115;
      vec3 lightInk = vec3(0.87, 0.925, 0.987) + backdrop * 0.08;
      float relief = texture2D(u_ink, uv - vec2(0.0, 1.0 / (2.0 * u_half.y))).a * (1.0 - coverage);
      relief *= mix(0.17, 0.33, inkTone);
      color = (mix(darkInk, lightInk, inkTone) * coverage + mix(lightInk, darkInk, inkTone) * relief)
        / max(0.001, coverage + relief);
      alpha = (coverage + relief) * inside;
    } else if (u_layer == 6) {
      vec4 effect = texture2D(u_surface, uv);
      color = effect.rgb;
      alpha = effect.a * inside;
    } else {
      vec4 effect = weatherSurface(p, inside);
      color = effect.rgb;
      alpha = effect.a;
    }
  }

  vec3 contribution = color * alpha * u_weight;
  alpha *= u_weight;
  if (u_layer < 6 && openGuide > 0.0) {
    float line = band(d, 0.0, 0.72 + u_aa * 0.38) * openGuide;
    float guide = (0.28 * u_weight + 0.55 * u_emphasis) * line;
    vec3 guideColor = mix(vec3(0.77, 0.87, 1.0), vec3(0.67, 1.0, 0.96), u_emphasis);
    if (line > 0.01) {
      float backdropLuma = dot(scene(screenPoint(p)), vec3(0.213, 0.715, 0.072));
      vec3 darkGuide = mix(vec3(0.12, 0.23, 0.35), vec3(0.06, 0.40, 0.39), u_emphasis);
      guideColor = mix(guideColor, darkGuide, smoothstep(0.52, 0.70, backdropLuma));
    }
    contribution = guideColor * guide + contribution * (1.0 - guide);
    alpha = guide + alpha * (1.0 - guide);
  }
  gl_FragColor = vec4(contribution, alpha);
}`

function trackCanvasTexture(initial: HTMLCanvasElement, mipmaps = false) {
  function create(canvas: HTMLCanvasElement) {
    const texture = new CanvasTexture(canvas)
    texture.flipY = false
    texture.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter
    texture.magFilter = LinearFilter
    texture.generateMipmaps = mipmaps
    if (mipmaps) texture.anisotropy = 4
    return texture
  }

  const uniform = { value: create(initial) }
  let source = initial, width = initial.width, height = initial.height
  return {
    uniform,
    update(canvas: HTMLCanvasElement) {
      // WebGL 2 texture storage keeps its original size after a canvas resize.
      if (canvas !== source || canvas.width !== width || canvas.height !== height) {
        uniform.value.dispose()
        uniform.value = create(canvas)
        source = canvas
        width = canvas.width
        height = canvas.height
      } else {
        uniform.value.needsUpdate = true
      }
    },
  }
}

function inkMask(context: CanvasRenderingContext2D, geometry: ShapeGeometry, shape: GlassShape, reelAngle: number) {
  const { width, height } = geometry
  context.clearRect(0, 0, width, height)
  context.globalAlpha = 1
  if (shape.id !== 'rounded-rectangle') {
    paintDeviceInk(context, shape.id, geometry, playerLayout(shape.id), reelAngle)
    return
  }

  const pad = width * .087
  const icon = Math.min(width * .105, 36)
  context.fillStyle = 'white'
  context.strokeStyle = 'white'
  context.lineWidth = 1.35
  context.lineJoin = 'round'
  const x = pad, y = pad + 3
  context.beginPath()
  context.roundRect(x + icon * .21, y, icon * .72, icon * .56, 4)
  context.roundRect(x, y + icon * .22, icon * .72, icon * .56, 4)
  context.stroke()
  context.textBaseline = 'alphabetic'
  context.font = '600 ' + Math.round(width * .089) + 'px "Segoe UI", system-ui, sans-serif'
  context.fillText('Liquid Glass', pad, height - pad - 21)
  context.font = Math.max(10, Math.round(width * .036)) + 'px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif'
  context.globalAlpha = .84
  context.fillText('液态玻璃 · 圆角矩形', pad + 1, height - pad)
}

function sameGeometry(a: ShapeGeometry, b: ShapeGeometry) {
  return a.width === b.width && a.height === b.height && a.radius === b.radius
}

const EDGE_DEPTH = 4

const edgeVertex = `
varying vec3 v_normal;
varying float v_depth;
void main() {
  v_normal = normalMatrix * normal;
  v_depth = position.z / ${EDGE_DEPTH.toFixed(1)};
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const edgeFragment = `
uniform sampler2D u_background;
uniform vec2 u_pixels;
uniform float u_opacity, u_light;
uniform vec3 u_lightColor;
varying vec3 v_normal;
varying float v_depth;
void main() {
  vec3 normal = normalize(v_normal);
  vec2 uv = vec2(gl_FragCoord.x, u_pixels.y - gl_FragCoord.y) / u_pixels;
  vec2 shift = vec2(normal.x, -normal.y) * (3.0 + 3.0 * v_depth) / u_pixels;
  vec3 transmission = texture2D(u_background, clamp(uv - shift, 0.0, 1.0)).rgb;
  float key = max(0.0, dot(normal, normalize(vec3(-0.5, 0.75, 0.65))));
  float glint = (0.10 + 0.33 * key) * u_light;
  vec3 rimColor = mix(vec3(0.74, 0.91, 1.0), u_lightColor, 0.36);
  vec3 color = mix(transmission * (0.80 + 0.16 * v_depth), rimColor, clamp(glint, 0.0, 0.72));
  float alpha = u_opacity * (0.50 + 0.28 * key);
  gl_FragColor = vec4(color * alpha, alpha);
}`

function makeSurfaceTexture(pixels: Uint8Array, width: number, height: number) {
  const texture = new DataTexture(pixels, width, height)
  texture.flipY = false
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.needsUpdate = true
  return texture
}

const compositing = {
  transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false, toneMapped: false,
} as const

export function createGlassRenderer(canvas: HTMLCanvasElement) {
  const renderer = new WebGLRenderer({ canvas, alpha: true, premultipliedAlpha: true, antialias: false, depth: false })
  renderer.setClearAlpha(0)
  const scene = new Scene()
  const pivot = new Group()
  scene.add(pivot)

  const mask = document.createElement('canvas')
  const maskContext = mask.getContext('2d')!
  const surface = document.createElement('canvas')
  const surfaceContext = surface.getContext('2d')!
  const backgroundTexture = trackCanvasTexture(document.createElement('canvas'))
  const maskTexture = trackCanvasTexture(mask, true)
  const surfaceTexture = trackCanvasTexture(surface)
  const rainTexture = { value: makeSurfaceTexture(new Uint8Array(4), 1, 1) }
  const rainTexel = { value: new Vector2(1, 1) }
  const emptyFrost = makeSurfaceTexture(new Uint8Array(4), 1, 1)
  const frostTexture = { value: emptyFrost }
  const frostAtlases = new Map<GlassShape, { geometry: ShapeGeometry; texture: DataTexture; limit: number }>()
  let rainVersion = -1

  function prepareRain(field: RainWaterField) {
    const texture = rainTexture.value
    const image = texture.image
    if (image.width !== field.width || image.height !== field.height || image.data !== field.pixels) {
      texture.dispose()
      rainTexture.value = makeSurfaceTexture(field.pixels, field.width, field.height)
      rainTexel.value.set(1 / field.width, 1 / field.height)
    } else if (rainVersion !== field.version) {
      texture.needsUpdate = true
    }
    rainVersion = field.version
  }
  function prepareFrost(shape: GlassShape, geometry: ShapeGeometry) {
    let atlas = frostAtlases.get(shape)
    if (!atlas || !sameGeometry(atlas.geometry, geometry)) {
      const pattern = createFrostPattern(shape, geometry, playerClearRegions(shape.id))
      atlas?.texture.dispose()
      atlas = { geometry, texture: makeSurfaceTexture(pattern.pixels, pattern.width, pattern.height), limit: pattern.maxCoverage }
      frostAtlases.set(shape, atlas)
    }
    frostTexture.value = atlas.texture
    return atlas.limit
  }

  const common = {
    u_background: backgroundTexture.uniform, u_ink: maskTexture.uniform, u_surface: surfaceTexture.uniform,
    u_view: { value: new Vector2() }, u_half: { value: new Vector2() }, u_tone: { value: new Vector3() },
    u_lens: { value: new Vector4() }, u_style: { value: new Vector3() }, u_tintColor: { value: new Vector3() },
    u_radius: { value: 0 }, u_open: { value: 0 }, u_aa: { value: 0 }, u_inkBrightness: { value: 0 },
    u_iconBottom: { value: 0 }, u_device: { value: 0 },
    u_weatherLight: { value: new Vector3(1, 1, 1) }, u_weatherRim: { value: 1 },
    u_weatherRain: { value: 0 }, u_weatherFrost: { value: 0 },
    u_frostPattern: frostTexture, u_frostCoverage: { value: 0 },
    u_rainField: rainTexture, u_rainTexel: rainTexel,
  }
  const planeGeometry = new PlaneGeometry(2, 2)
  const fragmentShader = fragment

  function createLayer(index: number, renderOrder = index) {
    const uniforms = {
      ...common, u_layer: { value: index }, u_pad: { value: index === 0 ? 34 : 5 },
      u_weight: { value: 1 }, u_emphasis: { value: 0 }, u_localToClip: { value: new Matrix4() },
    }
    const material = new ShaderMaterial({ ...compositing, uniforms, vertexShader: vertex, fragmentShader })
    const mesh = new Mesh(planeGeometry, material)
    mesh.renderOrder = renderOrder
    pivot.add(mesh)
    return { mesh, uniforms }
  }
  const layers = LAYERS.map((_, index) => createLayer(index))
  const surfaceLayer = createLayer(6, 3.5)
  // Weather belongs to the Rim light surface. Its mesh only adds local coverage.
  const weatherLayer = createLayer(7, 4.5)
  const allPlanes = [...layers, surfaceLayer, weatherLayer]
  const viewProjection = new Matrix4()

  const face = new MeshBasicMaterial({ visible: false })
  const edgeUniforms = {
    u_background: backgroundTexture.uniform, u_pixels: { value: new Vector2() },
    u_opacity: { value: 1 }, u_light: { value: 1 },
    u_lightColor: common.u_weatherLight,
  }
  const side = new ShaderMaterial({ ...compositing, uniforms: edgeUniforms, vertexShader: edgeVertex, fragmentShader: edgeFragment })
  let edge: Mesh<ExtrudeGeometry, [MeshBasicMaterial, ShaderMaterial]> | null = null
  let previousShape: { shape: GlassShape; geometry: ShapeGeometry } | null = null

  let previousReelAngle = 0
  function repaintInk(shape: GlassShape, geometry: ShapeGeometry, reelAngle: number) {
    inkMask(maskContext, geometry, shape, reelAngle)
    maskTexture.update(mask)
    previousReelAngle = reelAngle
  }

  function updateShape(shape: GlassShape, geometry: ShapeGeometry, reelAngle: number) {
    common.u_iconBottom.value = shape === roundedRectangle ? -.15 * geometry.height : -.5 * geometry.height
    common.u_device.value = Number(shape !== roundedRectangle)
    mask.width = Math.ceil(geometry.width * 2)
    mask.height = Math.ceil(geometry.height * 2)
    maskContext.scale(mask.width / geometry.width, mask.height / geometry.height)
    repaintInk(shape, geometry, reelAngle)
    const outline = new Shape(shape.outline(geometry).map(({ x, y }) => new Vector2(x, -y)))
    const extrusion = new ExtrudeGeometry(outline, { depth: EDGE_DEPTH, bevelEnabled: false })
    if (edge) {
      edge.geometry.dispose()
      edge.geometry = extrusion
    } else {
      edge = new Mesh(extrusion, [face, side])
      edge.renderOrder = 0.5
      edge.position.z = -EDGE_DEPTH
      pivot.add(edge)
    }
  }

  return {
    resize(width: number, height: number, ratio: number) {
      renderer.setPixelRatio(ratio)
      renderer.setSize(width, height, false)
      renderer.getDrawingBufferSize(edgeUniforms.u_pixels.value)
    },
    render(source: HTMLCanvasElement, backgroundChanged: boolean, frame: Frame) {
      const { projection, material, effective, climate } = frame
      const { shape, geometry, orientation, camera, scale, open } = projection
      if (backgroundChanged || backgroundTexture.uniform.value.image !== source) backgroundTexture.update(source)
      if (!previousShape || previousShape.shape !== shape || !sameGeometry(previousShape.geometry, geometry)) {
        previousShape = { shape, geometry }
        updateShape(shape, geometry, frame.reelAngle)
      } else if (shape.id === 'cassette' && previousReelAngle !== frame.reelAngle) {
        repaintInk(shape, geometry, frame.reelAngle)
      }
      surfaceLayer.mesh.visible = Boolean(frame.surfaceEffect)
      if (frame.surfaceEffect) {
        surface.width = Math.ceil(geometry.width * 2)
        surface.height = Math.ceil(geometry.height * 2)
        surfaceContext.scale(surface.width / geometry.width, surface.height / geometry.height)
        frame.surfaceEffect(surfaceContext, geometry, frame.time)
        surfaceTexture.update(surface)
      }

      common.u_view.value.set(frame.width, frame.height)
      common.u_half.value.set(geometry.width / 2, geometry.height / 2)
      common.u_radius.value = geometry.radius
      common.u_open.value = open
      common.u_aa.value = Math.max(.35, .62 / (canvas.width / frame.width * scale))
      common.u_tone.value.set(effective.blur, effective.saturation, effective.brightness)
      common.u_lens.value.set(material.rimWidth, material.edge, material.power, material.dispersion)
      common.u_style.value.set(effective.shadow, effective.tint, material.light)
      common.u_tintColor.value.set(...climate.glass.tintColor)
      common.u_inkBrightness.value = frame.inkBrightness
      common.u_weatherLight.value.set(...climate.rimTint)
      common.u_weatherRim.value = climate.rimLight
      if (frame.rainField) prepareRain(frame.rainField)
      common.u_weatherRain.value = frame.rainField ? climate.surfaceRain * Math.min(1, frame.rainAmount) : 0
      const snowVisible = climate.frost > .002 && frame.frostCoverage > 0
      const frostLimit = snowVisible ? prepareFrost(shape, geometry) : 0
      common.u_weatherFrost.value = snowVisible ? climate.frost : 0
      common.u_frostCoverage.value = snowVisible ? Math.min(frame.frostCoverage, frostLimit) : 0

      weatherLayer.mesh.visible = common.u_weatherRain.value > .002 || snowVisible

      pivot.quaternion.copy(orientation)
      pivot.scale.setScalar(scale)
      edgeUniforms.u_opacity.value = Math.max(0, 1 - open * 4)
      edgeUniforms.u_light.value = material.light * climate.rimLight
      if (edge) {
        edge.visible = edgeUniforms.u_opacity.value > 0
        edge.position.z = layerDepth(projection, 4) - EDGE_DEPTH
      }

      for (const [index, { mesh, uniforms }] of allPlanes.entries()) {
        const selectedLayer = index === 7 ? 'light' : LAYERS[index]
        const emphasized = frame.selected === selectedLayer
        uniforms.u_weight.value = selectedLayer && frame.selected && !emphasized ? 1 - .64 * open : 1
        uniforms.u_emphasis.value = Number(emphasized)
        const pad = uniforms.u_pad.value
        mesh.scale.set(geometry.width / 2 + pad, geometry.height / 2 + pad, 1)
        mesh.position.z = layerDepth(projection, index === 7 ? 4 : index === 6 ? 3 : index)
      }
      pivot.updateMatrixWorld(true)
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      for (const { mesh, uniforms } of allPlanes) {
        uniforms.u_localToClip.value.multiplyMatrices(viewProjection, mesh.matrixWorld)
      }
      renderer.render(scene, camera)
    },
    destroy() {
      for (const { mesh } of allPlanes) mesh.material.dispose()
      planeGeometry.dispose()
      edge?.geometry.dispose()
      face.dispose()
      side.dispose()
      backgroundTexture.uniform.value.dispose()
      maskTexture.uniform.value.dispose()
      surfaceTexture.uniform.value.dispose()
      emptyFrost.dispose()
      for (const atlas of frostAtlases.values()) atlas.texture.dispose()
      rainTexture.value.dispose()
      renderer.dispose()
    },
  }
}
