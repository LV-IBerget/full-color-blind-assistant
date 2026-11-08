import { colorName } from "./colorVocabulary";
import type { OkLab } from "./oklab";

/**
 * Builds a Google Images search for pictures in a color, so someone can see what things in that color
 * look like. Only the color's name leaves the device; the photo never does.
 */

// Google Images' own color filter has twelve choices. Each of the app's names maps to the nearest one.
type GoogleColor = "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "purple" | "pink" | "white" | "gray" | "black" | "brown";

export const BY_APP_NAME: Readonly<Record<string, GoogleColor>> = {
  red: "red",
  burgundy: "red",
  orange: "orange",
  yellow: "yellow",
  green: "green",
  olive: "green",
  cyan: "teal",
  blue: "blue",
  navy: "blue",
  "denim blue": "blue",
  purple: "purple",
  magenta: "pink",
  white: "white",
  cream: "white",
  gray: "gray",
  charcoal: "gray",
  black: "black",
  beige: "brown",
  tan: "brown",
  brown: "brown",
};

export function googleColor(color: OkLab): GoogleColor {
  // "light green" and "dark blue" filter the same as green and blue.
  const name = colorName(color).replace(/^(light|dark) /, "");
  return BY_APP_NAME[name] ?? "gray";
}

/** A Google Images search for the color's name, filtered to Google's nearest color. */
export function imageSearchUrl(name: string, color: OkLab): string {
  const url = new URL("https://www.google.com/search");
  // udm=2 is Google's images tab. The older tbm=isch now redirects to it.
  url.searchParams.set("udm", "2");
  url.searchParams.set("q", `${name} color`);
  url.searchParams.set("tbs", `ic:specific,isc:${googleColor(color)}`);
  return url.toString();
}
