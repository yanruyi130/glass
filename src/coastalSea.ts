import type { AudioInput } from './background'

const vertexSource = "#version 300 es\nvoid main() { const vec2 p[3]=vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));gl_Position=vec4(p[gl_VertexID],0.,1.); }"
const fragmentSource = `#version 300 es
precision highp float;
uniform vec2 u_pixels;
uniform float u_aspect, u_phase, u_lightX;
uniform vec3 u_music;
uniform vec2 u_water;
out vec4 outputColor;

void main() {
  vec2 uv = vec2(gl_FragCoord.x, u_pixels.y - gl_FragCoord.y) / u_pixels;
  float eye = 0.018 + uv.y * 0.86;
  vec2 position = vec2((uv.x - .5) * u_aspect * 1.16, 2.18) / eye;
  float filterWidth = max(length(dFdx(position)), length(dFdy(position)));
  vec2 slope = vec2(0.0);
  float crest = 0.0;

  // Separate, irregularly rotated bands build broad swells and fine capillary ripples.
  for (int band = 0; band < 12; ++band) {
    float i = float(band);
    float frequency = 1.61 * pow(1.49, i);
    float heading = -1.04 + i * 2.03 + .66 * sin(i * 1.84);
    vec2 direction = vec2(cos(heading), sin(heading));
    float envelope = 1.0 - smoothstep(.70, 1.92, filterWidth * frequency);
    float bias = 6.1 * sin(i * 7.16);
    float phase = dot(position, direction) * frequency - u_phase * (.47 + sqrt(frequency) * .34) + bias;
    phase += .53 * sin(dot(position, vec2(-direction.y, direction.x)) * frequency * .37 + i * 2.1);
    phase += .23 * sin(dot(position, vec2(.21, -.91)) * frequency * .19 + i);
    float structure = sin(phase);
    float patches = .81 + .13 * sin(dot(position, vec2(1.52, .61)) + i * 2.82)
                       + .06 * sin(dot(position, vec2(-3.27, 1.16)) + i);
    float weight = .23 * u_water.x * pow(.87, i) * envelope * patches * (1.0 + mix(u_music.x, u_music.y, smoothstep(1.0, 6.0, i)));
    slope += direction * (cos(phase) + .18 * sin(2.0 * phase)) * weight;
    crest += (structure + .27 * sin(phase * 2.0 + .6)) * weight;
  }

  vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
  float distanceFog = exp(-uv.y * 21.0);
  float nearWater = smoothstep(0.18, 1.0, uv.y);
  vec3 surface = mix(vec3(.103, .310, .450), vec3(.119, .512, .520), nearWater);
  float shallows = smoothstep(.38, 1.0, uv.y) * (1.0 - smoothstep(.1, .82, uv.x));
  surface = mix(surface, vec3(.156, .548, .548), .48 * shallows);
  vec3 viewDirection = normalize(vec3(-position.x, 1.85, position.y));
  float fresnel = pow(clamp(1.0 - dot(normal, viewDirection), 0.0, 1.0), 3.3);
  vec3 reflection = mix(vec3(.580, .722, .789), vec3(.258, .487, .637), clamp(uv.y * .65 + slope.y, 0.0, 1.0));
  vec3 color = mix(surface, reflection, .25 + .54 * fresnel);
  color *= 1.0 + .22 * crest + .12 * slope.y;

  float lane = (uv.x - u_lightX + .034 * uv.y) / (.082 + uv.y * .17);
  float sunlight = exp(-lane * lane);
  vec3 sunlightDirection = normalize(vec3((u_lightX - .5) * 1.49, .48, -.85));
  vec3 halfway = normalize(viewDirection + sunlightDirection);
  float specular = pow(max(0.0, dot(normal, halfway)), 42.0);
  float glints = pow(max(0.0, .89 + slope.y * 1.05 + slope.x * .21), 7.0);
  float shimmer = smoothstep(.81, 2.65, glints);
  // Break reflections into moving short crests; attenuate them before they alias at the horizon.
  float smallWave = sin(dot(position, vec2(24.3, 82.7)) - u_phase * 2.72
                        + .62 * sin(dot(position, vec2(-15.2, 19.2)) + u_phase * .43));
  float crossing = sin(dot(position, vec2(-31.8, 108.3)) - u_phase * 3.4 + .47 * smallWave);
  float facets = (.66 * smallWave + .34 * crossing);
  float patches = .68 + .22 * sin(dot(position, vec2(8.8, -3.0)) + .8 * smallWave);
  float detailFade = patches * (1.0 - smoothstep(.8, 2.7, filterWidth * 81.0));
  color += vec3(.053, .067, .072) * facets * detailFade;
  float glint = smoothstep(.50, .92, facets) * detailFade;
  float reflectionStrength = .027 + specular * (.109 + u_music.z * .40) + shimmer * .086 + glint * (.084 + u_music.z * .24);
  color += vec3(1.0, .96, .89) * sunlight * reflectionStrength * u_water.y;
  color = mix(color, vec3(.385, .574, .67), distanceFog * .43);
  outputColor = vec4(color, 1.0);
}`

