export const surfaceWeatherGLSL = `
uniform float u_weatherRain, u_weatherFrost, u_frostCoverage;
uniform sampler2D u_frostPattern;
uniform vec3 u_weatherLight;
uniform sampler2D u_rainField;
uniform vec2 u_rainTexel;

vec4 weatherOver(vec4 base, vec3 color, float opacity) {
  return vec4(color * opacity, opacity) + base * (1.0 - opacity);
}

vec4 frostSurface(vec2 p) {
  vec2 uv = p / (u_half * 2.0) + .5;
  vec4 textureField = texture2D(u_frostPattern, uv);
  float mist = textureField.g * (1.0 - smoothstep(-.012, .014, textureField.r - u_frostCoverage));
  float crystal = textureField.b * (1.0 - smoothstep(-.008, .017, textureField.a - u_frostCoverage));
  if (max(mist, crystal) < .004) return vec4(0.0);

  vec2 ripple = vec2(textureField.g - .46, textureField.b - .31) * vec2(1.35, 1.15);
  vec3 refracted = scene(screenPoint(p + ripple));
  vec3 diffuse = (
    refracted * 2.0 + scene(screenPoint(p + vec2(-.67, .39))) + scene(screenPoint(p + vec2(.57, -.40)))
  ) * .25;
  vec3 sheen = mix(u_weatherLight, vec3(.90, .966, 1.0), .64);
  vec3 vapor = mix(diffuse, sheen, .59 + textureField.g * .07);
  vec3 facets = mix(refracted * (.93 + .08 * textureField.g), sheen, .76);
  vec4 cover = weatherOver(vec4(0.0), vapor, mist * .46 * u_weatherFrost);
  cover = weatherOver(cover, facets, crystal * .69 * u_weatherFrost);
  return vec4(cover.rgb / max(cover.a, .0001), cover.a);
}

float rainHeight(vec2 uv) {
  vec2 field = texture2D(u_rainField, uv).rg;
  return field.r + .22 * field.g;
}

vec4 rainSurface(vec2 p) {
  vec2 glassSize = u_half * 2.0;
  vec2 uv = p / glassSize + .5;
  vec2 field = texture2D(u_rainField, uv).rg;
  if (max(field.r, field.g) < .006) return vec4(0.0);

  vec2 texel = u_rainTexel;
  float left = rainHeight(uv - vec2(texel.x, 0.0));
  float right = rainHeight(uv + vec2(texel.x, 0.0));
  float upper = rainHeight(uv - vec2(0.0, texel.y));
  float lower = rainHeight(uv + vec2(0.0, texel.y));
  vec2 gradient = vec2(right - left, lower - upper) / max(texel * glassSize * 2.0, vec2(.3));
  float body = smoothstep(.008, .42, field.r);
  float film = smoothstep(.007, .43, field.g);

  // Height changes deflect the ray. The same film becomes almost optically flat as it dries.
  vec2 ray = gradient * (13.5 + 16.0 * body);
  ray = clamp(ray, vec2(-5.8, -4.2), vec2(5.8, 4.2));
  vec3 source = scene(screenPoint(p + ray));
  vec3 transmission = mix(tone(source), u_tintColor, u_style.y);
  vec3 normal = normalize(vec3(-gradient * 5.2, 1.0));
  vec3 sky = normalize(vec3(-.53, -.64, .70));
  float facing = max(0.0, dot(normal, sky));
  float bevel = smoothstep(.015, .17, length(gradient));
  float reflection = pow(facing, 6.0) * bevel * (.18 + .82 * body);
  float side = max(0.0, dot(normalize(gradient + vec2(.00001)), normalize(vec2(.91, .42))));
  float glint = pow(side, 4.0) * bevel * (body + .24 * film);
  vec3 water = mix(transmission, u_weatherLight, min(.56, reflection * .46 + glint * .36 + film * .18 + body * .13));
  float coverage = min(.94, body * .83 + film * .55 + bevel * body * .08);
  return vec4(water, coverage * u_weatherRain);
}

vec4 weatherSurface(vec2 p, float inside) {
  vec4 accumulated = vec4(0.0);
  if (u_weatherFrost > .002 && u_frostCoverage > 0.0) {
    vec4 frost = frostSurface(p);
    accumulated = weatherOver(accumulated, frost.rgb, frost.a);
  }

  if (u_weatherRain > .002) {
    vec4 rain = rainSurface(p);
    accumulated = weatherOver(accumulated, rain.rgb, rain.a);
  }

  return vec4(accumulated.rgb / max(.0001, accumulated.a), accumulated.a * inside);
}
`
