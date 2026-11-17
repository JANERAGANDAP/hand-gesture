// src/utils/yoloHandDetector.ts
//
// Optional enhancement to hand-crop quality (see handCrop.ts): detects a
// hand bounding box directly from pixels via a YOLO object-detection model,
// instead of deriving the box from MediaPipe Holistic's 21-point hand
// skeleton. Landmark-derived boxes are only as good as those 21 points,
// which get noisy under partial occlusion, motion blur, or awkward
// angles — a box regressed directly from the image tends to be more
// stable in exactly those cases, which matters because this box is what
// gets cropped into the hand-shape reference thumbnail shown to
// admins/teachers (see AdminSigns.tsx). The static-word CNN classifier
// this crop used to also feed (handShapeCNN.ts) has since been retired
// in favor of frameScore/landmark-distance matching.
//
// This is additive, not a replacement: Holistic's landmarks are still
// required for DTW motion tracking and skeleton drawing, and remain the
// fallback here whenever YOLO is unavailable or unconfident. See
// resolveHandBox() below, which is what callers should actually use.
//
// Model contract: a TFJS *graph* model (ultralytics `format=tfjs` export
// of a YOLOv8n/YOLO11n model fine-tuned for single-class "hand" detection),
// served from YOLO_HAND_DETECTOR_CONFIG.MODEL_URL. Output is expected in
// the standard ultralytics export shape [1, 4+numClasses, numAnchors]
// (or the transposed [1, numAnchors, 4+numClasses] — both are handled,
// see parseYoloOutput()), box coords in the model's own input pixel space
// (typically 640x640), objectness/class score already sigmoid-applied by
// the export itself (ultralytics bakes that in).
//
// No model is bundled with this repo — weights are produced locally and
// are not committed. See yolo-training/README.md for how to train + convert
// one.
// Until that model exists at MODEL_URL, every call here fails closed
// (cached, doesn't retry every frame) and resolveHandBox() silently falls
// back to the landmark-based box — recognition keeps working exactly as
// it did before this file existed.

import {
  computeHandBoundingBox,
  computeHandBoundingBoxFromDetection,
  type PixelBoundingBox,
} from "./handCrop";
import { YOLO_HAND_DETECTOR_CONFIG } from "../config/recognitionConfig";

// Typed `any` deliberately: @tensorflow/tfjs pulls in a WebGL backend and
// is only worth the bundle weight once someone is actually using the YOLO
// branch. Imported lazily inside loadModel().
let tf: any = null;

interface NormalizedPoint {
  x: number;
  y: number;
}

type LoadState =
  | { status: "unloaded" }
  | { status: "ready"; model: any }
  | { status: "unavailable"; reason: string };

let loadState: LoadState = { status: "unloaded" };
let loadPromise: Promise<LoadState> | null = null;

/**
 * Loads (once) and caches the YOLO graph model. Safe to call on every
 * detection — after the first call this just returns the memoized result,
 * including a memoized failure, so a missing/broken model doesn't retry a
 * network fetch on every recognition frame.
 */
async function loadModel(): Promise<LoadState> {
  if (loadState.status !== "unloaded") return loadState;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      // Lazy import: keeps @tensorflow/tfjs out of the initial bundle/
      // startup path entirely when the YOLO branch is disabled or unused.
      tf = await import("@tensorflow/tfjs");
    } catch (err) {
      const reason = `@tensorflow/tfjs failed to load: ${
        err instanceof Error ? err.message : String(err)
      }`;
      console.warn(`[yoloHandDetector] ${reason}`);
      loadState = { status: "unavailable", reason };
      return loadState;
    }

    try {
      const model = await tf.loadGraphModel(
        YOLO_HAND_DETECTOR_CONFIG.MODEL_URL,
      );
      loadState = { status: "ready", model };
      return loadState;
    } catch (err) {
      // Expected/common case until yolo-training's conversion step has
      // actually been run — not an error worth alarming over, mirrors
      // handShapeCNN.ts's "not found yet" framing.
      const reason =
        `YOLO hand-detection model not found at ` +
        `${YOLO_HAND_DETECTOR_CONFIG.MODEL_URL} — run yolo-training/ ` +
        `(train + export) to produce it, or place a converted model there. ` +
        `Hand cropping will fall back to landmark-derived boxes only.`;
      console.warn(`[yoloHandDetector] ${reason}`);
      loadState = { status: "unavailable", reason };
      return loadState;
    }
  })();

  return loadPromise;
}

