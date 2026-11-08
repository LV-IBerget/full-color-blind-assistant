# Full Color Blind Assistant

A web app for people with full color blindness. Point a camera at something, or choose a photo, and it tells you about color in words and motion.

The image fills the screen, as in a camera app, and the controls float over it: hatching and the camera switch at the top, the color readout above a shutter row at the bottom. Holding a phone sideways moves the shutter row to the right edge.

- **Color names:** names the color under the reticle, in everyday clothing terms such as navy or beige. Tap or drag on the image, or use the arrow keys, to read any spot.
- **What else people call it:** for beige, white, gray and other neutrals, says which way the color leans ("Leans yellow"). It also lists what else people called that color in the xkcd survey, from the C3 color naming model ("Also called tan, cream"). Colors people disagree about, such as a pale yellow that most people call beige, show their alternatives instead of one confident word.
- **Relative color:** compares that color to its surroundings, or to a color you pin ("lighter, redder"). Both colors share the same light, so this holds up under lighting that throws off an absolute name.
- **White reference:** put the reticle on something you know is white or gray and choose Set white. Names, comparisons, hatching and coordination then correct for the color of the light. This fixes a tint over the whole scene, not errors that differ by color, such as dark blues drifting toward purple in old film. On a live camera it also locks the camera's own white balance where the browser allows it, because cameras rebalance as the view changes: point at a wall that fills the frame and the camera turns it nearly neutral.
- **Hue hatching:** a WebGL2 shader draws flowing lines over the image, with each hue flowing in its own direction and more saturated colors flowing faster. Grays get no lines. With all colors on, a key shows which direction means what.
- **Match hatching:** choose one color family, such as Red, and the lines show how closely every part of the image matches it rather than only exact matches. A line covers about as much of its gap as the match percentage: thick for a close match, thin for a partial one, none for no match. The readout gives the reticle's match as a percentage.
- **Color lookup:** takes the color at the reticle and offers its closest names, the app's own word first and then names from the color survey ("dark peach", "terracota"). Each links to Google Images for that name, filtered to Google's nearest color, to show what things in that color look like. Only the name is sent; the photo stays on the device. Find turns on match hatching for that color. You can also type a name from a label or shop listing, such as sage or mauve, or a hex code.
- **Do these colors go together?** Take or choose a photo to find a named color relationship in the clothing.

## The rule for color coordination

This feature must never make anyone feel bad about what they are wearing.

- There is no score, so nothing can fall short of one. The analysis only looks for relationships that color theory names, and reports them.
- Everything else gets the same words: "No results found". A photo with no clothes in it, a model failure, and colors with no named relationship are deliberately indistinguishable. That result carries no colors or reason, so the interface has nothing to say that could read as a verdict.
- Only clothing pixels are read. Skin, face and hair are never used for color and never mentioned.
- Tests in [tests/core.test.ts](tests/core.test.ts) hold all wording to a banned-word list, and sweep the color space to check every result that can appear.

To change the wording or add a relationship, edit `COPY` and `coordinate` in [src/core/outfitCoordination.ts](src/core/outfitCoordination.ts). Don't add a score or a negative result, even an internal one.

## Privacy

Photos stay on the device. Built pages carry a Content-Security-Policy that only allows connections to their own origin, so the browser itself blocks anything from sending a photo elsewhere. The policy also blocks MediaPipe's own usage logging to `odml.pa.googleapis.com`, which shows up as an expected error in the console. The dev server leaves the policy off, because hot reloading needs it off, so only the build has this protection.

## Running it

```bash
npm install
```

This also downloads the 16 MB clothing model, checks its hash, and copies the MediaPipe runtime into `public/`.

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

The camera needs HTTPS or localhost. `dist/` works from any static host and any folder.

## How it fits together

| Path | What it does |
| --- | --- |
| [src/core/](src/core/) | Color science, naming, matching, lookup and coordination rules. No browser APIs, fully tested. |
| [src/hueHatch.ts](src/hueHatch.ts) | The hatching shader. |
| [src/clothingSegmenter.ts](src/clothingSegmenter.ts) | Finds clothing with MediaPipe. Loads only when a photo is first analyzed. |
| [src/main.ts](src/main.ts) | Camera, photos and interface. |
| [research/](research/) | Why the coordination feature is built this way. |

## Credits

- Clothing segmentation: [MediaPipe multiclass selfie model](https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter#multiclass-model), Apache-2.0, by Google.
- Color space: [OKLab](https://bottosson.github.io/posts/oklab/) by Björn Ottosson.
- Color names for lookup: the [xkcd color survey](https://xkcd.com/color/rgb.txt), CC0.
- What people call colors: the [C3 color naming model](https://github.com/uwdata/c3) by Jeffrey Heer and Maureen Stone, built on the xkcd survey. BSD-3-Clause, Copyright (c) 2011 Stanford University; the notice travels in `public/color-survey.json`, which `scripts/build-color-survey.mjs` makes from C3's `data/xkcd/c3_data.json`.
- Font: OpenDyslexic Mono by Abbie Gonzalez, SIL Open Font License.
