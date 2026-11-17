// src/lib/handShapeCNN.ts
//
// Phase 5 of the CNN roadmap: loads the TFJS graph model that
// ml-training/convert_to_tfjs.py (Phase 4) writes to
// models/hand-shape-cnn/{model.json,*.bin,label_map.json}, and scores a
// single hand-crop image against it.
//
// Scope reminder (Phase 2 decision): this only ever runs for words tagged
// gestureType: "static" — recognition.routes.ts is responsible for that
// gating, this module just answers "what does the CNN think of this crop".
//
// Model input contract (must match ml-training/train.py exactly):
//   - 224x224x3, RGB, float32, RAW 0-255 range.
//   - Do NOT rescale/normalize here — train.py bakes
//     mobilenet_v2.preprocess_input into the graph itself, so normalizing
//     again on this side would double-apply it and silently wreck accuracy.
//
// Startup behavior: Phase 3/4 may not have been run yet (no model on disk),
// or @tensorflow/tfjs-node's native binding may fail to load on a given
// host. Either case must NOT crash the server or block recognition —
// the DTW/frame path in recognition.routes.ts has to keep working with the
// CNN branch simply absent. Load is therefore lazy + memoized + failure is
// cached (we don't retry a broken load on every request).

import fs from "fs";
import path from "path";

// Typed as `any` deliberately: @tensorflow/tfjs-node is an optional runtime
// dependency (native binding, only needed once Phase 3/4 have actually
// produced a model). Importing it eagerly at module load time would crash
// `npm run dev` on any machine where the native build fails, so it's
// required lazily inside loadModel() instead — see the try/catch there.
let tf: any = null;

const MODEL_DIR = path.join(__dirname, "..", "..", "models", "hand-shape-cnn");
const MODEL_JSON_PATH = path.join(MODEL_DIR, "model.json");
const LABEL_MAP_PATH = path.join(MODEL_DIR, "label_map.json");

const IMG_SIZE = 224;

export interface HandShapeScore {
  word: string;
  confidence: number; // 0-1 softmax probability
}

type LoadState =
  | { status: "unloaded" }
  | { status: "ready"; model: any; labelMap: Record<string, string> }
  | { status: "unavailable"; reason: string };

let loadState: LoadState = { status: "unloaded" };
let loadPromise: Promise<LoadState> | null = null;

// Loads (once) and caches the model + label map. Safe to call on every
// request — after the first call this just returns the memoized result,
// including memoized failure, so a missing/broken model doesn't retry a
// filesystem+native-binding load on every recognition request.
async function loadModel(): Promise<LoadState> {
  if (loadState.status !== "unloaded") return loadState;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    if (!fs.existsSync(MODEL_JSON_PATH) || !fs.existsSync(LABEL_MAP_PATH)) {
      const reason =
        "Hand-shape CNN model not found at " +
        `${MODEL_DIR} — run ml-training/train.py then convert_to_tfjs.py ` +
        "(Phases 3-4) to produce it. Static-word recognition will fall " +
        "back to DTW/frame scoring only until then.";
      console.warn(`[handShapeCNN] ${reason}`);
      loadState = { status: "unavailable", reason };
      return loadState;
    }

    try {
      // Lazy require: keeps the native tfjs-node binding out of the
      // startup path entirely when no one is using the CNN branch.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      tf = require("@tensorflow/tfjs-node");
    } catch (err) {
      const reason =
        "@tensorflow/tfjs-node failed to load (native binding issue?) — " +
        `${err instanceof Error ? err.message : String(err)}`;
      console.error(`[handShapeCNN] ${reason}`);
      loadState = { status: "unavailable", reason };
      return loadState;
    }

    try {
      const graphModel = await tf.loadGraphModel(
        `file://${MODEL_JSON_PATH}`,
      );
      const labelMap: Record<string, string> = JSON.parse(
        fs.readFileSync(LABEL_MAP_PATH, "utf-8"),
      );
      console.log(
        `[handShapeCNN] Loaded hand-shape CNN (${Object.keys(labelMap).length} classes) from ${MODEL_DIR}`,
      );
      loadState = { status: "ready", model: graphModel, labelMap };
      return loadState;
    } catch (err) {
      const reason = `Failed to load hand-shape CNN graph model: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[handShapeCNN] ${reason}`);
      loadState = { status: "unavailable", reason };
      return loadState;
    }
  })();

  return loadPromise;
}

