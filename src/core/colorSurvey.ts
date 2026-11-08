import type { LinearRgb } from "./oklab";

/**
 * What people call a color, from the C3 color naming model (Heer and Stone, 2012), built on the xkcd
 * survey's millions of answers. For each 5-unit CIELAB bin it keeps the names people used most, as
 * percentages. public/color-survey.json holds the model; scripts/build-color-survey.mjs makes it.
 *
 * The app's own name stays the main answer. The survey adds what else people say, which is most useful
 * for colors people disagree about, such as a pale yellow that half of them call beige.
 */

export interface ColorSurvey {
  /** C3's BSD license notice, which travels with the data. */
  readonly license?: string;
  readonly binSize: number;
  readonly terms: ReadonlyArray<string>;
  /** "L,a,b" bin center to [term index, percent, term index, percent, ...], most common first. */
  readonly bins: Readonly<Record<string, ReadonlyArray<number>>>;
}

export interface SurveyName {
  readonly name: string;
  readonly percent: number;
}

/** CIELAB under D65, the space C3's bins are in. */
export function linearToLab([r, g, b]: LinearRgb): [number, number, number] {
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * The names people most often gave this color, most common first. A bin with too few answers borrows
 * from the nearest neighboring bin that has enough. Empty when nothing near has data.
 */
export function surveyNames(survey: ColorSurvey, color: LinearRgb): SurveyName[] {
  const lab = linearToLab(color);
  const size = survey.binSize;
  const center = lab.map((v) => Math.round(v / size) * size);

  let best: ReadonlyArray<number> | undefined = survey.bins[key(center)];
  if (!best) {
    let bestDistance = Infinity;
    for (const dl of [-size, 0, size])
      for (const da of [-size, 0, size])
        for (const db of [-size, 0, size]) {
          const neighbor = [center[0] + dl, center[1] + da, center[2] + db];
          const entry = survey.bins[key(neighbor)];
          const distance = Math.hypot(neighbor[0] - lab[0], neighbor[1] - lab[1], neighbor[2] - lab[2]);
          if (entry && distance < bestDistance) {
            best = entry;
            bestDistance = distance;
          }
        }
  }
  if (!best) return [];

  const names: SurveyName[] = [];
  for (let i = 0; i < best.length; i += 2) names.push({ name: survey.terms[best[i]], percent: best[i + 1] });
  return names;
}

function key([l, a, b]: number[]): string {
  // Math.round can give -0, which prints as "0" anyway; normalize so lookups never miss on it.
  return [l, a, b].map((v) => String(v + 0)).join(",");
}
