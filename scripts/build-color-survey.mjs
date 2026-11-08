// Shrinks the C3 color naming model into the small file the app loads, public/color-survey.json.
//
// C3 (https://github.com/uwdata/c3, BSD-3-Clause, Copyright (c) 2011 Stanford University) counts, for
// each 5-unit CIELAB bin, how often people in the xkcd color survey answered each of 153 color names.
// This keeps the few names people used most for each bin, as whole percentages.
//
// Usage: node scripts/build-color-survey.mjs path/to/c3_data.json
// The source file is data/xkcd/c3_data.json in the C3 repository.

import fs from "node:fs";

const MIN_ANSWERS = 8;
const MIN_PERCENT = 5;
const MAX_NAMES = 4;

const LICENSE = `C3 color naming model, Copyright (c) 2011, Stanford University. All rights reserved.
Redistribution and use in source and binary forms, with or without modification, are permitted provided
that the following conditions are met: Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer. Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer in the documentation and/or other
materials provided with the distribution. The name Stanford University may not be used to endorse or promote
products derived from this software without specific prior written permission. THIS SOFTWARE IS PROVIDED BY
THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES ARE DISCLAIMED. IN NO
EVENT SHALL STANFORD UNIVERSITY BE LIABLE FOR ANY DAMAGES ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE.`;

// C3 joins words ("paleyellow"). Spaced versions, spelled "gray" as in the rest of the app.
const SPACED = {
  lightblue: "light blue", limegreen: "lime green", lightgreen: "light green", brightgreen: "bright green",
  skyblue: "sky blue", darkblue: "dark blue", darkgreen: "dark green", navyblue: "navy blue", royalblue: "royal blue",
  hotpink: "hot pink", forestgreen: "forest green", lightpurple: "light purple", neongreen: "neon green",
  yellowgreen: "yellow green", darkpurple: "dark purple", seafoamgreen: "seafoam green", brightblue: "bright blue",
  seagreen: "sea green", palegreen: "pale green", bluegreen: "blue green", lightbrown: "light brown",
  darkred: "dark red", greyblue: "gray blue", burntorange: "burnt orange", darkpink: "dark pink",
  bluegrey: "blue gray", lightpink: "light pink", brightpurple: "bright purple", grassgreen: "grass green",
  redorange: "red orange", bluepurple: "blue purple", greygreen: "gray green", kellygreen: "kelly green",
  darkteal: "dark teal", babyblue: "baby blue", paleblue: "pale blue", greenyellow: "green yellow",
  brickred: "brick red", lightgrey: "light gray", darkgrey: "dark gray", brightpink: "bright pink",
  purpleblue: "purple blue", royalpurple: "royal purple", darkbrown: "dark brown", lightorange: "light orange",
  darkorange: "dark orange", redbrown: "red brown", paleyellow: "pale yellow", offwhite: "off white",
  pinkpurple: "pink purple", darkyellow: "dark yellow", lightyellow: "light yellow", mustardyellow: "mustard yellow",
  brightred: "bright red", peagreen: "pea green", orangered: "orange red", deepblue: "deep blue",
  springgreen: "spring green", palepink: "pale pink", yelloworange: "yellow orange", deeppurple: "deep purple",
  pinkred: "pink red", pastelgreen: "pastel green", lightred: "light red", armygreen: "army green",
  robinseggblue: "robin's egg blue", huntergreen: "hunter green", greenblue: "green blue", lightteal: "light teal",
  orangebrown: "orange brown", slateblue: "slate blue", blueviolet: "blue violet", leafgreen: "leaf green",
  electricblue: "electric blue", seablue: "sea blue", midnightblue: "midnight blue", steelblue: "steel blue",
  palepurple: "pale purple", mediumblue: "medium blue", burntsienna: "burnt sienna", darkmagenta: "dark magenta",
  darkturquoise: "dark turquoise", bloodred: "blood red", neonpurple: "neon purple", mossgreen: "moss green",
  oceanblue: "ocean blue", yellowbrown: "yellow brown", brightyellow: "bright yellow", dustyrose: "dusty rose",
  applegreen: "apple green", neonpink: "neon pink", cornflowerblue: "cornflower blue",
  lightturquoise: "light turquoise", deepred: "deep red", grey: "gray",
};

const [source] = process.argv.slice(2);
if (!source) throw new Error("Pass the path to C3's c3_data.json");
const model = JSON.parse(fs.readFileSync(source, "utf8"));

const W = model.terms.length;
const counts = new Map();
for (let i = 0; i < model.T.length; i += 2) counts.set(model.T[i], model.T[i + 1]);

const bins = {};
for (let c = 0; c < model.color.length / 3; c++) {
  const answers = [];
  let total = 0;
  for (let w = 0; w < W; w++) {
    const n = counts.get(c * W + w) ?? 0;
    total += n;
    if (n) answers.push([w, n]);
  }
  if (total < MIN_ANSWERS) continue;

  const top = answers
    .map(([w, n]) => [w, Math.round((n / total) * 100)])
    .filter(([, percent]) => percent >= MIN_PERCENT)
    .sort((x, y) => y[1] - x[1])
    .slice(0, MAX_NAMES);
  if (top.length) bins[model.color.slice(c * 3, c * 3 + 3).join(",")] = top.flat();
}

const out = {
  source: "https://github.com/uwdata/c3 data/xkcd/c3_data.json",
  license: LICENSE,
  binSize: 5,
  terms: model.terms.map((term) => SPACED[term] ?? term),
  bins,
};
fs.writeFileSync("public/color-survey.json", JSON.stringify(out));
console.log(`${Object.keys(bins).length} bins, ${out.terms.length} names`);
