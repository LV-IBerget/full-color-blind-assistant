/** Red, green and blue as amounts of light, before sRGB's display encoding. */
export type LinearRgb = readonly [number, number, number];

/** Decodes sRGB channels in the 0 to 255 range. */
export function srgbToLinear(red: number, green: number, blue: number): LinearRgb {
  return [toLinear(red / 255), toLinear(green / 255), toLinear(blue / 255)];
}

/**
 * A color in OKLab, a perceptual space where equal distances look roughly equally different.
 * The constants match the shader in src/hueHatch.ts. Change them together.
 */
export class OkLab {
  constructor(
    readonly l: number,
    readonly a: number,
    readonly b: number,
  ) {}

  /** Colorfulness. Near zero means gray. */
  get chroma(): number {
    return Math.hypot(this.a, this.b);
  }

  /** Hue angle in degrees, from 0 up to 360. */
  get hue(): number {
    const degrees = (Math.atan2(this.b, this.a) * 180) / Math.PI;
    return degrees < 0 ? degrees + 360 : degrees;
  }

  distanceTo(other: OkLab): number {
    return Math.hypot(this.l - other.l, this.a - other.a, this.b - other.b);
  }

  /** Converts sRGB-encoded channels in the 0 to 255 range. */
  static fromSrgb(red: number, green: number, blue: number): OkLab {
    return OkLab.fromLinear(srgbToLinear(red, green, blue));
  }

  static fromLinear([r, g, b]: LinearRgb): OkLab {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

    return new OkLab(
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    );
  }
}

function toLinear(channel: number): number {
  return channel > 0.04045 ? Math.pow((channel + 0.055) / 1.055, 2.4) : channel / 12.92;
}
