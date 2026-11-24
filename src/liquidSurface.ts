import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, DynamicDrawUsage, LinearMipmapLinearFilter,
  Mesh, PerspectiveCamera, Scene, ShaderMaterial, SRGBColorSpace, Vector2, Vector3, Vector4, WebGLRenderer,
} from 'three'
import { clamp, mix } from './material'

const FILM = {
  palette: {
    deep: '#091d58', cobalt: '#1748c8', lake: '#117fcc', cyan: '#57dfed', lavender: '#8479cd', glint: '#e6fbff',
    sky: [
      [0, '#77badb'], [.24, '#a6c2d3'], [.42, '#d4d5d9'], [.59, '#efe4d5'], [1, '#c5dfeb'],
    ],
  },
  wave: { amplitude: 1.04, crestLift: 1.08, travel: 2.76, localBend: .73, disturbance: .86, span: 8.6, response: 10.4 },
  fold: { neck: .43, roll: .63 },
  space: { depth: [-16.3, 11.6], diagonal: 4.6, stretch: 2.3, shear: 1.3, depthPhase: 2.4, saddle: 1.48 },
  optics: {
    transmission: .80,
    absorption: [4.25, 1.93, .29],
    sheetThickness: [.25, .56],
    edgeThickness: .72,
    refraction: .105,
    refractiveIndex: 1.38,
    roughness: .24,
    reflection: .82,
    navyReflection: .69,
    cyanReflection: .48,
    violetReflection: .10,
    rimLight: .73,
    focusDepth: 12.1,
    focusRange: 7.2,
  },
  focus: { near: [6.3, 10.5], far: [12.4, 21.4], strength: .64 },
  quality: {
    fine: { across: 152, along: 96, width: 920, height: 545 },
    compact: { across: 96, along: 66, width: 710, height: 470 },
  },
} as const

type Quality = typeof FILM.quality[keyof typeof FILM.quality]
type Inspection = 'wireframe' | 'side'

const VERTEX = `
  attribute float cavity;
  attribute float thickness;
  varying vec3 vViewPosition;
  varying vec3 vViewNormal;
  varying float vCavity;
  varying float vThickness;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = viewPosition.xyz;
    vViewNormal = normalMatrix * normal;
    vCavity = cavity;
    vThickness = thickness;
    gl_Position = projectionMatrix * viewPosition;
  }
`

