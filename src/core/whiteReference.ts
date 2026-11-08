import { OkLab, type LinearRgb } from "./oklab";

/**
 * Corrects for the color of the light, given something the user knows is white or gray.
 *
 * Light tints everything in a scene by a roughly fixed amount per channel, so dividing that tint out
 * of each channel (a von Kries adaptation) recovers the color under neutral light. It cannot fix errors
 * that differ from color to color, such as dark blues drifting toward purple in film or sensors.
 */

export type Gains = LinearRgb;

export const NO_CORRECTION: Gains = [1, 1, 1];

// A dark spot is mostly noise, and a strongly colored one is probably not white under any common light.
// Warm indoor light on white paper stays well inside these limits.
const MIN_WHITE_LIGHTNESS = 0.35;
const MAX_WHITE_CHROMA = 0.15;

/**
 * The per-channel correction that makes this color neutral, keeping its brightness, so a gray card
 * works as well as white paper. Returns null when the color could not plausibly be white or gray.
 */
export function gainsFromWhite(white: LinearRgb): Gains | null {
  const color = OkLab.fromLinear(white);
  if (color.l < MIN_WHITE_LIGHTNESS || color.chroma > MAX_WHITE_CHROMA) return null;

  const [r, g, b] = white;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [luminance / r, luminance / g, luminance / b];
}

export function applyGains([r, g, b]: LinearRgb, [gainR, gainG, gainB]: Gains): LinearRgb {
  return [r * gainR, g * gainG, b * gainB];
}
