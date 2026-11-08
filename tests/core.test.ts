import { describe, expect, it } from "vitest";
import { clothingMask } from "../src/core/clothingMask";
import { nearestNames, normalizeQuery, parseHex, searchColors } from "../src/core/colorLookup";
import { BY_APP_NAME, googleColor, imageSearchUrl } from "../src/core/imageSearch";
import { COLOR_NAMES } from "../src/core/colorNames";
import { colorMatch, describeColor, familyMatch, percent, saturation } from "../src/core/colorMatch";
import { colorName, familyBand, HUE_FAMILIES, lean, painterHue } from "../src/core/colorVocabulary";
import { linearToLab, surveyNames, type ColorSurvey } from "../src/core/colorSurvey";
import surveyData from "../public/color-survey.json";
import { OkLab, srgbToLinear, type LinearRgb } from "../src/core/oklab";
import { analyzeOutfit, coordinate, COPY, NO_RESULT, palette, type CoordinationResult } from "../src/core/outfitCoordination";
import { describeRelative, sampleCenterAndSurround, SAME } from "../src/core/relativeColor";
import { applyGains, gainsFromWhite, NO_CORRECTION } from "../src/core/whiteReference";

const srgb = OkLab.fromSrgb;

const WHITE = srgb(245, 245, 245);
const BLACK = srgb(20, 20, 20);
const NAVY = srgb(20, 30, 80);
const DENIM = srgb(70, 100, 140);
const BEIGE = srgb(215, 200, 170);
const RED = srgb(200, 30, 40);
const GREEN = srgb(30, 150, 60);
const BLUE = srgb(30, 70, 210);
const ORANGE = srgb(240, 130, 20);
const YELLOW = srgb(240, 220, 40);
const PURPLE = srgb(120, 40, 170);

describe("named relationships", () => {
  it("recognizes neutrals", () => {
    expect(coordinate([BLACK, WHITE]).detail).toContain("neutrals");
    expect(coordinate([NAVY, BEIGE]).detail).toContain("neutrals");
  });

  it("recognizes one color with neutrals", () => {
    const { detail } = coordinate([RED, DENIM]);
    expect(detail).toContain("one color against neutrals");
    expect(detail).toContain("denim");
  });

  it("recognizes shades of one color", () => {
    expect(coordinate([srgb(40, 80, 200), srgb(140, 170, 240)]).detail).toContain("shades of one color");
  });

  it("recognizes a single-color look", () => {
    expect(coordinate([RED]).detail).toContain("single-color");
  });

  it.each([
    ["red and green", RED, GREEN],
    ["blue and orange", BLUE, ORANGE],
    ["yellow and purple", YELLOW, PURPLE],
  ])("treats %s as opposites", (_name, first, second) => {
    expect(coordinate([first, second]).detail).toContain("opposites");
  });

  it("recognizes neighbors on the wheel", () => {
    expect(coordinate([ORANGE, YELLOW]).detail).toContain("neighbors");
  });

  it("recognizes the primary triad", () => {
    expect(coordinate([RED, YELLOW, BLUE]).detail).toContain("evenly spaced");
  });

  it("mentions neutrals alongside a relationship", () => {
    const { detail } = coordinate([RED, GREEN, WHITE]);
    expect(detail).toContain("opposites");
    expect(detail).toContain("white");
  });
});

