import { srgbToLinear, type LinearRgb, type OkLab } from "./oklab";

/**
 * Describes one color relative to another, such as "lighter, redder".
 * Both samples come from the same frame under the same light, so this reading holds up under
 * lighting that would throw off a color's absolute name.
 */

export const SAME = "about the same";

// Below these differences, camera noise can flip the answer from frame to frame.
const LIGHTNESS_STEP = 0.03;
const CHROMA_STEP = 0.02;
const HUE_AXIS_STEP = 0.02;

// Grays have no reliable hue, so only compare hue when both colors have some color in them.
const MIN_CHROMA_FOR_HUE = 0.025;

// The weaker hue axis only gets a word when it is close to the stronger one.
const SECOND_AXIS_RATIO = 0.6;

// As a fraction of half the frame. The gap between the two keeps blur from mixing them.
const CENTER_RADIUS = 0.15;
const SURROUND_INNER = 0.35;
const SURROUND_OUTER = 0.65;

export function describeRelative(target: OkLab, reference: OkLab): string {
  const words: string[] = [];

  const dL = target.l - reference.l;
  if (Math.abs(dL) >= LIGHTNESS_STEP) words.push(dL > 0 ? "lighter" : "darker");

  const targetHasHue = target.chroma >= MIN_CHROMA_FOR_HUE;
  const referenceHasHue = reference.chroma >= MIN_CHROMA_FOR_HUE;
  const dC = target.chroma - reference.chroma;

  if (targetHasHue && referenceHasHue) {
    addHueWords(words, target.a - reference.a, target.b - reference.b);
    if (Math.abs(dC) >= CHROMA_STEP) words.push(dC > 0 ? "more vivid" : "more muted");
  } else if (targetHasHue && Math.abs(dC) >= CHROMA_STEP) {
    words.push("more colorful");
  } else if (referenceHasHue && Math.abs(dC) >= CHROMA_STEP) {
    words.push("more gray");
  }

  return words.length === 0 ? SAME : words.join(", ");
}

function addHueWords(words: string[], dA: number, dB: number): void {
  const absA = Math.abs(dA);
  const absB = Math.abs(dB);
  const strongest = Math.max(absA, absB);
  if (strongest < HUE_AXIS_STEP) return;

  const redGreen = dA > 0 ? "redder" : "greener";
  const yellowBlue = dB > 0 ? "yellower" : "bluer";

  const [first, second, secondSize] = absA >= absB ? [redGreen, yellowBlue, absB] : [yellowBlue, redGreen, absA];
  words.push(first);
  if (secondSize >= HUE_AXIS_STEP && secondSize >= strongest * SECOND_AXIS_RATIO) words.push(second);
}

/**
 * Reads the reticle's color and the ring of color around it from a small square frame.
 * The result is in linear light, so a white reference can still be applied to it afterward.
 * @param rgba sRGB pixels as packed r, g, b, a bytes, as canvas image data provides them. Fully
 * transparent pixels are skipped, which is what the frame holds past the edge of the image.
 */
export function sampleCenterAndSurround(
  rgba: ArrayLike<number>,
  side: number,
): { center: LinearRgb; surround: LinearRgb } {
  const half = (side - 1) / 2;
  const centerSum = [0, 0, 0, 0];
  const surroundSum = [0, 0, 0, 0];

  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const radius = Math.hypot((x - half) / half, (y - half) / half);
      const bucket =
        radius <= CENTER_RADIUS
          ? centerSum
          : radius >= SURROUND_INNER && radius <= SURROUND_OUTER
            ? surroundSum
            : null;
      if (!bucket) continue;

      const i = (y * side + x) * 4;
      if (rgba[i + 3] === 0) continue;

      const [r, g, b] = srgbToLinear(rgba[i], rgba[i + 1], rgba[i + 2]);
      bucket[0] += r;
      bucket[1] += g;
      bucket[2] += b;
      bucket[3] += 1;
    }
  }

  return { center: average(centerSum), surround: average(surroundSum) };
}

function average([r, g, b, count]: number[]): LinearRgb {
  return count === 0 ? [0, 0, 0] : [r / count, g / count, b / count];
}
