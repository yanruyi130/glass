/* WebGL blur, signed-distance lens and dispersion adapted from Glasswork by
 * Kubai087 (MIT). See public/licenses/glasswork-MIT.txt. */
import { LAYERS, type EffectiveMaterial, type LayerId, type Material } from './material'
import { CAMERA, layerDepth, type Projection } from './projection'
import type { GlassShape, ShapeGeometry } from './shape'

export type SurfaceEffect = (context: CanvasRenderingContext2D, geometry: ShapeGeometry, time: number) => void

interface Frame {
  width: number
  height: number
  projection: Projection
  material: Material
  effective: EffectiveMaterial
  darkness: number
  inkBrightness: number
  selected: LayerId | null
  time: number
  surfaceEffect: SurfaceEffect | null
}

const projectionGLSL = `
uniform vec2 u_view, u_center, u_half;
uniform mat3 u_axes;
uniform float u_scale, u_depth;
vec3 world(vec2 point) {
  return u_axes * vec3(point, u_depth) * u_scale;
}
float perspective(vec3 p) {
  return 1.0 - p.z / ${CAMERA.toFixed(1)};
}
vec2 screenPoint(vec2 point) {
  vec3 p = world(point);
  return u_center + p.xy / perspective(p);
}`

const vertex = `
precision highp float;
attribute vec2 a_corner;
varying vec2 v_local;
uniform float u_pad;
${projectionGLSL}
void main() {
  v_local = a_corner * (u_half + u_pad);
  vec3 p = world(v_local);
  float w = perspective(p);
  vec2 viewport = (u_center * w + p.xy) / u_view * 2.0 - w;
  gl_Position = vec4(viewport.x, -viewport.y, 0.0, w);
}`

const fragment = (shape: GlassShape) => `
precision highp float;
varying vec2 v_local;
uniform sampler2D u_background, u_ink, u_surface;
uniform float u_radius, u_open, u_weight, u_emphasis, u_aa;
uniform float u_inkBrightness;
uniform int u_layer;
uniform vec3 u_tone;
uniform vec4 u_lens, u_style;
${projectionGLSL}
${shape.distanceGLSL}

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

// Every pass samples the source canvas at the projected coordinates of
// its own plane. The transparent passes never sample the composited stack.
void main() {
  vec2 p = v_local;
  float d = distanceAt(p);
  float inside = 1.0 - smoothstep(-u_aa, u_aa, d);
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
      float falloff = pow(max(0.0, 1.0 - depth / rim), u_lens.z);
      float amount = u_lens.y * rim * falloff;
      if (amount > 0.015 && inside > 0.0) {
        vec2 shift = -outward(p) * amount;
        vec3 bent = blurred(screenPoint(p + shift), u_tone.x);
        float split = u_lens.w;
        if (split > 0.001 && amount > 0.75) {
          bent.r = blurred(screenPoint(p + shift * (1.0 + split)), u_tone.x).r;
          bent.b = blurred(screenPoint(p + shift * (1.0 - split)), u_tone.x).b;
        }
        color = tone(bent);
        alpha = inside * smoothstep(0.0, 1.3, amount) * mix(1.0, 0.87, openGuide);
      }
    } else if (u_layer == 3) {
      color = mix(vec3(1.0, 0.989, 0.972), vec3(0.118, 0.118, 0.133), u_style.w);
      alpha = inside * u_style.y;
    } else if (u_layer == 4) {
      if (depth < 13.0 && inside > 0.0) {
        float facing = dot(outward(p), normalize(vec2(-0.75, -1.0)));
        float upper = pow(max(0.0, facing), 1.6);
        float lower = pow(max(0.0, -facing), 2.0);
        float catchLight = band(depth, 0.86, 0.8) * (0.11 + 0.68 * upper + 0.25 * lower);
        float bevel = band(depth, 4.0, 2.2) * (0.018 + 0.135 * upper + 0.037 * lower);
        float insideGlint = band(depth, 8.0, 2.8) * 0.035 * upper;
        color = mix(vec3(0.67, 0.84, 1.0), vec3(1.0, 0.984, 0.925), 0.26 + upper * 0.64);
        alpha = inside * (catchLight + bevel + insideGlint) * u_style.z * mix(1.0, 0.83, u_style.w);
      }
    } else if (u_layer == 5) {
      float coverage = texture2D(u_ink, uv).a;
      vec3 backdrop = scene(screenPoint(p));
      float iconTone = 1.0 - smoothstep(0.4, 0.62, dot(backdrop, vec3(0.213, 0.715, 0.072)));
      float inkTone = mix(u_inkBrightness, iconTone, step(p.y, -u_half.y * 0.3));
      vec3 darkInk = vec3(0.018, 0.029, 0.060) + backdrop * 0.115;
      vec3 lightInk = vec3(0.87, 0.925, 0.987) + backdrop * 0.08;
      float relief = texture2D(u_ink, uv - vec2(0.0, 1.0 / (2.0 * u_half.y))).a * (1.0 - coverage);
      relief *= mix(0.17, 0.33, inkTone);
      color = (mix(darkInk, lightInk, inkTone) * coverage + mix(lightInk, darkInk, inkTone) * relief)
        / max(0.001, coverage + relief);
      alpha = (coverage + relief) * inside;
    } else {
      vec4 effect = texture2D(u_surface, uv);
      color = effect.rgb;
      alpha = effect.a * inside;
    }
  }

  vec3 contribution = color * alpha * u_weight;
  alpha *= u_weight;
  if (u_layer < 6 && openGuide > 0.0) {
    float line = band(d, 0.0, 0.72 + u_aa * 0.38) * openGuide;
    float guide = (0.28 * u_weight + 0.55 * u_emphasis) * line;
    vec3 guideColor = mix(vec3(0.77, 0.87, 1.0), vec3(0.67, 1.0, 0.96), u_emphasis);
    contribution = guideColor * guide + contribution * (1.0 - guide);
    alpha = guide + alpha * (1.0 - guide);
  }
  gl_FragColor = vec4(contribution, alpha);
}`

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compilation failed')
  return shader
}