function createTarget() {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true })
  if (!gl) return null
  function compile(type: number, code: string) {
    const shader = gl!.createShader(type)
    if (!shader) return null
    gl!.shaderSource(shader, code)
    gl!.compileShader(shader)
    if (gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) return shader
    gl!.deleteShader(shader)
    return null
  }
  const program = gl.createProgram()
  const vertex = compile(gl.VERTEX_SHADER, vertexSource), fragment = compile(gl.FRAGMENT_SHADER, fragmentSource)
  if (!program || !vertex || !fragment) {
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return null
  }
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return null
  }
  const locations = Object.fromEntries(['u_pixels', 'u_aspect', 'u_phase', 'u_lightX', 'u_music', 'u_water']
    .map(name => [name, gl.getUniformLocation(program, name)]))
  return { canvas, gl, program, locations }
}

function drawFallback(
  ctx: CanvasRenderingContext2D, width: number, top: number, height: number,
  phase: number, lightX: number, audio: AudioInput,
) {
  const base = ctx.createLinearGradient(0, top, 0, top + height)
  base.addColorStop(0, '#548297')
  base.addColorStop(.28, '#34758e')
  base.addColorStop(1, '#2e8590')
  ctx.fillStyle = base
  ctx.fillRect(0, top, width, height)
  for (let i = 0; i < 32; i++) {
    const depth = (i / 32) ** 1.86
    const step = 15 + depth * 45
    const y = top + depth * height
    const alpha = .035 + depth * .18
    ctx.lineWidth = 1 + depth
    for (let x = -step; x < width; x += step * 1.46) {
      const seed = Math.sin(i * 6.7 + x * 7.21), bend = Math.sin(phase * (1 + depth) + seed * 16)
      ctx.strokeStyle = 'rgba(204,228,236,' + (alpha * ((.58 + .24 * bend) + .45 * Math.exp(-((x / width - lightX) ** 2) / .018))) + ')'
      ctx.beginPath()
      ctx.moveTo(x, y + depth * 2 * seed)
      ctx.quadraticCurveTo(x + step * .55, y + bend * depth * (4 + audio.low * audio.energy * 2), x + step, y + depth * bend)
      ctx.stroke()
    }
  }
}

export function createCoastalSea() {
  const surface = createTarget()
  const paint = (
    context: CanvasRenderingContext2D, width: number, height: number,
    phase: number, detail: number, lightX: number, horizon: number, audio: AudioInput,
    waveAmplitude = 1, sunlight = 1,
  ) => {
    const top = Math.round(horizon * height)
    const bottom = height - top
    if (!surface || surface.gl.isContextLost()) {
      drawFallback(context, width, top, bottom, phase, lightX, audio)
      return
    }
    const { canvas, gl, program, locations } = surface
    const scale = Math.min(1, 1060 / width) * Math.max(.66, detail)
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(bottom * scale))
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    gl.viewport(0, 0, w, h)
    gl.useProgram(program)
    gl.uniform2f(locations.u_pixels, w, h)
    gl.uniform1f(locations.u_aspect, width / height)
    gl.uniform1f(locations.u_phase, phase)
    gl.uniform1f(locations.u_lightX, lightX)
    gl.uniform2f(locations.u_water, waveAmplitude, sunlight)
    gl.uniform3f(locations.u_music, .22 * audio.low * audio.energy, .15 * audio.mid * audio.energy, .14 * audio.high * audio.energy)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    context.drawImage(canvas, 0, top, width, bottom)
  }
  return Object.assign(paint, {
    dispose: () => {
      if (!surface) return
      surface.gl.deleteProgram(surface.program)
      surface.gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  })
}
