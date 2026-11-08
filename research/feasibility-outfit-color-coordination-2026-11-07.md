# Feasibility: "do these colors coordinate?" from a photo, client-side, never negative

**Date:** 2026-11-07
**Question:** Is there a library that can tell from a photo whether colors or an outfit coordinate, without ever showing something that makes someone feel bad?
**Verdict:** Feasible with caveats. No library does this as a whole, and the outfit-scoring ones are the wrong tool. One library finds the clothing, and a small rule set handles the rest.
**Confidence:** Medium. The pipeline was run in a real browser on real photos, but only a few of them, none of a person with dark skin, and on no real camera or phone.

## Verdict

Clothing segmentation is solved by a maintained, permissively licensed model that runs in the browser. Judging coordination is not something to adopt: the scoring models produce a number that can be low, which is the thing the feature must never show, and they need product-style crops. So the app uses named relationships from color theory, reports only those it finds, and has no score at all. The largest open risk is that the model's accuracy drops on the darkest skin tones.

## Capability chain

| # | Stage | Input | Output | Used |
| --- | --- | --- | --- | --- |
| A | Find clothing | RGB photo, 256x256 | Per-pixel clothing confidence | MediaPipe multiclass selfie model |
| B | Extract colors | Masked pixels | 1 to 4 OKLab swatches | Own k-means, merging fabric shading |
| C | Find a relationship | Swatches | A named relationship, or nothing | Own rules on the painter's wheel |
| D | Report | Relationship or nothing | Kind wording, or "No results found" | Own copy, enforced by tests |

## Evidence

Tags: `[run]` observed by running it, `[code]` read in package source, `[claim]` stated by authors and not verified.

**Stage A: MediaPipe `selfie_multiclass_256x256`, through `@mediapipe/tasks-vision` 1.2.2**

- Apache-2.0, supports selfies and full body, classes are background, hair, body skin, face skin, clothes, accessories `[claim]` (Google's model card).
- Model hash matches the one published by the third-party ONNX conversion `[run]`.
- On a test portrait, 28% of the frame came back as confident clothing and the mask followed the suit, excluding face, hair and helmet `[run]`. On a photo of coffee, nothing passed the confidence bar `[run]`.
- The GPU delegate works in a browser, and the first analysis, including loading, took about 5 seconds on this machine `[run]`.
- **The library attempts to send usage logs to `odml.pa.googleapis.com/v1/log`** `[run]`. This was seen in the console when the content security policy blocked it. It is not mentioned in the documentation that was read.

**Stage C: color harmony research**

- Published harmony models predict apparel poorly: correlations of 0.50 for two colors and 0.65 for three for the best of them (Ou) `[claim]`.
- The exact Ou and Luo (2006) equations could not be retrieved and verified, so they were not used. Coefficients were not written from memory.

## Seam analysis

- **A to B: Adapter.** Threshold confidence at 0.8 and erode one pixel. Hours.
- **B to C: Clean, after a fix.** The first version named one orange suit "red and dark pink". Fabric shading has to be modeled: chroma divided by lightness stays near constant in shadow, and shadow is the smaller share of a garment. Clustering fragments have to be joined before this check runs.
- **C to D: Clean.** A relationship is a template. Nothing else reaches the interface.

## License and cost

| Component | License | Notes |
| --- | --- | --- |
| `@mediapipe/tasks-vision` and model | Apache-2.0 | Self-hosted, 31 MB, loaded only when a photo is first analyzed |
| OpenDyslexic Mono | SIL OFL | Carried over from the earlier app |

There are no runtime services and no per-use cost.

## Risks

1. **Lower accuracy on the darkest skin tones.** The 256px model scores mean IoU 68.25 on Monk tones 9 and 10 against 77.23 overall, from only 31 samples `[claim]`. Skin read as clothing could enter the palette, or the mask could come back empty. Mitigated by the 0.8 confidence bar and erosion. **Not tested. The feature should be tried with people across skin tones before relying on it.**
2. **"No results found" can still be read as a verdict over time.** Someone may learn that it often follows certain outfits. Sharing it across every failure case weakens that inference but cannot remove it. Hiding the colors in that result strengthens this, at the cost of showing less.
3. **False reassurance.** Color theory is permissive, so "these colors go together" is a weak claim about a real outfit, and pattern, lighting and camera white balance all affect it. Wording describes the relationship rather than praising the person.
4. **Few real-world photos tested.** Thresholds were tuned on one portrait and synthetic colors. Expect naming and merging thresholds to need adjusting on varied clothing and lighting. Example: dark flag blue in a film photo measured hue 293 against about 256 for the true color. Correcting white balance from the flag's own white stripe only moved it to 290 `[run]`, so a white reference cannot fix drift like this.
5. **Unverified on real cameras and phones.** The test browser blocks camera access, so the camera flow ran against a simulated stream.
6. **The telemetry block depends on the policy.** It applies only to built pages.

## Rejected and why

| Project | Why rejected |
| --- | --- |
| Outfit compatibility models: [fashion_compatibility_mcn](https://github.com/WangXin93/fashion_compatibility_mcn), [fashion-compatibility](https://github.com/mvasil/fashion-compatibility), [MM21-OCMCF](https://github.com/iLearn-Lab/MM21-OCMCF) | They output a score, which can be low. Trained on Polyvore outfit data. OCMCF is stated to be for academic research only. PyTorch checkpoints with no ONNX export found. |
| [FashionCLIP](https://huggingface.co/patrickjohncyh/fashion-clip) | MIT and has ONNX, but large for a browser download, and its similarity scores are not calibrated for this. |
| Hosted vision LLMs, such as outfit-rating apps | Photos would leave the device, and wording could not be guaranteed. |
| Ou and Luo harmony formula | Could not verify the equations, it is a score, and its correlation on apparel is modest. |
| Personal color analysis tools | They judge the person's coloring, which the feature must never do. |
| Unity Sentis | Worked on paper, but dropped along with Unity when the project moved to web technology only. |

## Sources

Verified by running or reading: [MediaPipe tasks-vision on npm](https://www.npmjs.com/package/@mediapipe/tasks-vision), [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf).

Read at metadata or abstract level only: [Performance of color-harmony models on apparel images](https://www.scientific.net/AMR.627.524), the rejected repositories above.
