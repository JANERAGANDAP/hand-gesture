// src/utils/imageSampleExtractor.ts
// Purpose: turn one still image into the same landmark features the live
// camera produces, so an uploaded photo can be saved as a "static" reference
// sample. Mirrors the video-import path in AdminSignRecorder, but for a
// single frame (no seeking, no motion).
import { extractFeatures, type GestureFeatures } from "./featureExtractor";
import { HAND_CROP_SIZE, type PixelBoundingBox } from "./handCrop";

interface Landmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

interface HolisticResults {
  poseLandmarks?: Landmark[];
  leftHandLandmarks?: Landmark[];
  rightHandLandmarks?: Landmark[];
  faceLandmarks?: Landmark[];
}

// The slice of the MediaPipe Holistic API (loaded from a CDN <script>) used here.
interface HolisticInstance {
  setOptions(options: Record<string, unknown>): void;
  onResults(callback: (results: HolisticResults) => void): void;
  send(input: { image: HTMLImageElement }): Promise<void>;
  close?: () => void;
}

declare const Holistic: new (config: {
  locateFile: (fileName: string) => string;
}) => HolisticInstance;

const MEDIAPIPE_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1675471629/";
// MediaPipe's tracker refines its hand region from the previous frame, so a
// first pass on a cold start can miss a hand that a second pass finds.
const MAX_DETECTION_PASSES = 3;
const FRAME_SETTLE_ATTEMPTS = 5;
const CROP_JPEG_QUALITY = 0.85;

export interface ImageExtraction {
  features: GestureFeatures;
  leftHand: Landmark[] | undefined;
  rightHand: Landmark[] | undefined;
}

// Reads an image File into a decoded <img>. The caller must revoke
// image.src (an object URL) when finished to free memory.
export async function loadImageFile(file: File): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = URL.createObjectURL(file);
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(image.src);
    throw new Error("Couldn't read this image file");
  }
  return image;
}

// True when MediaPipe returned at least one hand's landmarks.
function hasAnyHand(results: HolisticResults | null): boolean {
  return (
    (results?.leftHandLandmarks?.length ?? 0) > 0 ||
    (results?.rightHandLandmarks?.length ?? 0) > 0
  );
}

// Picks the hand with more landmarks (right wins ties), the same rule the
// recorder uses for its hand-shape crop.
export function pickDominantHandLandmarks(
  leftHand: Landmark[] | null | undefined,
  rightHand: Landmark[] | null | undefined,
): Landmark[] | undefined {
  const leftCount = leftHand?.length ?? 0;
  const rightCount = rightHand?.length ?? 0;
  const dominant = rightCount >= leftCount ? rightHand : leftHand;
  return dominant ?? undefined;
}

// Runs MediaPipe Holistic on one image and returns its feature object, or
// null when no hand (or no usable features) was found.
export async function extractFeaturesFromImage(
  image: HTMLImageElement,
): Promise<ImageExtraction | null> {
  if (typeof Holistic === "undefined") {
    throw new Error("MediaPipe Holistic is not loaded yet");
  }
  const holistic = new Holistic({
    locateFile: (fileName: string) =>
      `${MEDIAPIPE_CDN}${fileName.replace(/^\/+/, "")}`,
  });
  // Not real-time, so favor accuracy: full-complexity model, and no
  // temporal smoothing (there is no previous frame to smooth against).
  holistic.setOptions({
    modelComplexity: 1,
    smoothLandmarks: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  let latestResults: HolisticResults | null = null;
  // A function (not a direct read) so TypeScript doesn't assume the value
  // stays null after the loop resets it; onResults assigns it asynchronously.
  const readLatestResults = () => latestResults;
  holistic.onResults((results) => {
    latestResults = results;
  });
  try {
    for (let pass = 0; pass < MAX_DETECTION_PASSES; pass++) {
      latestResults = null;
      await holistic.send({ image });
      // onResults can fire a tick after send() resolves in some builds.
      for (
        let wait = 0;
        wait < FRAME_SETTLE_ATTEMPTS && !latestResults;
        wait++
      ) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      if (hasAnyHand(readLatestResults())) break;
    }
    const results = readLatestResults();
    if (!results || !hasAnyHand(results)) return null;
    const features = extractFeatures(
      results.poseLandmarks,
      results.leftHandLandmarks,
      results.rightHandLandmarks,
      results.faceLandmarks || [],
    );
    if (!features) return null;
    return {
      features,
      leftHand: results.leftHandLandmarks,
      rightHand: results.rightHandLandmarks,
    };
  } finally {
    holistic.close?.();
  }
}

// Crops the hand region out of the image as a square JPEG, the same size and
// quality as the live hand-shape crop, for the admin reference thumbnail.
export function cropImageToBlob(
  image: HTMLImageElement,
  box: PixelBoundingBox,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = HAND_CROP_SIZE;
      canvas.height = HAND_CROP_SIZE;
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(null);
        return;
      }
      context.drawImage(
        image,
        box.x,
        box.y,
        box.width,
        box.height,
        0,
        0,
        HAND_CROP_SIZE,
        HAND_CROP_SIZE,
      );
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", CROP_JPEG_QUALITY);
    } catch (err) {
      console.error("Image hand-crop failed:", err);
      resolve(null);
    }
  });
}