describe("the promise: nothing negative, ever", () => {
  // Matched as whole words, so "low" flags a low score but leaves "yellow" alone.
  const BANNED_WORDS = [
    "clash", "clashes", "clashing", "bad", "wrong", "poor", "mismatch", "mismatched", "ugly", "avoid",
    "should", "instead", "unfortunately", "sorry", "fail", "failed", "error", "invalid", "not", "cannot",
    "try", "retake", "weak", "low", "score", "rating", "off", "problem", "issue", "better", "worse",
    "unable", "busy", "too", "bold",
  ];
  const BANNED_FRAGMENTS = ["n't", "%", "—"];

  function expectKind(text: string): void {
    const lowered = text.toLowerCase();
    for (const word of BANNED_WORDS) {
      expect(new RegExp(`\\b${word}\\b`).test(lowered), `"${text}" contains "${word}"`).toBe(false);
    }
    for (const fragment of BANNED_FRAGMENTS) {
      expect(lowered.includes(fragment), `"${text}" contains "${fragment}"`).toBe(false);
    }
  }

  it("keeps all wording free of judgement", () => {
    Object.values(COPY).forEach(expectKind);
  });

  it("stays kind across the whole color space", () => {
    const steps = 6;
    const grid: OkLab[] = [];
    for (let r = 0; r < steps; r++) {
      for (let g = 0; g < steps; g++) {
        for (let b = 0; b < steps; b++) {
          grid.push(srgb((r * 255) / (steps - 1), (g * 255) / (steps - 1), (b * 255) / (steps - 1)));
        }
      }
    }

    let foundCount = 0;
    let noneCount = 0;
    const seen = new Set<string>();
    for (const first of grid) {
      for (const second of grid) {
        const result: CoordinationResult = coordinate([first, second]);
        if (result.detail === null) {
          noneCount++;
          expect(result).toBe(NO_RESULT);
        } else {
          foundCount++;
          expect(result.headline).toBe(COPY.foundHeadline);
          seen.add(result.detail);
        }
      }
    }

    for (const detail of seen) {
      expectKind(detail);
      expect(/\d/.test(detail), detail).toBe(false);
    }

    // Most pairs should get something kind to read rather than the empty result.
    expect(foundCount, `${foundCount} found, ${noneCount} empty`).toBeGreaterThan(noneCount * 3);
  });

  it("makes every empty result identical", () => {
    const rgba = new Uint8ClampedArray(300 * 4);
    const noClothing = new Array<boolean>(300).fill(false);
    const allClothing = new Array<boolean>(300).fill(true);

    expect(analyzeOutfit(null, null)).toBe(NO_RESULT);
    expect(analyzeOutfit(rgba, new Array<boolean>(7).fill(true))).toBe(NO_RESULT);
    expect(analyzeOutfit(rgba, noClothing)).toBe(NO_RESULT);
    expect(coordinate([])).toBe(NO_RESULT);
    expect(coordinate([RED, GREEN, BLUE, ORANGE, YELLOW])).toBe(NO_RESULT);
    expect(analyzeOutfit(rgba, allClothing).detail, "All-black clothing is a neutral look.").not.toBeNull();

    expect(NO_RESULT.headline).toBe("No results found");
    expect(NO_RESULT.detail, "An empty result must not leak colors or a reason.").toBeNull();
  });

  it("never throws on random palettes", () => {
    let seed = 7;
    const next = (limit: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed % limit;
    };

    for (let i = 0; i < 5000; i++) {
      const colors = Array.from({ length: next(7) }, () => srgb(next(256), next(256), next(256)));
      const { headline, detail } = coordinate(colors);
      expect(headline).toBeTruthy();
      if (detail) expectKind(detail);
    }
  });
});

