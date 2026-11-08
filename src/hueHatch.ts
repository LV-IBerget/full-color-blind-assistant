import {
  CHROMA_FULL,
  CHROMA_MIN,
  COLOR_RADIUS,
  HUE_BINS,
  LIGHTNESS_WEIGHT,
  MAX_CHROMA,
} from "./core/colorMatch";
import type { OkLab } from "./core/oklab";

/**
 * Draws hue as direction and motion on the GPU, so color can be read without seeing color.
 *
 * Each pixel's perceptual hue picks the direction its hatch lines flow in. Colorless pixels get no
 * lines. Lines have a sharp leading edge and a fading tail, so direction still reads in a still frame
 * or with motion turned down, and two hues opposite each other flow in opposite directions.
 *
 * Saturation sets how fast the lines flow: muted colors drift and vivid colors run.
 *
 * With one hue family or one looked-up color chosen, line thickness shows how closely each pixel
 * matches it: the lines cover about as much of the gap between them as the match percentage, so a full
 * match is nearly solid, a partial match has thin lines, and no match has none. Every line then runs
 * the chosen color's own direction, because lines of two directions crossing would read as a grid
 * rather than a thickness. The match math mirrors src/core/colorMatch.ts, so the readout's percentage
 * and the lines agree.
 *
 * Hatching a continuously varying direction swirls into noise, because rotating stripes around a
 * shared origin moves them further the further a pixel is from that origin. So hue is split into fixed
 * bins whose stripes are coherent across the whole image, and pixels blend between the two nearest
 * bins. Same hue, same stripes, anywhere on screen. Speed has the same problem over time, because
 * pixels at slightly different speeds drift further apart every second, so it uses fixed levels too.
 *
 * The OKLab constants match src/core/oklab.ts. Change them together.
 */