/**
 * Kicks off model loading without waiting on it — call this once at app/
 * component mount (e.g. alongside Holistic init) so the first real
 * detection isn't stalled behind a cold model fetch. Safe to call more
 * than once; loadModel() is memoized.
 */
export function preloadYoloHandDetector(): void {
  void loadModel();
}

interface RawDetection {
  // Pixel-space box in the model's own INPUT_SIZE x INPUT_SIZE frame
  // (before letterbox-undo), center-form.
  cx: number;
  cy: number;
  w: number;
  h: number;
  score: number;
}

/**
 * Parses a YOLO graph-model output tensor into raw detections above
 * SCORE_THRESHOLD. Handles both [1, 4+nc, numAnchors] and the transposed
 * [1, numAnchors, 4+nc] layouts — different export settings/ultralytics
 * versions produce either, so this checks which axis is the small one
 * (4+nc, i.e. 5 for a single "hand" class) rather than assuming.
 */
function parseYoloOutput(
  output: any,
  numClasses: number,
  scoreThreshold: number,
): RawDetection[] {
  const shape: number[] = output.shape;
  if (shape.length !== 3 || shape[0] !== 1) {
    console.warn(
      `[yoloHandDetector] unexpected output rank/batch: ${JSON.stringify(shape)}`,
    );
    return [];
  }

  const attrCount = 4 + numClasses;
  let data: Float32Array;
  let numAnchors: number;

  if (shape[1] === attrCount) {
    // [1, 4+nc, numAnchors] — transpose to [numAnchors, 4+nc] for easy
    // per-anchor iteration.
    numAnchors = shape[2];
    const transposed = tf.transpose(output, [0, 2, 1]);
    data = transposed.dataSync();
    transposed.dispose();
  } else if (shape[2] === attrCount) {
    // Already [1, numAnchors, 4+nc].
    numAnchors = shape[1];
    data = output.dataSync();
  } else {
    console.warn(
      `[yoloHandDetector] output shape ${JSON.stringify(shape)} doesn't ` +
        `match expected 4+${numClasses}=${attrCount} attribute count on ` +
        `either axis — model may not be a single-class hand detector, or ` +
        `export format has changed.`,
    );
    return [];
  }

  const detections: RawDetection[] = [];
  for (let i = 0; i < numAnchors; i++) {
    const base = i * attrCount;
    // Class scores start at offset 4; for a single-class model this is
    // just index 4, but max-over-classes keeps this correct if someone
    // trains a multi-class variant (e.g. left-hand/right-hand) later.
    let bestScore = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const s = data[base + 4 + c];
      if (s > bestScore) bestScore = s;
    }
    if (bestScore < scoreThreshold) continue;
    detections.push({
      cx: data[base],
      cy: data[base + 1],
      w: data[base + 2],
      h: data[base + 3],
      score: bestScore,
    });
  }
  return detections;
}

/**
 * Runs the YOLO hand detector on the current video frame and returns the
 * single highest-confidence hand box in *video pixel space*, or null if
 * the model isn't available/loaded, or no detection cleared
 * SCORE_THRESHOLD.
 *
 * This never throws — every failure mode (model missing, inference error,
 * no detections) resolves to null so callers can fall back to the
 * landmark-based box without special-casing errors.
 */