describe("analyzing pixels", () => {
  /** A fully masked square image with slight noise, split between colors by percentage. */
  function photo(side: number, ...parts: [number, number, number, number][]) {
    const count = side * side;
    const rgba = new Uint8ClampedArray(count * 4);
    const mask = new Array<boolean>(count).fill(false);
    let seed = 3;
    const noisy = (channel: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return channel + (seed % 9) - 4;
    };

    let index = 0;
    for (const [r, g, b, percent] of parts) {
      const end = Math.min(count, index + Math.floor((count * percent) / 100));
      for (; index < end; index++) {
        mask[index] = true;
        rgba[index * 4] = noisy(r);
        rgba[index * 4 + 1] = noisy(g);
        rgba[index * 4 + 2] = noisy(b);
        rgba[index * 4 + 3] = 255;
      }
    }
    return { rgba, mask };
  }

  it("finds the palette", () => {
    const { rgba, mask } = photo(120, [20, 30, 80, 60], [245, 245, 245, 40]);
    const { detail } = analyzeOutfit(rgba, mask);
    expect(detail).toContain("Navy");
    expect(detail).toContain("white");
  });

  it("treats the lit and shaded sides of one fabric as one color", () => {
    // Close to a real photo of an orange suit: the same fabric in light and in shadow.
    const { rgba, mask } = photo(120, [226, 132, 92, 70], [172, 88, 62, 30]);
    const { detail } = analyzeOutfit(rgba, mask);
    expect(detail).toContain("single-color");
    expect(detail).toContain("Orange");
  });

  it("folds a garment's deep shadow into the garment", () => {
    // Swatches measured from a real photo of an orange suit, once reported as "orange and dark pink".
    const polar = (l: number, c: number, h: number) =>
      new OkLab(l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180));
    const pixels = [
      ...new Array<OkLab>(73).fill(polar(0.632, 0.146, 37)),
      ...new Array<OkLab>(18).fill(polar(0.413, 0.079, 7)),
      ...new Array<OkLab>(9).fill(polar(0.121, 0.014, 43)),
    ];
    const { detail } = coordinate(palette(pixels));
    expect(detail).toBe("Orange with black: one color against neutrals.");
  });

  it("keeps a dark top and a lighter skirt of similar hue as two colors", () => {
    const { rgba, mask } = photo(120, [110, 15, 35, 50], [200, 30, 40, 50]);
    const detail = analyzeOutfit(rgba, mask).detail!.toLowerCase();
    expect(detail).toContain("burgundy");
    expect(detail).toContain("red");
  });

  it("keeps different colors apart even when they are similarly light", () => {
    const { rgba, mask } = photo(120, [200, 30, 40, 50], [30, 150, 60, 50]);
    expect(analyzeOutfit(rgba, mask).detail).toContain("opposites");
  });

  it("ignores pixels outside the mask, such as skin", () => {
    const { rgba, mask } = photo(120, [200, 30, 40, 100]);
    for (let i = 0; i < mask.length / 2; i++) {
      mask[i] = false;
      rgba[i * 4] = 30;
      rgba[i * 4 + 1] = 150;
      rgba[i * 4 + 2] = 60;
    }
    expect(analyzeOutfit(rgba, mask).detail).toContain("single-color");
  });

  it("gives the empty result for very little clothing", () => {
    const { rgba, mask } = photo(120, [200, 30, 40, 100]);
    mask.fill(false, 100);
    expect(analyzeOutfit(rgba, mask)).toBe(NO_RESULT);
  });

  it("gives the same result for the same input", () => {
    const { rgba, mask } = photo(120, [200, 30, 40, 50], [30, 150, 60, 30], [245, 245, 245, 20]);
    expect(analyzeOutfit(rgba, mask).detail).toBe(analyzeOutfit(rgba, mask).detail);
  });
});

