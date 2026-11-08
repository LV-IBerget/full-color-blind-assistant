import { COLOR_NAMES } from "./colorNames";
import { OkLab } from "./oklab";

/** Finds a color by the name on a label or in a shop listing, or by a hex code. */

export interface LookupColor {
  readonly name: string;
  readonly hex: string;
  readonly color: OkLab;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$|^([0-9a-f]{6})$/;

export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\bgrey\b/g, "gray")
    .replace(/\bgreyish\b/g, "grayish");
}

export function parseHex(query: string): LookupColor | null {
  const match = HEX.exec(normalizeQuery(query));
  if (!match) return null;

  let digits = match[1] ?? match[2];
  if (digits.length === 3) digits = [...digits].map((digit) => digit + digit).join("");
  return fromHex(`#${digits}`, digits);
}

/**
 * Best matches first: the exact name, then names that start with the query, then names with a word that
 * starts with it, then names that contain it. Within each, more common names first.
 */
export function searchColors(query: string, limit = 8): LookupColor[] {
  const q = normalizeQuery(query);
  if (!q) return [];

  const hex = parseHex(q);
  const ranked: Array<{ rank: number; popularity: number; name: string; hex: string }> = [];

  COLOR_NAMES.forEach(([name, hexDigits], popularity) => {
    const rank =
      name === q ? 0 : name.startsWith(q) ? 1 : name.split(" ").some((word) => word.startsWith(q)) ? 2 : name.includes(q) ? 3 : -1;
    if (rank >= 0) ranked.push({ rank, popularity, name, hex: hexDigits });
  });

  ranked.sort((x, y) => x.rank - y.rank || y.popularity - x.popularity);
  const results = ranked.slice(0, limit).map(({ name, hex: digits }) => fromHex(name, digits));
  return hex ? [hex, ...results].slice(0, limit) : results;
}

let allColors: LookupColor[] | null = null;

/** The named colors closest to a color, closest first, so a reading can be searched for by name. */
export function nearestNames(color: OkLab, count = 3): LookupColor[] {
  allColors ??= COLOR_NAMES.map(([name, digits]) => fromHex(name, digits));
  return allColors
    .map((named) => ({ named, distance: named.color.distanceTo(color) }))
    .sort((x, y) => x.distance - y.distance)
    .slice(0, count)
    .map(({ named }) => named);
}

function fromHex(name: string, digits: string): LookupColor {
  const value = Number.parseInt(digits, 16);
  return {
    name,
    hex: `#${digits}`,
    color: OkLab.fromSrgb((value >> 16) & 255, (value >> 8) & 255, value & 255),
  };
}