export async function detectHandBoxYolo(
  video: HTMLVideoElement,
): Promise<PixelBoundingBox | null> {
  const state = await loadModel();
  if (state.status !== "ready") return null;

  const { INPUT_SIZE, SCORE_THRESHOLD, IOU_THRESHOLD, NUM_CLASSES } =
    YOLO_HAND_DETECTOR_CONFIG;
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  if (!videoWidth || !videoHeight) return null;

  // Letterbox: scale to fit INPUT_SIZE x INPUT_SIZE preserving aspect
  // ratio, pad the rest. Needed to undo the same transform when mapping
  // detected boxes back to original video pixel coordinates.
  const scale = Math.min(INPUT_SIZE / videoWidth, INPUT_SIZE / videoHeight);
  const scaledW = Math.round(videoWidth * scale);
  const scaledH = Math.round(videoHeight * scale);
  const padX = (INPUT_SIZE - scaledW) / 2;
  const padY = (INPUT_SIZE - scaledH) / 2;

  let inputTensor: any = null;
  let output: any = null;
  try {
    inputTensor = tf.tidy(() => {
      const frame = tf.browser.fromPixels(video);
      const resized = tf.image.resizeBilinear(frame, [scaledH, scaledW]);
      const normalized = resized.div(255.0);
      const padded = normalized.pad([
        [Math.floor(padY), Math.ceil(padY)],
        [Math.floor(padX), Math.ceil(padX)],
        [0, 0],
      ]);
      return padded.expandDims(0);
    });

    output = await (state.model as any).executeAsync(inputTensor);
    // Some exports return an array of output tensors; take the first.
    const outputTensor = Array.isArray(output) ? output[0] : output;

    const detections = parseYoloOutput(
      outputTensor,
      NUM_CLASSES,
      SCORE_THRESHOLD,
    );
    if (detections.length === 0) return null;

    // NMS to collapse overlapping boxes, then take the single most
    // confident survivor — this pipeline only ever wants one hand box.
    const boxesForNms = detections.map((d) => [
      d.cy - d.h / 2,
      d.cx - d.w / 2,
      d.cy + d.h / 2,
      d.cx + d.w / 2,
    ]);
    const scoresForNms = detections.map((d) => d.score);
    const keepIndices = await tf.image.nonMaxSuppressionAsync(
      boxesForNms,
      scoresForNms,
      1, // maxOutputSize — only need the top box
      IOU_THRESHOLD,
      SCORE_THRESHOLD,
    );
    const keepArr: number[] = await keepIndices.array();
    keepIndices.dispose();
    if (keepArr.length === 0) return null;

    const best = detections[keepArr[0]];

    // Undo letterbox: model-input-space -> original video pixel space.
    const rawX = (best.cx - best.w / 2 - padX) / scale;
    const rawY = (best.cy - best.h / 2 - padY) / scale;
    const rawW = best.w / scale;
    const rawH = best.h / scale;

    return computeHandBoundingBoxFromDetection(
      { x: rawX, y: rawY, width: rawW, height: rawH },
      videoWidth,
      videoHeight,
    );
  } catch (err) {
    console.warn("[yoloHandDetector] inference failed:", err);
    return null;
  } finally {
    inputTensor?.dispose?.();
    if (Array.isArray(output)) {
      output.forEach((t) => t?.dispose?.());
    } else {
      output?.dispose?.();
    }
  }
}

/**
 * The function callers should actually use. Tries the YOLO detector first
 * (better box quality when available); falls back to the existing
 * landmark-derived box — same as before this file existed — whenever YOLO
 * is unavailable, unconfident, or errors. Never throws, never blocks
 * longer than a single inference call.
 */
export async function resolveHandBox(
  video: HTMLVideoElement,
  handLandmarks: NormalizedPoint[] | undefined | null,
): Promise<PixelBoundingBox | null> {
  if (YOLO_HAND_DETECTOR_CONFIG.ENABLED) {
    const yoloBox = await detectHandBoxYolo(video);
    if (yoloBox) return yoloBox;
  }
  return computeHandBoundingBox(handLandmarks, video.videoWidth, video.videoHeight);
}