describe("relative color", () => {
  it("calls a near match about the same", () => {
    expect(describeRelative(srgb(120, 80, 60), srgb(121, 80, 60))).toBe(SAME);
  });

  it("compares grays on lightness only", () => {
    expect(describeRelative(srgb(200, 200, 200), srgb(100, 100, 100))).toBe("lighter");
    expect(describeRelative(srgb(100, 100, 100), srgb(200, 200, 200))).toBe("darker");
  });

  it("uses opponent words for hue shifts", () => {
    expect(describeRelative(srgb(200, 80, 80), srgb(80, 160, 80))).toContain("redder");
    expect(describeRelative(srgb(80, 160, 80), srgb(200, 80, 80))).toContain("greener");
    expect(describeRelative(srgb(70, 90, 200), srgb(190, 170, 60))).toContain("bluer");
    expect(describeRelative(srgb(190, 170, 60), srgb(70, 90, 200))).toContain("yellower");
  });

  it("describes colorfulness against gray", () => {
    expect(describeRelative(srgb(200, 40, 40), srgb(120, 120, 120))).toContain("more colorful");
    expect(describeRelative(srgb(120, 120, 120), srgb(200, 40, 40))).toContain("more gray");
  });

  it("reports vividness within one hue", () => {
    expect(describeRelative(srgb(220, 30, 30), srgb(160, 100, 100))).toContain("more vivid");
  });

  it("stays quiet on nearby lightness", () => {
    expect(describeRelative(srgb(100, 100, 100), srgb(102, 102, 102))).toBe(SAME);
  });

  it("samples the center separately from its surroundings", () => {
    const side = 32;
    const half = (side - 1) / 2;
    const rgba = new Uint8ClampedArray(side * side * 4);

    // A red disc on a gray field.
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const disc = Math.hypot((x - half) / half, (y - half) / half) < 0.25;
        const i = (y * side + x) * 4;
        rgba[i] = disc ? 200 : 120;
        rgba[i + 1] = disc ? 30 : 120;
        rgba[i + 2] = disc ? 40 : 120;
        rgba[i + 3] = 255;
      }
    }

    const sampled = sampleCenterAndSurround(rgba, side);
    const center = OkLab.fromLinear(sampled.center);
    const surround = OkLab.fromLinear(sampled.surround);
    expect(center.distanceTo(srgb(200, 30, 40))).toBeLessThan(0.001);
    expect(surround.distanceTo(srgb(120, 120, 120))).toBeLessThan(0.001);
    expect(describeRelative(center, surround)).toContain("more colorful");
  });

  it("skips transparent pixels past the edge of the image", () => {
    const side = 32;
    const rgba = new Uint8ClampedArray(side * side * 4);

    // Only the left half of the frame has image in it, as when reading near the image edge.
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side / 2; x++) {
        const i = (y * side + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 200;
        rgba[i + 3] = 255;
      }
    }

    const { surround } = sampleCenterAndSurround(rgba, side);
    expect(OkLab.fromLinear(surround).distanceTo(srgb(200, 200, 200))).toBeLessThan(0.001);
  });
});

describe("white reference", () => {
  // Warm indoor light: strong red, weaker green, much weaker blue.
  const WARM_LIGHT: LinearRgb = [1, 0.72, 0.42];
  const underWarmLight = (r: number, g: number, b: number) => applyGains(srgbToLinear(r, g, b), WARM_LIGHT);
  const name = (color: LinearRgb) => colorName(OkLab.fromLinear(color));

  it("makes white paper under warm light neutral", () => {
    const white = underWarmLight(245, 245, 245);
    expect(OkLab.fromLinear(white).chroma).toBeGreaterThan(0.05);

    const gains = gainsFromWhite(white)!;
    expect(OkLab.fromLinear(applyGains(white, gains)).chroma).toBeLessThan(0.001);
  });

  it("corrects the name of other colors in the same light", () => {
    const gains = gainsFromWhite(underWarmLight(245, 245, 245))!;
    const gray = underWarmLight(128, 128, 128);
    const blue = underWarmLight(30, 70, 210);

    expect(name(gray)).not.toBe("gray");
    expect(name(applyGains(gray, gains))).toBe("gray");
    expect(name(applyGains(blue, gains))).toBe("blue");
  });

  it("works from a gray card as well as white paper", () => {
    const gains = gainsFromWhite(underWarmLight(150, 150, 150))!;
    expect(name(applyGains(underWarmLight(245, 245, 245), gains))).toBe("white");
  });

  it("keeps the brightness of the reference", () => {
    const white = underWarmLight(200, 200, 200);
    const before = OkLab.fromLinear(white).l;
    const after = OkLab.fromLinear(applyGains(white, gainsFromWhite(white)!)).l;
    expect(Math.abs(before - after)).toBeLessThan(0.03);
  });

  it("declines spots that could not be white or gray", () => {
    expect(gainsFromWhite(srgbToLinear(20, 20, 20)), "very dark").toBeNull();
    expect(gainsFromWhite(srgbToLinear(200, 30, 40)), "vivid red").toBeNull();
    expect(gainsFromWhite(srgbToLinear(30, 70, 210)), "vivid blue").toBeNull();
    expect(gainsFromWhite(srgbToLinear(0, 255, 255)), "pure cyan").toBeNull();
  });

  it("changes nothing without a reference", () => {
    expect(applyGains([0.2, 0.4, 0.6], NO_CORRECTION)).toEqual([0.2, 0.4, 0.6]);
  });

  it("corrects outfit analysis", () => {
    // A gray shirt and white pants under warm light: read as sRGB pixels, the way a camera sees them.
    const encode = (channel: number) =>
      Math.round(255 * (channel > 0.0031308 ? 1.055 * channel ** (1 / 2.4) - 0.055 : channel * 12.92));
    const side = 60;
    const rgba = new Uint8ClampedArray(side * side * 4);
    const mask = new Array<boolean>(side * side).fill(true);
    const gray = underWarmLight(128, 128, 128).map(encode);
    const white = underWarmLight(245, 245, 245).map(encode);
    for (let i = 0; i < mask.length; i++) {
      rgba.set([...(i < mask.length / 2 ? gray : white), 255], i * 4);
    }

    const gains = gainsFromWhite(underWarmLight(245, 245, 245))!;
    const { detail } = analyzeOutfit(rgba, mask, gains);
    expect(detail).toContain("all neutrals");
    expect(detail!.toLowerCase()).toContain("gray");
    expect(detail!.toLowerCase()).toContain("white");
  });
});