const VERTEX_SHADER = `#version 300 es
out vec2 vUv;
void main() {
  // One triangle that covers the screen, with no vertex buffer needed.
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const glslFloat = (value: number): string => (Number.isInteger(value) ? value.toFixed(1) : String(value));

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

#define TWO_PI 6.28318530718
#define PI 3.14159265359
#define HUE_BINS ${glslFloat(HUE_BINS)}

// 0 hatches every hue. 1 shows the match to a hue family, 2 the match to one color.
uniform int uMode;
uniform sampler2D uImage;
uniform vec2 uTexel;
uniform float uSeconds;
uniform vec3 uGains;
uniform float uSpacing;
uniform float uFilterCenter;
uniform float uFilterReach;
uniform float uMatchAngle;
uniform vec3 uTarget;

in vec2 vUv;
out vec4 fragColor;

const float STRENGTH = 0.85;
const float CHROMA_MIN = ${glslFloat(CHROMA_MIN)};
const float CHROMA_FULL = ${glslFloat(CHROMA_FULL)};
const float COLOR_RADIUS = ${glslFloat(COLOR_RADIUS)};
const float LIGHTNESS_WEIGHT = ${glslFloat(LIGHTNESS_WEIGHT)};

// Lines per second for muted, middling and vivid colors. All are multiples of 0.1, so motion loops
// seamlessly every 10 seconds, which is how long uSeconds runs before wrapping.
const float SPEEDS[3] = float[3](0.3, 0.8, 1.6);

const float MAX_CHROMA[${HUE_BINS}] = float[${HUE_BINS}](${MAX_CHROMA.map(glslFloat).join(", ")});

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec3 linearToOkLab(vec3 c) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;

  l = pow(max(l, 0.0), 1.0 / 3.0);
  m = pow(max(m, 0.0), 1.0 / 3.0);
  s = pow(max(s, 0.0), 1.0 / 3.0);

  return vec3(
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}

float falloff(float t) {
  return t >= 1.0 ? 0.0 : 0.5 + 0.5 * cos(PI * t);
}

float match(vec3 lab, float chroma, float hue) {
  if (uMode == 1) {
    float away = abs(hue - uFilterCenter);
    if (away > PI) away = TWO_PI - away;
    return smoothstep(CHROMA_MIN, CHROMA_FULL, chroma) * falloff(away / uFilterReach);
  }
  vec3 difference = lab - uTarget;
  difference.x *= LIGHTNESS_WEIGHT;
  return falloff(length(difference) / COLOR_RADIUS);
}

// One line per spacing period, flowing toward +direction. Every hue: a comet with its head at the
// front. Matching: a band covering the match's share of the period, so 25% is a quarter of the gap.
float hatchLine(float binIndex, float speed, float amount) {
  float angle = binIndex / HUE_BINS * TWO_PI;
  vec2 direction = vec2(cos(angle), sin(angle));
  float phase = fract(dot(gl_FragCoord.xy, direction) / uSpacing - uSeconds * speed);

  if (uMode == 0) {
    float head = 1.0 - smoothstep(0.90, 1.0, phase);
    return head * phase * phase * phase;
  }

  float pixel = 1.0 / uSpacing;
  float width = max(0.08, 0.9 * amount);
  float start = 1.0 - width;
  float body = smoothstep(start - pixel, start + pixel, phase);
  float head = 1.0 - smoothstep(1.0 - 2.0 * pixel, 1.0, phase);
  return body * head * mix(0.6, 1.0, clamp((phase - start) / width, 0.0, 1.0));
}

float hatchAtSpeed(float lowerBin, float hueBlend, float speed, float amount) {
  return mix(hatchLine(lowerBin, speed, amount), hatchLine(lowerBin + 1.0, speed, amount), hueBlend);
}

void main() {
  // A small blur steadies hue against sensor noise, which would otherwise speckle the boundaries
  // between bins.
  vec2 offset = uTexel * 1.5;
  vec4 center = texture(uImage, vUv);
  vec3 blurred = center.rgb * 0.4
    + texture(uImage, vUv + vec2(offset.x, 0.0)).rgb * 0.15
    + texture(uImage, vUv - vec2(offset.x, 0.0)).rgb * 0.15
    + texture(uImage, vUv + vec2(0.0, offset.y)).rgb * 0.15
    + texture(uImage, vUv - vec2(0.0, offset.y)).rgb * 0.15;

  vec3 lab = linearToOkLab(srgbToLinear(blurred) * uGains);
  float chroma = length(lab.yz);
  float hue = atan(lab.z, lab.y);
  if (hue < 0.0) hue += TWO_PI;

  float hasHue = smoothstep(CHROMA_MIN, CHROMA_FULL, chroma);
  float amount = uMode == 0 ? 1.0 : match(lab, chroma, hue);

  float binPosition = hue / TWO_PI * HUE_BINS;
  float lowerBin = floor(binPosition);
  float binFraction = binPosition - lowerBin;
  float hueBlend = smoothstep(0.3, 0.7, binFraction);

  int bin = int(lowerBin) % ${HUE_BINS};
  float maxChroma = mix(MAX_CHROMA[bin], MAX_CHROMA[(bin + 1) % ${HUE_BINS}], binFraction);
  float saturation = clamp(chroma / maxChroma, 0.0, 1.0);

  float levelPosition = saturation * 2.0;
  int level = int(min(levelPosition, 1.0));
  float levelBlend = smoothstep(0.35, 0.65, levelPosition - float(level));
  float hatch = mix(
    hatchAtSpeed(lowerBin, hueBlend, SPEEDS[level], amount),
    hatchAtSpeed(lowerBin, hueBlend, SPEEDS[level + 1], amount),
    levelBlend);

  float coverage;
  if (uMode == 0) {
    coverage = hatch * hasHue;
  } else {
    float matchBin = uMatchAngle / TWO_PI * HUE_BINS;
    hatch = mix(hatchLine(matchBin, SPEEDS[level], amount), hatchLine(matchBin, SPEEDS[level + 1], amount), levelBlend);
    coverage = hatch * smoothstep(0.02, 0.1, amount);
  }

  // Ink is black or white by lightness, so the lines carry contrast with no color at all.
  float ink = lab.x > 0.6 ? 0.0 : 1.0;
  fragColor = vec4(mix(center.rgb, vec3(ink), coverage * STRENGTH), 1.0);
}`;

