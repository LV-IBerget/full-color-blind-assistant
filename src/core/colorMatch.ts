import { colorName, familyBand, isNeutral, type HueFamily } from "./colorVocabulary";
import type { OkLab } from "./oklab";

/**
 * How closely a color matches a hue family or a looked-up color, from 0 to 1. The readout shows it as a
 * percentage and the hatching shows it as line thickness, so the shader in src/hueHatch.ts repeats this
 * math with these same constants. Change them together.
 */

export const HUE_BINS = 24;

/**
 * The most vivid chroma sRGB can reach at each of 24 hue bins, starting at hue 0. Raw chroma is not
 * saturation: pure cyan has half the chroma of pure blue, yet both are as saturated as a color can be.
 */
export const MAX_CHROMA: ReadonlyArray<number> = [
  0.264, 0.254, 0.258, 0.205, 0.179, 0.17, 0.178, 0.203, 0.226, 0.268, 0.252, 0.19, 0.164, 0.155, 0.146, 0.149,
  0.167, 0.214, 0.307, 0.294, 0.295, 0.307, 0.322, 0.287,
];

// Below CHROMA_MIN a color has no reliable hue, so it matches no hue family. Full by CHROMA_FULL.
export const CHROMA_MIN = 0.03;
export const CHROMA_FULL = 0.075;

// A hue family fades out over this many half-widths from its center, so a color right on a family's
// edge matches it about halfway, and its neighbor about halfway too.
export const FAMILY_REACH = 2;

// A looked-up color fades out over this OKLab distance. A just-noticeable difference is about 0.02,
// and the same fabric under different light easily lands 0.05 away, which still matches about 75%.
export const COLOR_RADIUS = 0.15;

// Lightness counts for less than hue and chroma, because shading and light change it the most.
export const LIGHTNESS_WEIGHT = 0.5;

/** How saturated a color is compared with the most vivid color of its hue, from 0 to 1. */
export function saturation(color: OkLab): number {
  const position = (color.hue / 360) * HUE_BINS;
  const lower = Math.floor(position) % HUE_BINS;
  const fraction = position - Math.floor(position);
  const max = MAX_CHROMA[lower] + (MAX_CHROMA[(lower + 1) % HUE_BINS] - MAX_CHROMA[lower]) * fraction;
  return Math.min(1, color.chroma / max);
}

export function familyMatch(color: OkLab, family: HueFamily): number {
  const { center, halfWidth } = familyBand(family);
  const away = angleBetween(color.hue, center);
  return smoothstep(CHROMA_MIN, CHROMA_FULL, color.chroma) * falloff(away / (halfWidth * FAMILY_REACH));
}

export function colorMatch(color: OkLab, target: OkLab): number {
  const distance = Math.hypot((color.l - target.l) * LIGHTNESS_WEIGHT, color.a - target.a, color.b - target.b);
  return falloff(distance / COLOR_RADIUS);
}

/** As a whole percentage, for reading aloud or on screen. */
export function percent(match: number): string {
  return `${Math.round(match * 100)}%`;
}

/**
 * Puts any color into the app's own words: the name the reticle would show, and how light and how
 * colorful it is. "Sage" becomes "green: light, soft".
 */
export function describeColor(color: OkLab): { name: string; tone: string } {
  const words = [lightnessWord(color.l)];
  if (!isNeutral(color)) words.push(saturationWord(saturation(color)));
  return { name: colorName(color), tone: words.join(", ") };
}

function lightnessWord(l: number): string {
  if (l < 0.3) return "very dark";
  if (l < 0.45) return "dark";
  if (l < 0.65) return "medium";
  if (l < 0.82) return "light";
  return "very light";
}

function saturationWord(s: number): string {
  if (s < 0.25) return "grayish";
  if (s < 0.55) return "soft";
  if (s < 0.8) return "strong";
  return "vivid";
}

/** 1 at the center, 0.5 halfway, 0 from 1 on, with no corners. */
function falloff(t: number): number {
  return t >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * t);
}

function angleBetween(a: number, b: number): number {
  const away = Math.abs(a - b) % 360;
  return away > 180 ? 360 - away : away;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