function texture(gl: WebGLRenderingContext, unit: number) {
  gl.activeTexture(gl.TEXTURE0 + unit)
  const handle = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, handle)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
  return handle
}

function inkMask(context: CanvasRenderingContext2D, geometry: ShapeGeometry) {
  const { width, height } = geometry
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

export function createGlassRenderer(canvas: HTMLCanvasElement, shape: GlassShape) {
  const context = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false })
  if (!context) return null
  const gl = context
  const program = gl.createProgram()!
  const vert = compile(gl, gl.VERTEX_SHADER, vertex)
  const frag = compile(gl, gl.FRAGMENT_SHADER, fragment(shape))
  gl.attachShader(program, vert)
  gl.attachShader(program, frag)
  gl.bindAttribLocation(program, 0, 'a_corner')
  gl.linkProgram(program)
  gl.deleteShader(vert)
  gl.deleteShader(frag)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Shader linking failed')
  gl.useProgram(program)

  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  gl.clearColor(0, 0, 0, 0)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)

  const at = (name: string) => gl.getUniformLocation(program, 'u_' + name)
  const u = {
    view: at('view'), center: at('center'), half: at('half'), axes: at('axes'), scale: at('scale'),
    depth: at('depth'), pad: at('pad'), radius: at('radius'), open: at('open'), weight: at('weight'),
    emphasis: at('emphasis'), aa: at('aa'), layer: at('layer'), tone: at('tone'), lens: at('lens'), style: at('style'),
    inkBrightness: at('inkBrightness'),
  }
  const textures = [texture(gl, 0), texture(gl, 1), texture(gl, 2)]
  gl.uniform1i(at('background'), 0)
  gl.uniform1i(at('ink'), 1)
  gl.uniform1i(at('surface'), 2)
  const mask = document.createElement('canvas')
  const maskContext = mask.getContext('2d')!
  const surface = document.createElement('canvas')
  const surfaceContext = surface.getContext('2d')!

  function upload(unit: number, source: HTMLCanvasElement) {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  }

  function drawLayer(index: number, depth: number, weight: number, emphasized: boolean) {
    gl.uniform1i(u.layer, index)
    gl.uniform1f(u.depth, depth)
    gl.uniform1f(u.pad, index === 0 ? 34 : 5)
    gl.uniform1f(u.weight, weight)
    gl.uniform1f(u.emphasis, Number(emphasized))
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  let maskWidth = 0
  let backgroundUploaded = false

  return {
    resize(width: number, height: number, ratio: number) {
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      gl.viewport(0, 0, canvas.width, canvas.height)
    },
    render(source: HTMLCanvasElement, backgroundChanged: boolean, frame: Frame) {
      const { projection, material, effective } = frame
      const { geometry, center, axes, scale, open } = projection
      if (backgroundChanged || !backgroundUploaded) {
        upload(0, source)
        backgroundUploaded = true
      }
      if (maskWidth !== geometry.width) {
        maskWidth = geometry.width
        mask.width = Math.ceil(geometry.width * 2)
        mask.height = Math.ceil(geometry.height * 2)
        maskContext.scale(mask.width / geometry.width, mask.height / geometry.height)
        inkMask(maskContext, geometry)
        upload(1, mask)
      }
      if (frame.surfaceEffect) {
        surface.width = Math.ceil(geometry.width * 2)
        surface.height = Math.ceil(geometry.height * 2)
        surfaceContext.scale(surface.width / geometry.width, surface.height / geometry.height)
        frame.surfaceEffect(surfaceContext, geometry, frame.time)
        upload(2, surface)
      }

      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform2f(u.view, frame.width, frame.height)
      gl.uniform2f(u.center, center.x, center.y)
      gl.uniform2f(u.half, geometry.width / 2, geometry.height / 2)
      gl.uniformMatrix3fv(u.axes, false, axes.flat())
      gl.uniform1f(u.scale, scale)
      gl.uniform1f(u.radius, geometry.radius)
      gl.uniform1f(u.open, open)
      gl.uniform1f(u.aa, Math.max(.35, .62 / (canvas.width / frame.width * scale)))
      gl.uniform3f(u.tone, material.blur, effective.saturation, effective.brightness)
      gl.uniform4f(u.lens, material.rimWidth, material.edge, material.power, material.dispersion)
      gl.uniform4f(u.style, material.shadow, effective.tint, material.light, frame.darkness)
      gl.uniform1f(u.inkBrightness, frame.inkBrightness)

      for (const [index, layer] of LAYERS.entries()) {
        if (index === 4 && frame.surfaceEffect) drawLayer(6, layerDepth(projection, 3), 1, false)
        const emphasized = frame.selected === layer
        const weight = frame.selected && !emphasized ? 1 - .64 * open : 1
        drawLayer(index, layerDepth(projection, index), weight, emphasized)
      }
    },
    destroy() {
      textures.forEach(handle => gl.deleteTexture(handle))
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    },
  }
}
