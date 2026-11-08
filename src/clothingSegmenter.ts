import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import { CLOTHES_CLASS } from "./core/clothingMask";

const BASE = import.meta.env.BASE_URL;
const MODEL_PATH = `${BASE}models/selfie_multiclass_256x256.tflite`;
const RUNTIME_PATH = `${BASE}mediapipe`;

export interface ClothingConfidence {
  values: Float32Array;
  width: number;
  height: number;
}

let segmenter: Promise<ImageSegmenter> | null = null;

/**
 * The runtime and model total 31 MB, so they load the first time someone analyzes a photo rather
 * than with the app. People who only use the live camera never download them.
 */
function loadSegmenter(): Promise<ImageSegmenter> {
  segmenter ??= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(RUNTIME_PATH);

    const create = (delegate: "GPU" | "CPU") =>
      ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate },
        runningMode: "IMAGE",
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });

    return create("GPU").catch((reason) => {
      console.warn("Clothing model is using the CPU:", reason);
      return create("CPU");
    });
  })();

  // Let the next photo try again rather than remembering a failed download forever.
  segmenter.catch(() => {
    segmenter = null;
  });

  return segmenter;
}

/** Scores each pixel as clothing, on this device. Returns null when no reading is available. */
export async function segmentClothing(image: HTMLCanvasElement): Promise<ClothingConfidence | null> {
  const model = await loadSegmenter();

  let confidence: ClothingConfidence | null = null;
  model.segment(image, (result) => {
    // Masks are only valid inside this callback, so copy the values out.
    const mask = result.confidenceMasks?.[CLOTHES_CLASS];
    if (mask) confidence = { values: mask.getAsFloat32Array().slice(), width: mask.width, height: mask.height };
  });
  return confidence;
}
