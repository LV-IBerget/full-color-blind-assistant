// Puts the clothing model and MediaPipe's runtime in public/, so the app serves them itself and never
// has to contact another site at runtime. These files are large and reproducible, so git ignores them.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite";
const MODEL_SHA256 = "c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0";
const MODEL_PATH = join(root, "public/models/selfie_multiclass_256x256.tflite");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function ensureModel() {
  try {
    if (sha256(await readFile(MODEL_PATH)) === MODEL_SHA256) return;
  } catch {
    // Not downloaded yet.
  }

  console.log("Downloading clothing model (16 MB)");
  const response = await fetch(MODEL_URL);
  if (!response.ok) throw new Error(`Model download returned HTTP ${response.status}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== MODEL_SHA256) throw new Error("Downloaded model does not match the expected hash");

  await mkdir(dirname(MODEL_PATH), { recursive: true });
  await writeFile(MODEL_PATH, bytes);
}

async function copyRuntime() {
  const from = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
  const to = join(root, "public/mediapipe");
  await mkdir(to, { recursive: true });
  for (const file of ["vision_wasm_internal.js", "vision_wasm_internal.wasm"]) {
    await copyFile(join(from, file), join(to, file));
  }
}

await Promise.all([ensureModel(), copyRuntime()]);
