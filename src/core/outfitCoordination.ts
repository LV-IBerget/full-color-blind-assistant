import { colorName, isNeutral, painterHue } from "./colorVocabulary";
import { OkLab, srgbToLinear } from "./oklab";
import { applyGains, NO_CORRECTION, type Gains } from "./whiteReference";

/**
 * One thing this feature must never do: make someone feel bad about what they are wearing.
 *
 * So there is no score to fall short of. The analysis only ever looks for a named relationship that
 * color theory recognizes, and reports it when it finds one. Everything else, including a photo with no
 * clothes in it, a model failure, and colors with no recognized relationship, returns the one shared
 * NO_RESULT. It carries no colors or reason, so nobody, including the UI, can tell those cases apart
 * or word them as a verdict.
 */
export interface CoordinationResult {
  readonly headline: string;
  /** The reason, in plain words. Null when there is nothing to report. */
  readonly detail: string | null;
}

/** All wording shown for this feature. Tests hold every string to its tone rule. */
export const COPY = {
  working: "Looking at the colors",
  foundHeadline: "These colors go together",
  noResultsHeadline: "No results found",
  neutrals: "{0}: all neutrals, which pair easily.",
  oneColorWithNeutrals: "{0} with {1}: one color against neutrals.",
  tonal: "{0}: shades of one color.",
  singleColor: "{0}: a single-color look.",
  neighbors: "{0}: neighbors on the color wheel.",
  opposites: "{0}: opposites on the color wheel.",
  spaced: "{0}: evenly spaced on the color wheel.",
  withNeutralsSuffix: " Plus {0}.",
} as const;

export const NO_RESULT: CoordinationResult = Object.freeze({ headline: COPY.noResultsHeadline, detail: null });

// Too little clothing in frame gives a palette of noise rather than an outfit.
const MIN_CLOTHING_COVERAGE = 0.03;
const MIN_CLOTHING_PIXELS = 200;

const CLUSTER_COUNT = 5;
const CLUSTER_ITERATIONS = 10;
const MERGE_DISTANCE = 0.06;
const MIN_FABRIC_CHROMA = 0.05;
const SHADING_HUE_DEGREES = 35;
const SHADOW_SHARE_RATIO = 0.6;
const SHADING_CHROMA_RATIO = 0.6;
const SHADING_LIGHTNESS = 0.3;
const MIN_SWATCH_SHARE = 0.08;
const MAX_SWATCHES = 4;

const SAME_FAMILY_DEGREES = 25;
const TONAL_LIGHTNESS_SPREAD = 0.08;

/**
 * @param rgba sRGB pixels as packed r, g, b, a bytes, as canvas image data provides them.
 * @param mask True where a pixel is confidently clothing. Same pixel order.
 * @param gains Correction for the color of the light, if a white reference was set.
 */