// True once a model has successfully loaded (or attempted to and failed) —
// callers don't need this directly, classifyHandShape() already
// short-circuits, but it's useful for a /health-style readiness check.
export async function isHandShapeCNNReady(): Promise<boolean> {
  const state = await loadModel();
  return state.status === "ready";
}

// Accepts either a raw base64 string or a data URL ("data:image/jpeg;base64,...")
// — the client-side capture code sends whichever is more convenient; both
// are handled here so recognition.routes.ts doesn't need to care.
function decodeBase64Image(input: string): Buffer {
  const commaIdx = input.indexOf(",");
  const raw = input.startsWith("data:") && commaIdx !== -1
    ? input.slice(commaIdx + 1)
    : input;
  return Buffer.from(raw, "base64");
}

// Scores one hand-crop image against every class the CNN knows. Returns
// null (never throws to the caller) whenever the CNN branch isn't usable
// for this request — missing model, bad image data, anything — so
// recognition.routes.ts can treat "no CNN opinion" as a normal, common case
// rather than an error path.
export async function classifyHandShape(
  imageBase64: string,
): Promise<HandShapeScore[] | null> {
  const state = await loadModel();
  if (state.status !== "ready") return null;

  let imageBuffer: Buffer;
  try {
    imageBuffer = decodeBase64Image(imageBase64);
    if (imageBuffer.length === 0) return null;
  } catch {
    return null;
  }

  return runInference(state, imageBuffer);
}

async function runInference(
  state: Extract<LoadState, { status: "ready" }>,
  imageBuffer: Buffer,
): Promise<HandShapeScore[] | null> {
  let decoded: any;
  let resized: any;
  let batched: any;
  let output: any;
  try {
    decoded = tf.node.decodeImage(imageBuffer, 3); // RGB, uint8 HxWx3
    resized = tf.image.resizeBilinear(decoded, [IMG_SIZE, IMG_SIZE]);
    // Cast to float32 but deliberately do NOT divide by 255 — see the
    // module-level comment: preprocess_input is baked into the graph and
    // expects raw 0-255 values.
    const floatImg = resized.toFloat();
    batched = floatImg.expandDims(0);
    floatImg.dispose();

    const result = state.model.predict(batched);
    output = Array.isArray(result) ? result[0] : result;
    const probs: Float32Array | Int32Array | Uint8Array = await output.data();

    const scores: HandShapeScore[] = [];
    for (let i = 0; i < probs.length; i++) {
      const word = state.labelMap[String(i)];
      if (word) scores.push({ word, confidence: probs[i] });
    }
    scores.sort((a, b) => b.confidence - a.confidence);
    return scores;
  } catch (err) {
    console.error(
      `[handShapeCNN] Inference failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  } finally {
    // Manual disposal (not tf.tidy) because inference is async and tidy()
    // can't span an await — this is the standard tfjs-node pattern for
    // predict()-then-data(). Leaving any of these undisposed is a real
    // memory leak on a long-running server, so every branch above that
    // creates a tensor must be freed here regardless of success/failure.
    decoded?.dispose();
    resized?.dispose();
    batched?.dispose();
    if (Array.isArray(output)) output.forEach((o: any) => o?.dispose());
    else output?.dispose();
  }
}

// Convenience lookup used by the fusion logic in recognition.routes.ts:
// pulls one word's confidence out of a full classifyHandShape() result,
// applying the "too low to count" floor from RECOGNITION_CONFIG so callers
// don't have to repeat that check at every call site.
export function confidenceForWord(
  scores: HandShapeScore[],
  word: string,
  minUsableConfidence: number,
): number | null {
  const match = scores.find((s) => s.word === word);
  if (!match || match.confidence < minUsableConfidence) return null;
  return match.confidence;
}