// Line spacing in CSS pixels.
const SPACING = 14;

// The shader's speeds all complete whole cycles in this many seconds.
const LOOP_SECONDS = 10;

/** What to show the match to: one hue family, or one color. Leave it out to hatch every hue. */
export type HatchTarget =
  | { kind: "family"; /** Center hue, in degrees. */ hue: number; /** Where the match fades to 0, in degrees. */ reach: number }
  | { kind: "color"; color: OkLab };

export class HueHatch {
  private readonly uniforms: Record<string, WebGLUniformLocation | null>;
  private readonly texture: WebGLTexture;

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    program: WebGLProgram,
  ) {
    gl.useProgram(program);
    gl.bindVertexArray(gl.createVertexArray());

    this.uniforms = Object.fromEntries(
      ["uMode", "uTexel", "uSeconds", "uGains", "uSpacing", "uFilterCenter", "uFilterReach", "uMatchAngle", "uTarget"].map((name) => [
        name,
        gl.getUniformLocation(program, name),
      ]),
    );

    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  }

  /** Returns null where WebGL2 is unavailable. The rest of the app works without it. */
  static create(canvas: HTMLCanvasElement): HueHatch | null {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
    if (!gl) return null;

    const program = gl.createProgram()!;
    for (const [type, source] of [
      [gl.VERTEX_SHADER, VERTEX_SHADER],
      [gl.FRAGMENT_SHADER, FRAGMENT_SHADER],
    ] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.warn("Hatching shader:", gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn("Hatching shader:", gl.getProgramInfoLog(program));
      return null;
    }
    return new HueHatch(gl, program);
  }

  /**
   * @param seconds How long the lines have flowed. Hold it still for reduced motion.
   * @param target Show the match to this, or null to hatch every hue.
   * @param gains Correction for the color of the light. It changes the lines, not the image shown.
   */
  draw(
    source: TexImageSource,
    sourceWidth: number,
    sourceHeight: number,
    seconds: number,
    target: HatchTarget | null,
    gains: readonly [number, number, number],
  ): void {
    const { gl, uniforms } = this;
    const pixelRatio = gl.canvas.width / ((gl.canvas as HTMLCanvasElement).clientWidth || gl.canvas.width);
    const radians = Math.PI / 180;

    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    gl.uniform1i(uniforms.uMode, !target ? 0 : target.kind === "family" ? 1 : 2);
    gl.uniform2f(uniforms.uTexel, 1 / sourceWidth, 1 / sourceHeight);
    gl.uniform1f(uniforms.uSeconds, seconds % LOOP_SECONDS);
    gl.uniform3f(uniforms.uGains, gains[0], gains[1], gains[2]);
    gl.uniform1f(uniforms.uSpacing, SPACING * pixelRatio);
    gl.uniform1f(uniforms.uFilterCenter, target?.kind === "family" ? target.hue * radians : 0);
    gl.uniform1f(uniforms.uFilterReach, target?.kind === "family" ? target.reach * radians : 1);
    if (target?.kind === "color") gl.uniform3f(uniforms.uTarget, target.color.l, target.color.a, target.color.b);

    // A looked-up gray has no hue of its own, so its lines run the way red's would.
    const matchHue = !target ? 0 : target.kind === "family" ? target.hue : target.color.chroma >= CHROMA_MIN ? target.color.hue : 0;
    gl.uniform1f(uniforms.uMatchAngle, matchHue * radians);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