describe("clothing mask", () => {
  const SIDE = 8;
  const frame = (value: number) => new Float32Array(SIDE * SIDE).fill(value);

  it("keeps confident clothing inside an eroded edge", () => {
    const mask = clothingMask(frame(0.99), SIDE, SIDE)!;
    expect(mask[3 * SIDE + 3], "The interior stays.").toBe(true);
    expect(mask[0], "The outer edge is eroded.").toBe(false);
  });

  it("excludes uncertain pixels", () => {
    expect(clothingMask(frame(0.6), SIDE, SIDE)!.some(Boolean)).toBe(false);
  });

  it("excludes a pixel whose neighbor is uncertain", () => {
    const confidence = frame(0.99);
    confidence[3 * SIDE + 4] = 0.1;
    const mask = clothingMask(confidence, SIDE, SIDE)!;
    expect(mask[3 * SIDE + 3]).toBe(false);
    expect(mask[5 * SIDE + 5]).toBe(true);
  });

  it("gives no mask for wrong-sized input", () => {
    expect(clothingMask(new Float32Array(5), SIDE, SIDE)).toBeNull();
    expect(clothingMask(null, SIDE, SIDE)).toBeNull();
  });
});

describe("color vocabulary", () => {
  it.each([
    [20, 30, 80, "navy"],
    [70, 100, 140, "denim blue"],
    [245, 245, 245, "white"],
    [15, 15, 15, "black"],
    [128, 128, 128, "gray"],
    [215, 200, 170, "beige"],
    [100, 65, 35, "brown"],
    [200, 30, 40, "red"],
    [240, 130, 20, "orange"],
    [240, 220, 40, "yellow"],
    [30, 150, 60, "green"],
    [30, 70, 210, "blue"],
    [120, 40, 170, "purple"],
    [110, 15, 35, "burgundy"],
    [226, 132, 92, "orange"],
    [31, 14, 64, "navy"], // Measured from the blue of a flag in a film photo, once named purple.
    [10, 49, 97, "navy"],
    [65, 105, 225, "blue"],
    [75, 0, 130, "dark purple"],
    [138, 43, 226, "purple"],
    [128, 0, 128, "purple"],
    [255, 0, 255, "magenta"],
    [255, 105, 180, "magenta"],
    [0, 255, 255, "cyan"],
    [20, 170, 170, "cyan"],
    [255, 192, 203, "light magenta"],
  ])("names rgb(%i, %i, %i) as %s", (r, g, b, expected) => {
    expect(colorName(srgb(r, g, b))).toBe(expected);
  });

  it("reads a near-black shadow with a trace of color as black", () => {
    // Measured from a real photo: this was once named "dark pink".
    const radians = (357 * Math.PI) / 180;
    expect(colorName(new OkLab(0.26, 0.04 * Math.cos(radians), 0.04 * Math.sin(radians)))).toBe("black");
  });

  it("covers every hue with exactly one family", () => {
    for (let hue = 0; hue < 360; hue++) {
      const matches = HUE_FAMILIES.filter(({ from, to }) => (from < to ? hue >= from && hue < to : hue >= from || hue < to));
      expect(matches.length, `hue ${hue}`).toBe(1);
    }
  });

  it("finds a band's center, including one that wraps around 360", () => {
    expect(familyBand({ name: "Red", hue: 29, from: 15, to: 35 })).toEqual({ center: 25, halfWidth: 10 });
    expect(familyBand({ name: "Wrap", hue: 0, from: 345, to: 15 })).toEqual({ center: 0, halfWidth: 15 });
  });

  it("keeps each family's true hue inside its own band", () => {
    for (const { name, hue, from, to } of HUE_FAMILIES) {
      const inside = from < to ? hue >= from && hue < to : hue >= from || hue < to;
      expect(inside, name).toBe(true);
    }
  });

  it("matches each wheel color's true hue", () => {
    const hueOf = (name: string) => HUE_FAMILIES.find((family) => family.name === name)!.hue;
    expect(Math.abs(srgb(255, 0, 0).hue - hueOf("Red"))).toBeLessThan(2);
    expect(Math.abs(srgb(255, 255, 0).hue - hueOf("Yellow"))).toBeLessThan(2);
    expect(Math.abs(srgb(0, 255, 0).hue - hueOf("Green"))).toBeLessThan(2);
    expect(Math.abs(srgb(0, 255, 255).hue - hueOf("Cyan"))).toBeLessThan(2);
    expect(Math.abs(srgb(0, 0, 255).hue - hueOf("Blue"))).toBeLessThan(2);
    expect(Math.abs(srgb(255, 0, 255).hue - hueOf("Magenta"))).toBeLessThan(2);
  });

  it("puts classic opposites across the painter's wheel", () => {
    const gap = (first: OkLab, second: OkLab) => {
      const difference = Math.abs(painterHue(first.hue) - painterHue(second.hue)) % 360;
      return difference > 180 ? 360 - difference : difference;
    };
    expect(gap(RED, GREEN)).toBeGreaterThan(140);
    expect(gap(BLUE, ORANGE)).toBeGreaterThan(140);
    expect(gap(YELLOW, PURPLE)).toBeGreaterThan(140);
  });
});

