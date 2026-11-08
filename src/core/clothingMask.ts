/**
 * Turns the segmentation model's clothing confidence into a mask of pixels that are confidently clothing.
 * The model's other classes, skin and face included, are never read for color and never reported.
 * The feature describes clothes, not the person wearing them.
 */

/** Position of the clothes class in the model's output: background, hair, body skin, face skin, clothes, accessories. */
export const CLOTHES_CLASS = 4;

// The model's published accuracy is lowest on the darkest skin tones (mean IoU 68.25 against 77.23
// overall). A high bar and an eroded edge keep uncertain pixels, such as skin at the edge of a sleeve,
// out of the palette.
const MIN_CONFIDENCE = 0.8;

/** @returns the mask, or null if the input is the wrong size. */
export function clothingMask(confidence: ArrayLike<number> | null, width: number, height: number): boolean[] | null {
  if (!confidence || confidence.length !== width * height) return null;

  const mask = new Array<boolean>(confidence.length).fill(false);

  // Erode by one pixel: a pixel only counts if its four neighbors are clothing too.
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      mask[i] =
        confidence[i] >= MIN_CONFIDENCE &&
        confidence[i - 1] >= MIN_CONFIDENCE &&
        confidence[i + 1] >= MIN_CONFIDENCE &&
        confidence[i - width] >= MIN_CONFIDENCE &&
        confidence[i + width] >= MIN_CONFIDENCE;
    }
  }
  return mask;
}
