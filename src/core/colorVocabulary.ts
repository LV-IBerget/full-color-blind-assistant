import { OkLab } from "./oklab";

/**
 * Plain-language color names. Neutral here follows how people dress, so navy, denim, beige and brown
 * count as neutrals even though they contain some color.
 */

const GRAY_CHROMA = 0.035;
const DARK_GRAY_CHROMA = 0.06;

// Perceptual hue of each painter's primary and secondary, paired with its wheel position.
const PAINTER_STOPS: ReadonlyArray<readonly [number, number]> = [
  [25, 0], // red
  [58, 60], // orange
  [110, 120], // yellow
  [145, 180], // green
  [265, 240], // blue
  [320, 300], // purple
  [385, 360], // red again
];

export interface HueFamily {
  readonly name: string;
  /** Perceptual hue of the color itself, in degrees. Its hatch lines flow this way, and the key shows it. */
  readonly hue: number;
  /** Start of the family's hue band, in degrees. */
  readonly from: number;
  /** End of the band. Less than from when the band wraps around 360. */
  readonly to: number;
}

/**
 * The color wheel: the painter's six colors plus cyan and magenta. One table for naming colors,
 * filtering hatching and drawing the key, so all three always agree.
 */
export const HUE_FAMILIES: ReadonlyArray<HueFamily> = [
  { name: "Red", hue: 29, from: 15, to: 35 },
  { name: "Orange", hue: 58, from: 35, to: 80 },
  { name: "Yellow", hue: 110, from: 80, to: 122 },
  { name: "Green", hue: 142, from: 122, to: 170 },
  { name: "Cyan", hue: 195, from: 170, to: 225 },
  // Dark blues drift toward purple in film and camera sensors, so blue reaches up to just short of
  // true indigo and violet, which sit around 301.
  { name: "Blue", hue: 264, from: 225, to: 298 },
  { name: "Purple", hue: 308, from: 298, to: 320 },
  { name: "Magenta", hue: 328, from: 320, to: 15 },
];

export function isNeutral(color: OkLab): boolean {
  return neutralName(color) !== null;
}

export function colorName(color: OkLab): string {
  return neutralName(color) ?? chromaticName(color);
}

// Below this a neutral has no hue worth naming, only camera noise.
const LEAN_CHROMA = 0.02;

/**
 * Which way a neutral leans, such as yellow for a beige or a yellowish white. A camera that balances
 * white for the whole frame turns a wall filling it nearly neutral, and a pale yellow paint already
 * reads as beige to most people, so the lean is often the clearest sign of the color underneath.
 * Null for chromatic colors, which say their family already, and for neutrals whose name does.
 */
export function lean(color: OkLab): string | null {
  const name = neutralName(color);
  if (!name || name === "black" || name === "navy" || name === "denim blue" || name === "olive") return null;
  if (color.chroma < LEAN_CHROMA) return null;
  return hueFamily(color.hue);
}

/**
 * Maps a perceptual hue onto the painter's color wheel, the wheel that fashion color advice assumes.
 * Red, orange, yellow, green, blue and purple land 60 degrees apart, so the familiar opposites (red and
 * green, blue and orange, yellow and purple) sit 180 degrees apart. On the perceptual wheel red and
 * green are only about 115 degrees apart.
 */
export function painterHue(okHue: number): number {
  const h = okHue < PAINTER_STOPS[0][0] ? okHue + 360 : okHue;
  for (let i = 0; i < PAINTER_STOPS.length - 1; i++) {
    const [fromHue, fromWheel] = PAINTER_STOPS[i];
    const [toHue, toWheel] = PAINTER_STOPS[i + 1];
    if (h <= toHue) {
      const t = (h - fromHue) / (toHue - fromHue);
      return (fromWheel + t * (toWheel - fromWheel)) % 360;
    }
  }
  return 0;
}

function neutralName({ l, chroma: c, hue: h }: OkLab): string | null {
  // Very dark colors have little room for chroma, so a trace of it there still reads as black.
  if (l < 0.3 && c < DARK_GRAY_CHROMA) return "black";

  if (c < GRAY_CHROMA) {
    if (l < 0.28) return "black";
    if (l < 0.42) return "charcoal";
    if (l < 0.82) return "gray";
    return "white";
  }

  if (h >= 235 && h < 298 && l < 0.38 && c < 0.14) return "navy";
  if (h >= 235 && h <= 290 && l < 0.72 && c < 0.09) return "denim blue";

  const warmHue = h >= 45 && h <= 105;
  if (warmHue && l >= 0.86 && c < 0.07) return "cream";
  if (warmHue && l >= 0.68 && c < 0.09) return "beige";
  if (warmHue && l >= 0.55 && c < 0.11) return "tan";

  if (h >= 30 && h <= 90 && l < 0.55 && c < 0.13) return "brown";
  if (h >= 95 && h <= 135 && l < 0.55 && c < 0.1) return "olive";

  return null;
}

function chromaticName(color: OkLab): string {
  const family = hueFamily(color.hue);

  // Magenta and purple share a hue and differ in lightness: dark magenta is what people call purple.
  if (family === "magenta" && color.hue >= 320 && color.hue < 345 && color.l < 0.55) return "purple";

  if (color.l < 0.42) return family === "red" || family === "magenta" ? "burgundy" : `dark ${family}`;

  // Vivid yellow is naturally very light, so only call a color light when it is also pale.
  if (color.l > 0.82 && color.chroma < 0.12) return `light ${family}`;
  return family;
}

function hueFamily(hue: number): string {
  const family = HUE_FAMILIES.find(({ from, to }) => (from < to ? hue >= from && hue < to : hue >= from || hue < to));
  return family!.name.toLowerCase();
}

/** Middle of a family's hue band, and how far it reaches either side, in degrees. */
export function familyBand({ from, to }: HueFamily): { center: number; halfWidth: number } {
  const width = (to - from + 360) % 360;
  return { center: (from + width / 2) % 360, halfWidth: width / 2 };
}