describe("color lookup", () => {
  it("puts the exact name first, then common names that start with the query", () => {
    expect(searchColors("sage")[0].name).toBe("sage");
    expect(searchColors("navy")[0].name).toBe("navy");
    const starts = searchColors("bl").map(({ name }) => name);
    expect(starts.slice(0, 2)).toEqual(["blue", "black"]);
  });

  it("finds clothing names and words inside longer names", () => {
    for (const name of ["mauve", "taupe", "burgundy", "camel", "mustard", "khaki", "denim"]) {
      expect(searchColors(name).length).toBeGreaterThan(0);
    }
    expect(searchColors("dusty").every(({ name }) => name.includes("dusty"))).toBe(true);
  });

  it("accepts grey and gray alike", () => {
    expect(normalizeQuery("  Light   GREY ")).toBe("light gray");
    expect(searchColors("grey")[0].name).toBe("gray");
  });

  it("reads hex codes, short and long, with or without #", () => {
    expect(parseHex("#87ae73")?.hex).toBe("#87ae73");
    expect(parseHex("87AE73")?.hex).toBe("#87ae73");
    expect(parseHex("#fff")?.hex).toBe("#ffffff");
    expect(parseHex("fff")).toBeNull();
    expect(parseHex("sage")).toBeNull();
    expect(searchColors("#003366")[0].hex).toBe("#003366");
  });

  it("finds nothing for nonsense rather than guessing", () => {
    expect(searchColors("zzqx")).toEqual([]);
    expect(searchColors("   ")).toEqual([]);
  });
});