export function analyzeOutfit(
  rgba: ArrayLike<number> | null,
  mask: ReadonlyArray<boolean> | null,
  gains: Gains = NO_CORRECTION,
): CoordinationResult {
  if (!rgba || !mask || rgba.length !== mask.length * 4) return NO_RESULT;

  const pixels: OkLab[] = [];
  mask.forEach((isClothing, i) => {
    if (isClothing) {
      const light = srgbToLinear(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
      pixels.push(OkLab.fromLinear(applyGains(light, gains)));
    }
  });

  if (pixels.length < MIN_CLOTHING_PIXELS || pixels.length < mask.length * MIN_CLOTHING_COVERAGE) return NO_RESULT;

  return coordinate(palette(pixels));
}

/** Finds a named relationship in a palette, ordered from largest area to smallest. */
export function coordinate(colors: ReadonlyArray<OkLab>): CoordinationResult {
  if (colors.length === 0 || colors.length > MAX_SWATCHES) return NO_RESULT;

  const neutrals = colors.filter(isNeutral);
  const chromatic = colors.filter((color) => !isNeutral(color));

  if (chromatic.length === 0) return found(fill(COPY.neutrals, names(neutrals)));

  const hues = hueFamilies(chromatic);
  const chromaticNames = names(chromatic);

  if (hues.length === 1) {
    if (neutrals.length > 0) return found(fill(COPY.oneColorWithNeutrals, chromaticNames, names(neutrals)));

    const lightness = chromatic.map((color) => color.l);
    const spread = Math.max(...lightness) - Math.min(...lightness);
    const template = spread >= TONAL_LIGHTNESS_SPREAD && chromatic.length > 1 ? COPY.tonal : COPY.singleColor;
    return found(fill(template, chromaticNames));
  }

  const template = relationTemplate(hues);
  if (!template) return NO_RESULT;

  const detail = fill(template, chromaticNames);
  return found(neutrals.length === 0 ? detail : detail + fill(COPY.withNeutralsSuffix, names(neutrals)));
}

function found(detail: string): CoordinationResult {
  return { headline: COPY.foundHeadline, detail: detail[0].toUpperCase() + detail.slice(1) };
}

function fill(template: string, ...values: string[]): string {
  return values.reduce((text, value, i) => text.replace(`{${i}}`, value), template);
}

function relationTemplate(hues: number[]): string | null {
  if (hues.length === 2) {
    const gap = hueGap(hues[0], hues[1]);
    if (gap <= 60) return COPY.neighbors;
    if (gap >= 140) return COPY.opposites;
    if (gap >= 100) return COPY.spaced;
    return null;
  }

  if (hues.length === 3) {
    const [a, b, c] = [...hues].sort((x, y) => x - y);
    const arcs = [b - a, c - b, 360 - (c - a)];

    // All three fit inside a third of the wheel.
    if (Math.max(...arcs) >= 240) return COPY.neighbors;

    // Triad: three roughly even arcs.
    if (arcs.every((arc) => arc >= 90 && arc <= 150)) return COPY.spaced;

    // Split complement: one color opposite a close pair.
    if (Math.min(...arcs) <= 60 && arcs.filter((arc) => arc >= 120).length === 2) return COPY.opposites;
  }

  return null;
}

/** Groups colors with nearly the same hue, returning one painter's-wheel hue per group. */
function hueFamilies(colors: OkLab[]): number[] {
  const families: number[] = [];
  for (const color of colors) {
    const hue = painterHue(color.hue);
    if (!families.some((family) => hueGap(family, hue) <= SAME_FAMILY_DEGREES)) families.push(hue);
  }
  return families;
}

function hueGap(a: number, b: number): number {
  const difference = Math.abs(a - b) % 360;
  return difference > 180 ? 360 - difference : difference;
}

function names(colors: OkLab[]): string {
  const unique = [...new Set(colors.map(colorName))];
  return unique.length === 1 ? unique[0] : `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

interface Swatch {
  color: OkLab;
  share: number;
}

/** The main colors in the pixels, largest area first. Deterministic for a given input. */
export function palette(pixels: OkLab[]): OkLab[] {
  let centers = farthestFirstCenters(pixels, CLUSTER_COUNT);
  for (let iteration = 0; iteration < CLUSTER_ITERATIONS; iteration++) {
    centers = recenter(pixels, centers);
  }

  const shares = new Array<number>(centers.length).fill(0);
  for (const pixel of pixels) shares[nearest(pixel, centers)] += 1 / pixels.length;

  return merge(centers.map((color, i) => ({ color, share: shares[i] })))
    .filter((swatch) => swatch.share >= MIN_SWATCH_SHARE)
    .sort((x, y) => y.share - x.share)
    .map((swatch) => swatch.color);
}

function farthestFirstCenters(pixels: OkLab[], count: number): OkLab[] {
  const centers = [mean(pixels)];
  while (centers.length < count) {
    let farthest = centers[0];
    let best = -1;
    for (const pixel of pixels) {
      let distance = Infinity;
      for (const center of centers) distance = Math.min(distance, center.distanceTo(pixel));
      if (distance > best) {
        best = distance;
        farthest = pixel;
      }
    }
    if (best <= 0) break;
    centers.push(farthest);
  }
  return centers;
}

function mean(pixels: OkLab[]): OkLab {
  let l = 0;
  let a = 0;
  let b = 0;
  for (const pixel of pixels) {
    l += pixel.l;
    a += pixel.a;
    b += pixel.b;
  }
  return new OkLab(l / pixels.length, a / pixels.length, b / pixels.length);
}

function nearest(pixel: OkLab, centers: OkLab[]): number {
  let index = 0;
  let best = Infinity;
  centers.forEach((center, i) => {
    const distance = center.distanceTo(pixel);
    if (distance < best) {
      best = distance;
      index = i;
    }
  });
  return index;
}

function recenter(pixels: OkLab[], centers: OkLab[]): OkLab[] {
  const sums = centers.map(() => [0, 0, 0, 0]);
  for (const pixel of pixels) {
    const sum = sums[nearest(pixel, centers)];
    sum[0] += pixel.l;
    sum[1] += pixel.a;
    sum[2] += pixel.b;
    sum[3] += 1;
  }
  return centers.map((center, i) => {
    const [l, a, b, count] = sums[i];
    return count === 0 ? center : new OkLab(l / count, a / count, b / count);
  });
}

/**
 * Folds and shadows change a fabric's lightness far more than its color, so the lit and shaded sides of
 * one garment are one color to a person, even though they sit far apart in OKLab. Shade dims chroma
 * along with lightness, which leaves their ratio close to constant, and hue drifts somewhat. Shadow is
 * only ever the smaller part of a garment, which is what keeps a burgundy top and a red skirt as two colors.
 */
function isShadeOf(first: Swatch, second: Swatch): boolean {
  const [lit, shade] = first.color.l >= second.color.l ? [first, second] : [second, first];
  if (lit.color.chroma < MIN_FABRIC_CHROMA || shade.color.chroma < MIN_FABRIC_CHROMA) return false;
  if (lit.color.l - shade.color.l > SHADING_LIGHTNESS) return false;

  const litRatio = lit.color.chroma / lit.color.l;
  const shadeRatio = shade.color.chroma / shade.color.l;
  if (Math.min(litRatio, shadeRatio) / Math.max(litRatio, shadeRatio) < SHADING_CHROMA_RATIO) return false;

  return shade.share <= lit.share * SHADOW_SHARE_RATIO && hueGap(lit.color.hue, shade.color.hue) <= SHADING_HUE_DEGREES;
}

/** Clustering splits one color into fragments, so join those before judging what is a shadow of what. */
function merge(swatches: Swatch[]): Swatch[] {
  return absorbShadows(mergeNearDuplicates(swatches));
}

function mergeNearDuplicates(swatches: Swatch[]): Swatch[] {
  const merged = [...swatches];
  for (let i = 0; i < merged.length; i++) {
    for (let j = i + 1; j < merged.length; j++) {
      const { color: x, share: xShare } = merged[i];
      const { color: y, share: yShare } = merged[j];
      if (x.distanceTo(y) >= MERGE_DISTANCE) continue;

      const total = xShare + yShare;
      const wx = total > 0 ? xShare / total : 0.5;
      const wy = 1 - wx;
      merged[i] = { color: new OkLab(x.l * wx + y.l * wy, x.a * wx + y.a * wy, x.b * wx + y.b * wy), share: total };
      merged.splice(j, 1);

      // The merged color moved, so compare it against everything again.
      return mergeNearDuplicates(merged);
    }
  }
  return merged;
}

function absorbShadows(swatches: Swatch[]): Swatch[] {
  const merged = [...swatches];
  for (let i = 0; i < merged.length; i++) {
    for (let j = i + 1; j < merged.length; j++) {
      if (!isShadeOf(merged[i], merged[j])) continue;

      // Keep the larger swatch's color. Averaging in its shadow would shift the hue being named.
      const larger = merged[i].share >= merged[j].share ? merged[i] : merged[j];
      merged[i] = { color: larger.color, share: merged[i].share + merged[j].share };
      merged.splice(j, 1);
      return absorbShadows(merged);
    }
  }
  return merged;
}