// Palette weighting and pixel dithering adapted from Glasswork by Kubai087.
// https://github.com/kubai087/glasswork/blob/4f0b6744b898b3a9b98fbd913ab24fdb83c53162/wallpapers.js#L29-L84
// MIT license in public/licenses/glasswork-MIT.txt.
const FRAGMENT = `
  uniform vec3 uDeep, uCobalt, uLake, uCyan, uLavender, uGlint;
  uniform vec2 uFrame;
  uniform vec3 uOptics;
  uniform vec4 uLight;
  uniform vec4 uFocusRange;
  uniform float uFocusStrength;
  uniform vec3 uAbsorption;
  uniform vec3 uReflectionTints;
  uniform float uIor;
  uniform sampler2D uEnvironment;
  varying vec3 vViewPosition;
  varying vec3 vViewNormal;
  varying float vCavity;
  varying float vThickness;

  float pixelHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  vec3 bodyTint(float tone) {
    // Blend along the existing optical tone, which follows the deformed normal.
    vec3 distances = abs(vec3(clamp(tone, 0.0, 1.0)) - vec3(0.03, 0.49, 0.88));
    vec3 weights = 1.0 / (pow(distances, vec3(2.4)) + 0.015);
    return (uDeep * weights.x + uCobalt * weights.y + uLake * weights.z) / dot(weights, vec3(1.0));
  }

  vec3 readEnvironment(vec2 center, vec2 radius, float level) {
    vec3 color = textureLod(uEnvironment, center, level).rgb * 0.36;
    color += textureLod(uEnvironment, center + vec2(radius.x, radius.y * 0.42), level).rgb * 0.16;
    color += textureLod(uEnvironment, center - vec2(radius.x, radius.y * 0.42), level).rgb * 0.16;
    color += textureLod(uEnvironment, center + vec2(-radius.x * 0.42, radius.y), level).rgb * 0.16;
    color += textureLod(uEnvironment, center - vec2(-radius.x * 0.42, radius.y), level).rgb * 0.16;
    return color;
  }

  float reflectionStrip(vec3 ray, vec3 rayDx, vec3 rayDy, vec3 center, vec2 span, float tilt, float softness) {
    vec3 horizontal = normalize(cross(vec3(0.0, 1.0, 0.0), center));
    vec3 vertical = cross(center, horizontal);
    vec3 major = horizontal + tilt * vertical;
    vec3 minor = vertical - tilt * horizontal;
    vec2 position = vec2(dot(ray, major), dot(ray, minor));
    // Filter narrow strips by the reflected ray's footprint in this pixel.
    vec2 dx = vec2(dot(rayDx, major), dot(rayDx, minor));
    vec2 dy = vec2(dot(rayDy, major), dot(rayDy, minor));
    vec2 footprint = min(vec2(0.12), 0.62 * sqrt(dx * dx + dy * dy));
    vec2 spread = softness * vec2(0.35, 1.0);
    vec2 filtered = sqrt(span * span + footprint * footprint + spread * spread);
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
    // The focus plane is fixed in camera space, so an off-center point at
    // the same depth stays equally sharp. Fade out through the grazing rim.
    float viewDepth = -vViewPosition.z;
    float nearDefocus = 1.0 - smoothstep(uFocusRange.x, uFocusRange.y, viewDepth);
    float farDefocus = smoothstep(uFocusRange.z, uFocusRange.w, viewDepth);
    float defocus = uFocusStrength * interior * (0.64 * nearDefocus + farDefocus);
    float edgeDiffuse = 0.20 + 0.42 * abs(dot(normal, light));
    float diffuse = mix(edgeDiffuse, max(0.0, dot(n, light)), faceWeight);
    vec2 uv = gl_FragCoord.xy / uFrame;
    float distanceFromFocus = (length(vViewPosition) - uLight.z) / uLight.w;
    float focus = 1.0 / (1.0 + distanceFromFocus * distanceFromFocus);
    float cavity = vCavity * mix(0.42, 1.0, interior);
    vec3 body = bodyTint(diffuse - 0.16 * cavity);

    float roughness = uOptics.z + 0.20 * (1.0 - focus);
    float fresnelBase = pow((uIor - 1.0) / (uIor + 1.0), 2.0);
    float fresnel = mix(fresnelBase, 1.0, pow(1.0 - facing, 5.0));
    vec3 refracted = refract(-eye, n, 1.0 / uIor);
    vec2 units = vec2(uFrame.y / uFrame.x, 1.0);
    // Keep the foreground sample aligned at a tangent. Refraction and its
    // filter radius open together on the smoothly turning visible surface.
    vec2 shift = (refracted.xy + eye.xy) * uOptics.y * (0.98 + 1.05 * vThickness) * interior;
    float blur = 0.002 + interior * roughness * (0.012 + 0.034 * (1.0 - focus) + 0.008 * vThickness);
    // Prefilter the source scenery rather than blurring covered pixels of
    // the rendered sheet. The same taps stay centered on the refracted ray.
    vec3 environment = readEnvironment(uv + shift * units, blur * units, 3.1 * defocus);
    // Keep the path through the two-sided film bounded at a grazing angle.
    // A turned surface can reflect a thin highlight without a dark sidewall.
    float throughFacing = mix(0.81, 1.0, facing * facing);
    float opticalDepth = vThickness / throughFacing * (1.0 + 0.12 * cavity);
    vec3 transmission = environment * exp(-uAbsorption * opticalDepth);
    float clarity = uOptics.x * (1.0 - 0.13 * cavity) * (1.0 - 0.16 * fresnel);
    vec3 base = mix(body, transmission, clarity);

    float reflectionBlur = 0.13 * defocus;
    float soft = reflectionStrip(reflected, rayDx, rayDy, normalize(vec3(-0.26, 0.55, -0.79)), vec2(0.87, 0.10 + 0.30 * roughness), 0.28, reflectionBlur);
    float ribbon = reflectionStrip(reflected, rayDx, rayDy, normalize(vec3(0.46, 0.25, -0.85)), vec2(0.68, 0.028 + 0.13 * roughness), -0.19, reflectionBlur);
    float shade = reflectionStrip(reflected, rayDx, rayDy, normalize(vec3(-0.10, 0.06, -0.99)), vec2(0.79, 0.14 + 0.16 * roughness), 0.09, reflectionBlur);
    // The dark and bright strips share the same reflection ray and the same
    // deformed normal, so they stretch and turn with the surface.
    float navy = uReflectionTints.x * (0.70 + 0.30 * fresnel) * uLight.x * shade * interior;
    base = mix(base, mix(uDeep, uCobalt, 0.23 + 0.18 * diffuse), navy);
    float violet = uReflectionTints.z * reflectionStrip(reflected, rayDx, rayDy, normalize(vec3(-0.68, 0.39, -0.62)), vec2(0.34, 0.16), 0.23, reflectionBlur);
    base = mix(base, uLavender, violet * (1.0 - shade));
    float cyan = uReflectionTints.y * (0.70 + 0.30 * fresnel) * uLight.x * soft;
    base = mix(base, uCyan, cyan);

    float edgeLight = reflectionStrip(reflected, rayDx, rayDy, normalize(vec3(0.44, -0.12, -0.89)), vec2(0.52, 0.12 + 0.14 * roughness), -0.15, 0.0);
    float rim = filteredRim(facing, mix(24.0, 14.0, roughness)) * (0.15 + 0.52 * edgeLight + 0.20 * ribbon + 0.13 * soft);
    float key = faceWeight * pow(max(0.0, dot(n, normalize(light + eye))), mix(64.0, 20.0, roughness));
    // Hand over the narrow reflection to the grazing rim on the same film.
    // A shared lobe avoids adding two creases around the turning point.
    float broadGlint = uLight.x * (0.16 * soft + 0.12 * key);
    float ribbonGlint = uLight.x * (0.18 + 0.28 * fresnel) * ribbon;
    float edgeGlint = uLight.y * rim * (0.37 + 0.63 * focus);
    float specular = clamp(broadGlint + mix(edgeGlint, ribbonGlint, interior), 0.0, 0.65);
    vec2 reflectionUV = vec2(0.53 + reflected.x * 0.31, 0.66 + reflected.y * 0.23);
    vec3 reflectedEnvironment = (textureLod(uEnvironment, reflectionUV + vec2(0.06, 0.04), 0.0).rgb
      + textureLod(uEnvironment, reflectionUV - vec2(0.06, 0.04), 0.0).rgb) * 0.5;
    vec3 glint = mix(mix(uCyan, uGlint, mix(0.82, 0.17, interior)), reflectedEnvironment, 0.12 * soft);
    gl_FragColor = vec4(mix(base, glint, specular), 1.0);
    #include <colorspace_fragment>
    // Break up 8-bit gradient steps in output space without animated grain.
    float dither = (pixelHash(gl_FragCoord.xy) - 0.5) / 128.0;
    gl_FragColor.rgb = clamp(gl_FragColor.rgb + dither, 0.0, 1.0);
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
  const thicknesses = new BufferAttribute(new Float32Array(positions.count), 1).setUsage(DynamicDrawUsage)
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
  geometry.setAttribute('thickness', thicknesses)
  geometry.setIndex(new BufferAttribute(indices, 1))
  const columns = Array.from({ length: stride }, (_, column) => {
    const station = 2 * column / across - 1
    // Use more columns where the foreground fills a larger part of the view.
    return station * (.48 + .52 * station * station)
  })
  const sections = Array.from({ length: along + 1 }, (_, row) => {
    const station = row / along
    // Keep enough samples in the wider middle, where the fold crosses in depth.
    const depth = station * (.84 + .16 * station)
    const curl = (depth - .42) * 5.8
    const remaining = 1 - depth
    const farSlope = flowEase(clamp(depth / .20)) * (1 - flowEase(clamp((depth - .22) / .30)))
    return {
      depth, z: mix(...FILM.space.depth, depth), curl: 1 / (1 + curl * curl),
      farTurn: remaining ** 5, farSlope, outer: remaining ** 3,
      foreground: depth * depth * (3 - 2 * depth),
    }
  })
  const columnStencils = derivativeStencils(columns)
  const depthStencils = derivativeStencils(sections.map(section => section.z))
  return { geometry, positions, normals, cavities, thicknesses, columns, sections, columnStencils, depthStencils, stride }
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

function deform(surface: ReturnType<typeof makeSurfaceGeometry>, width: number, time: number, travelDepthSlope: number) {
  const { positions, normals, cavities, thicknesses, columns, sections, columnStencils, depthStencils, stride } = surface
  const { amplitude, crestLift, travel, localBend, disturbance, span, response } = FILM.wave
  // Integrate two slow, shallow speed variations rather than scaling time by
  // an instantaneous speed. The resulting travel always advances to the right.
  const offset = travel * (time + .062 * Math.sin(time * .119) / .119
    + .041 * (Math.sin(time * .053 + 1.4) - Math.sin(1.4)) / .053)
  const pressureTime = time / response
  const depthSpan = FILM.space.depth[1] - FILM.space.depth[0]
  for (let col = 0; col < stride; col++) {
    const across = columns[col]
    const x = width * across
    const station = (x - offset) / span
    // Entering and trailing parts sample the same evolving field, with a
    // short lag and a spatial offset along the direction of the pull.
    const leading = disturbance * flowPressure(station - .96, pressureTime + 3.81)
    const following = disturbance * flowPressure(station - 1.19, pressureTime + 3.56)
    const guide = disturbance * flowPressure(station * .67 + 4.73, pressureTime * .64 + 3.41)
    const ribbonPhase = 2.26 * station + .71 * guide + .55 * leading + .16
    const bank = .28 * Math.sin(.69 * ribbonPhase + .70 * guide)
    const driftRange = .63 + .12 * following
    const centerDrift = Math.sin(ribbonPhase + .31 * Math.sin(.62 * ribbonPhase + .59 * following))
    const centerBend = .81 * (bank + driftRange * centerDrift) + .58 * guide + .31 * leading
    const tension = flowEase(clamp(.47 + .69 * leading + .39 * guide))
    // Parallel to camera-right in the ground plane, this depth offset keeps
    // transport across the frame from descending with the camera's pitch.
    const depthOffset = travelDepthSlope * x
    const farAlignment = 3.4 * Math.tanh(depthOffset / 4.2)
    const sweep = (.48 * FILM.space.diagonal + .78 * guide) * Math.sin(.49 * ribbonPhase + .74 * guide)
    const hingeY = .18 + .30 * centerBend
    const hingeZ = -1.4 + depthOffset + sweep + 2.05 * centerBend + .63 * following
    for (const [row, { depth, z: base, curl, farTurn, farSlope, outer, foreground }] of sections.entries()) {
      const pull = mix(leading, following, foreground)
      // A travelling phase varies across the surface as well as down it.
      // Curves along depth stretch and turn through the same connected field.
      const laneDepth = depth - depthOffset / depthSpan
      const phase = ribbonPhase + (laneDepth - .42) * (FILM.space.depthPhase + .64 * guide)
      const drift = Math.sin(phase + .31 * Math.sin(.62 * phase + .59 * pull))
      // The far return shares the travelling phase with a small lag. Fade
      // its turn across several rows so it joins the interior of the sheet.
      const farWave = .80 * Math.sin(phase - .65 + .36 * following) + .42 * pull
      const lean = bank + driftRange * drift
      const bend = .81 * lean + .58 * guide + .31 * pull
      const roll = localBend * (1.04 * bend + .51 * pull) * curl
      const midSheet = 4 * depth * (1 - depth)
      const stretch = FILM.space.stretch * midSheet * (pull + .36 * bend) * (depth - .37)
      // Keep the lateral borders anchored offscreen as the middle twists.
      const shear = FILM.space.shear * midSheet * (1 - across * across) * (.24 + .64 * bend + .41 * pull)
      const farDepth = farTurn * (.54 + farAlignment + .86 * farWave) + farSlope * (.48 * farAlignment + .92 * farWave)
      const z = base + farDepth + outer * (.48 * bend + .26 * guide) + roll + stretch
      const axis = -3.2 + depthOffset + sweep + 2.05 * bend + 1.05 * pull + .48 * tension
      const reach = z - axis + (laneDepth - .41) * (1.85 * guide + .76 * pull)
      // Shape the crest as a stretched shoulder with a tighter rise and a
      // longer release. A falling pull flattens and lengthens both slopes.
      const neck = localBend * FILM.fold.neck * tension
      const rise = .5 + .5 * Math.tanh((reach + 1.76) / (1.40 - neck - .31 * pull))
      const release = .5 - .5 * Math.tanh((reach - 1.53 + .62 * pull) / (2.36 + .48 * guide - .52 * pull))
      const crestStrength = flowEase(clamp(.64 + .45 * lean + .24 * pull))
      const lift = rise * release * (1.56 + .93 * lean + .70 * pull + .24 * guide
        + crestLift * (.33 + .67 * crestStrength))
      // The return slope widens into a shallow basin and lifts again toward
      // the near side. Its center follows the same sweep with a gentle lag.
      const trough = (reach - 4.45 - .68 * following) / (3.18 - .41 * pull)
      const hollow = Math.exp(-trough * trough) * (.58 + .36 * pull + .19 * tension)
      const returnAxis = 3.15 + depthOffset + .62 * sweep + 1.45 * bend - .86 * following
      const shoulder = .5 + .5 * Math.tanh((z - returnAxis) / (2.65 + .50 * guide))
      const crossSlope = Math.tanh(1.3 * Math.sin(.61 * ribbonPhase - .84 * laneDepth + .55 * following))
      const front = shoulder * foreground * (.87 - .69 * lean + .55 * following + .34 * guide - .52 * crossSlope)
      // An interior saddle bends across the return slope. Its signed relief
      // joins the shelf and basin without adding another crest or boundary.
      const alongSlope = Math.tanh((z - depthOffset - .70 - .42 * sweep + .60 * pull) / 3.9)
      const saddle = FILM.space.saddle * midSheet * alongSlope * crossSlope
      const drape = (.61 * lean + .33 * guide + .60 * pull - .62) * outer
      const farHeight = farTurn * (1.55 * farWave - 1.02) + farSlope * 1.08 * farWave
      const y = -.36 + amplitude * (lift - hollow + front + saddle + drape) + farHeight

      // The roll turns points around a local hinge. Its angle fades with
      // radius, preserving the continuous sheet through the turn.
      const dy = y - hingeY
      const dz = z - hingeZ
      const angle = localBend * FILM.fold.roll * tension * (.86 + .14 * pull) * Math.exp(-(dy * dy + dz * dz) / 4.5)
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      positions.setXYZ(row * stride + col, x + shear, hingeY + dy * cos - dz * sin, hingeZ + dz * cos + dy * sin)
    }
  }

  // Differentiate the deformed positions along the sheet's two parameters.
  // The non-uniform stencil estimates the tangent at the vertex itself and
  // gives both triangles at each diagonal the same smooth normal field.
  const minimumDepthTangent = .40
  const [thin, thick] = FILM.optics.sheetThickness
  for (const [row, depth] of depthStencils.entries()) {
    const rowStart = row * stride
    const farStart = depth.previous * stride
    const nearStart = depth.next * stride
    const section = sections[row]
    const restThickness = mix(thin, thick, section.foreground)
    const endDistance = Math.min(section.depth, 1 - section.depth)
    for (let col = 0; col < stride; col++) {
      const across = columnStencils[col]
      const i = rowStart + col
      const x = positions.getX(i)
      const y = positions.getY(i)
      const z = positions.getZ(i)
      const left = rowStart + across.previous
      const right = rowStart + across.next
      const far = farStart + col
      const near = nearStart + col
      const dxLeft = (x - positions.getX(left)) * across.beforeRate
      const dxRight = (positions.getX(right) - x) * across.afterRate
      const dxFar = (x - positions.getX(far)) * depth.beforeRate
      const dxNear = (positions.getX(near) - x) * depth.afterRate
      const dyLeft = (y - positions.getY(left)) * across.beforeRate
      const dyRight = (positions.getY(right) - y) * across.afterRate
      const dyFar = (y - positions.getY(far)) * depth.beforeRate
      const dyNear = (positions.getY(near) - y) * depth.afterRate
      const dzLeft = (z - positions.getZ(left)) * across.beforeRate
      const dzRight = (positions.getZ(right) - z) * across.afterRate
      const dzFar = (z - positions.getZ(far)) * depth.beforeRate
      const dzNear = (positions.getZ(near) - z) * depth.afterRate
      const dxAcross = mix(dxLeft, dxRight, across.afterWeight)
      const dxDepth = mix(dxFar, dxNear, depth.afterWeight)
      const dyAcross = mix(dyLeft, dyRight, across.afterWeight)
      const dyDepth = mix(dyFar, dyNear, depth.afterWeight)
      const dzAcross = mix(dzLeft, dzRight, across.afterWeight)
      const dzDepth = mix(dzFar, dzNear, depth.afterWeight)
      const nx = dyDepth * dzAcross - dzDepth * dyAcross
      const ny = dzDepth * dxAcross - dxDepth * dzAcross
      const nz = dxDepth * dyAcross - dyDepth * dxAcross
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz)
      // This optical thickness is independent of the mesh height. Stretch
      // and a smooth taper toward the actual perimeter make the film thinner.
      const stretch = clamp(length / width, .66, 2.4)
      const sideDistance = (1 - Math.abs(columns[col])) * .5
      const edge = flowEase(clamp(Math.min(endDistance, sideDistance) / .12))
      const taper = mix(FILM.optics.edgeThickness, 1, edge)
      thicknesses.setX(i, restThickness * taper / Math.sqrt(stretch))
      if (length <= 1e-8) {
        normals.setXYZ(i, 0, 1, 0)
        cavities.setX(i, 0)
        continue
      }
      const normalX = nx / length
      const normalY = ny / length
      const normalZ = nz / length
      normals.setXYZ(i, normalX, normalY, normalZ)

      // Measure how the sheet bends into its own normal, rather than using
      // world height as curvature when the depth tangent turns at the fold.
      const acrossBend = across.curvatureScale * (normalX * (dxRight - dxLeft) + normalY * (dyRight - dyLeft) + normalZ * (dzRight - dzLeft))
        / (dxAcross * dxAcross + dyAcross * dyAcross + dzAcross * dzAcross)
      const depthBend = depth.curvatureScale * (normalX * (dxNear - dxFar) + normalY * (dyNear - dyFar) + normalZ * (dzNear - dzFar))
        / Math.max(minimumDepthTangent, dxDepth * dxDepth + dyDepth * dyDepth + dzDepth * dzDepth)
      const concavity = Math.max(0, acrossBend + depthBend)
      const response = concavity * concavity
      cavities.setX(i, response / (.84 + response))
    }
  }

  positions.needsUpdate = true
  normals.needsUpdate = true
  cavities.needsUpdate = true
  thicknesses.needsUpdate = true
}

export function createLiquidSurface() {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('webgl2', { alpha: true, antialias: true })
  const renderer = context && new WebGLRenderer({ canvas, context })
  const skyCanvas = document.createElement('canvas')
  skyCanvas.width = 384
  skyCanvas.height = 256
  const sky = skyCanvas.getContext('2d', { alpha: false })!
  const { palette, optics, focus } = FILM
  const gradient = sky.createLinearGradient(0, 0, skyCanvas.width * .13, skyCanvas.height)
  for (const [offset, color] of palette.sky) gradient.addColorStop(offset, color)
  sky.fillStyle = gradient
  sky.fillRect(0, 0, skyCanvas.width, skyCanvas.height)
  const environmentCanvas = document.createElement('canvas')
  environmentCanvas.width = skyCanvas.width
  environmentCanvas.height = skyCanvas.height
  const environment = environmentCanvas.getContext('2d', { alpha: false })!
  const environmentTexture = new CanvasTexture(environmentCanvas)
  environmentTexture.colorSpace = SRGBColorSpace
  environmentTexture.minFilter = LinearMipmapLinearFilter
  let quality: Quality = FILM.quality.fine
  let surface = makeSurfaceGeometry(quality)
  const scene = new Scene()
  const camera = new PerspectiveCamera(44, 1, .2, 60)
  const cameraTarget = new Vector3(-.42, .26, -2.55)
  const uniforms = {
    uDeep: { value: new Color(palette.deep) }, uCobalt: { value: new Color(palette.cobalt) },
    uLake: { value: new Color(palette.lake) }, uCyan: { value: new Color(palette.cyan) },
    uLavender: { value: new Color(palette.lavender) }, uGlint: { value: new Color(palette.glint) },
    uFrame: { value: new Vector2() }, uEnvironment: { value: environmentTexture },
    uOptics: { value: new Vector3(optics.transmission, optics.refraction, optics.roughness) },
    uLight: { value: new Vector4(optics.reflection, optics.rimLight, optics.focusDepth, optics.focusRange) },
    uFocusRange: { value: new Vector4(...focus.near, ...focus.far) },
    uFocusStrength: { value: focus.strength },
    uAbsorption: { value: new Vector3(...optics.absorption) },
    uReflectionTints: { value: new Vector3(optics.navyReflection, optics.cyanReflection, optics.violetReflection) },
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
    target.drawImage(skyCanvas, 0, 0, 1, 1)
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
    const cameraX = 4.15 - 1.75 * narrow
    const cameraZ = 9.55 + .70 * narrow
    const travelDepthSlope = (cameraTarget.x - cameraX) / (cameraZ - cameraTarget.z)
    camera.aspect = aspect
    if (import.meta.env.DEV && inspection === 'side') {
      camera.fov = 50
      camera.position.set(12.9, 3.65, 4.1)
      camera.lookAt(0, .35, -.9)
    } else {
      camera.fov = 43 + 8 * narrow
      camera.position.set(cameraX, 6.3 + .23 * narrow, cameraZ)
      camera.lookAt(cameraTarget)
    }
    camera.updateProjectionMatrix()
    if (import.meta.env.DEV) material.wireframe = inspection === 'wireframe'

    // Capture the sky and weather already painted this frame, before the
    // single sheet shades and composites over that same background.
    environment.drawImage(target.canvas, 0, 0, environmentCanvas.width, environmentCanvas.height)
    environmentTexture.needsUpdate = true
    deform(surface, Math.max(10.1, 11.4 * aspect), time, travelDepthSlope)
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