describe("describing a color in the app's words", () => {
  const lookup = (name: string) => searchColors(name)[0].color;

  it("turns clothing names into family, lightness and strength", () => {
    expect(describeColor(lookup("sage"))).toEqual({ name: "green", tone: "light, soft" });
    expect(describeColor(lookup("navy")).name).toBe("navy");
    expect(describeColor(lookup("burgundy")).name).toBe("burgundy");
    expect(describeColor(lookup("taupe")).name).toBe("beige");
  });

  it("gives neutrals no strength word", () => {
    expect(describeColor(srgb(128, 128, 128))).toEqual({ name: "gray", tone: "medium" });
  });

  it("rates the most vivid sRGB colors near full saturation, and grays near none", () => {
    for (const color of [srgb(255, 0, 0), srgb(0, 0, 255), srgb(0, 255, 255), srgb(255, 255, 0)]) {
      expect(saturation(color)).toBeGreaterThan(0.9);
    }
    expect(saturation(srgb(128, 128, 128))).toBeLessThan(0.05);
  });
});

describe("match percentages", () => {
  const family = (name: string) => HUE_FAMILIES.find((entry) => entry.name === name)!;

  it("matches a family fully at its center and not at all far away", () => {
    expect(familyMatch(RED, family("Red"))).toBeGreaterThan(0.9);
    expect(familyMatch(GREEN, family("Red"))).toBe(0);
    expect(familyMatch(BLUE, family("Blue"))).toBeGreaterThan(0.9);
  });

  it("gives colors between two families a partial match to both", () => {
    // Hue near the red and orange boundary.
    const redOrange = srgb(230, 80, 30);
    const red = familyMatch(redOrange, family("Red"));
    const orange = familyMatch(redOrange, family("Orange"));
    expect(red).toBeGreaterThan(0.2);
    expect(red).toBeLessThan(0.9);
    expect(orange).toBeGreaterThan(0.2);
    expect(orange).toBeLessThan(0.9);
  });

  it("gives grays no family match", () => {
    expect(familyMatch(srgb(128, 128, 128), family("Red"))).toBe(0);
  });

  it("matches a looked-up color by closeness, forgiving lightness more than hue", () => {
    const sage = searchColors("sage")[0].color;
    expect(colorMatch(sage, sage)).toBe(1);

    const shaded = new OkLab(sage.l - 0.08, sage.a, sage.b);
    const shifted = new OkLab(sage.l, sage.a + 0.08, sage.b);
    expect(colorMatch(shaded, sage)).toBeGreaterThan(colorMatch(shifted, sage));
    expect(colorMatch(searchColors("purple")[0].color, sage)).toBe(0);
  });

  it("shows whole percentages", () => {
    expect(percent(0.624)).toBe("62%");
    expect(percent(1)).toBe("100%");
  });
});

describe("looking up the color at the reticle", () => {
  it("finds the named color itself first", () => {
    for (const name of ["sage", "navy", "burgundy", "mustard"]) {
      const color = searchColors(name)[0].color;
      expect(nearestNames(color)[0].name).toBe(name);
    }
  });

  it("returns the requested number of names, closest first", () => {
    const color = srgb(135, 174, 115);
    const names = nearestNames(color, 3);
    expect(names).toHaveLength(3);
    const distances = names.map(({ color: named }) => named.distanceTo(color));
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });
});

describe("image search links", () => {
  it("searches Google Images for the name, filtered to the nearest of Google's colors", () => {
    const url = new URL(imageSearchUrl("sage", searchColors("sage")[0].color));
    expect(url.origin + url.pathname).toBe("https://www.google.com/search");
    expect(url.searchParams.get("udm")).toBe("2");
    expect(url.searchParams.get("q")).toBe("sage color");
    expect(url.searchParams.get("tbs")).toBe("ic:specific,isc:green");
  });

  it("maps every named color to one of Google's filter colors on purpose, not by fallback", () => {
    for (const [name] of COLOR_NAMES) {
      const appName = colorName(searchColors(name)[0].color).replace(/^(light|dark) /, "");
      expect(BY_APP_NAME[appName], `${name} reads as ${appName}`).toBeDefined();
    }
    expect(googleColor(searchColors("navy")[0].color)).toBe("blue");
    expect(googleColor(searchColors("taupe")[0].color)).toBe("brown");
    expect(googleColor(searchColors("mauve")[0].color)).toBe("pink");
  });

  it("sends only the color name, nothing about the photo", () => {
    const url = new URL(imageSearchUrl("rust", searchColors("rust")[0].color));
    expect([...url.searchParams.keys()].sort()).toEqual(["q", "tbs", "udm"]);
  });
});

describe("colors people disagree about", () => {
  const hex = (h: string): LinearRgb => srgbToLinear(...([0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]));
  const survey = surveyData as unknown as ColorSurvey;
  const names = (h: string) => surveyNames(survey, hex(h)).map(({ name }) => name);

  // A pale yellow wall, and the white trim beside it.
  const WALL = hex("f2e6a0");
  const TRIM = hex("f8f8f4");

  it("calls pale yellow paint beige, as most people do, and says it leans yellow", () => {
    const wall = OkLab.fromLinear(WALL);
    expect(colorName(wall)).toBe("beige");
    expect(lean(wall)).toBe("yellow");
    expect(names("f2e6a0")[0]).toBe("beige");
  });

  it("still finds the yellow after a camera balances white on a frame full of wall", () => {
    // Gray-world auto white balance over a frame that is mostly wall makes the wall nearly neutral.
    const mean = WALL.map((w, i) => 0.85 * w + 0.15 * TRIM[i]);
    const luminance = 0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2];
    const camera = mean.map((m) => luminance / m) as unknown as LinearRgb;
    const seenWall = OkLab.fromLinear(applyGains(WALL, camera));
    expect(colorName(seenWall)).toBe("white");
    expect(lean(seenWall)).toBe("yellow");

    // Set white on the trim brings the paint's own color back.
    const gains = gainsFromWhite(applyGains(TRIM, camera))!;
    const corrected = OkLab.fromLinear(applyGains(applyGains(WALL, camera), gains));
    expect(colorName(corrected)).toBe("beige");
    expect(corrected.chroma).toBeGreaterThan(0.08);
  });

  it("gives no lean to true grays, chromatic colors, or neutrals named for their hue", () => {
    expect(lean(srgb(128, 128, 128))).toBeNull();
    expect(lean(RED)).toBeNull();
    expect(lean(NAVY)).toBeNull();
    expect(lean(BLACK)).toBeNull();
  });

  it("knows what people call common colors", () => {
    expect(names("ffff00")[0]).toBe("yellow");
    expect(names("0000ff")[0]).toBe("blue");
    expect(names("ff81c0")).toContain("pink");
    expect(names("f6e27f")).toContain("yellow");
  });

  it("borrows from a neighboring bin rather than going silent", () => {
    // Every sRGB color lands in or next to a bin with data.
    for (let r = 0; r <= 255; r += 51)
      for (let g = 0; g <= 255; g += 51)
        for (let b = 0; b <= 255; b += 51) {
          expect(surveyNames(survey, srgbToLinear(r, g, b)).length, `${r},${g},${b}`).toBeGreaterThan(0);
        }
  });

  it("spells names with spaces and gray, as the rest of the app does", () => {
    expect(survey.terms).toContain("pale yellow");
    expect(survey.terms.some((term) => term.includes("grey"))).toBe(false);
    expect(survey.license).toMatch(/Stanford University/);
  });

  it("converts to CIELAB the way C3's bins expect", () => {
    const [l, a, b] = linearToLab(srgbToLinear(255, 255, 255));
    expect(l).toBeCloseTo(100, 0);
    expect(Math.abs(a)).toBeLessThan(0.5);
    expect(Math.abs(b)).toBeLessThan(0.5);
  });
});
