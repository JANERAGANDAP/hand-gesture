// src/utils/handCrop.ts
//
// Phase 1 of CNN integration: computes a bounding box around whichever
// hand is visible in a MediaPipe Holistic frame, then crops that region
// out of the live video element into a small square JPEG. These crops are
// what the CNN hand-shape classifier will eventually train on — see
// AdminSignRecorder.tsx for where this gets called during recording.

interface NormalizedPoint {
  x: number;
  y: number;
}

export interface PixelBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Padding around the tight landmark bounding box, as a fraction of the
// box's own size. Hand landmarks sit exactly on knuckles/fingertips, so a
// tight crop clips the palm edge and any wrist context — padding keeps the
// full hand shape (and a little wrist) in frame, which matters for a CNN
// that will see hand *shape*, not just landmark points.
const BOX_PADDING_RATIO = 0.35;

// Output crop is fixed-size and square so every training image feeds the
// CNN at the same resolution MobileNetV2/EfficientNet expect (224x224 is
// the standard ImageNet input size these transfer-learning bases use).
export const HAND_CROP_SIZE = 224;

/**
 * Computes a padded, square, pixel-space bounding box around a set of
 * normalized (0..1) hand landmarks, clamped to the video frame.
 *
 * Returns null if there aren't enough landmarks to form a meaningful box
 * (e.g. hand not fully in frame) — callers should skip capture that frame
 * rather than save a degenerate crop.
 */
export function computeHandBoundingBox(
  landmarks: NormalizedPoint[] | undefined | null,
  videoWidth: number,
  videoHeight: number,
  paddingRatio: number = BOX_PADDING_RATIO,
): PixelBoundingBox | null {
  if (!landmarks || landmarks.length < 5 || !videoWidth || !videoHeight) {
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of landmarks) {
    if (typeof point.x !== "number" || typeof point.y !== "number") continue;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;

  // Normalized -> pixel space.
  const pxMinX = minX * videoWidth;
  const pxMinY = minY * videoHeight;
  const pxMaxX = maxX * videoWidth;
  const pxMaxY = maxY * videoHeight;

  const rawWidth = pxMaxX - pxMinX;
  const rawHeight = pxMaxY - pxMinY;
  if (rawWidth <= 0 || rawHeight <= 0) return null;

  // Pad, then square the box (use the larger dimension for both sides) so
  // the crop isn't stretched when resized to HAND_CROP_SIZE x HAND_CROP_SIZE.
  const paddedWidth = rawWidth * (1 + paddingRatio * 2);
  const paddedHeight = rawHeight * (1 + paddingRatio * 2);
  const side = Math.max(paddedWidth, paddedHeight);

  const centerX = (pxMinX + pxMaxX) / 2;
  const centerY = (pxMinY + pxMaxY) / 2;

  let x = centerX - side / 2;
  let y = centerY - side / 2;

  // Clamp into the frame rather than letting the crop run off-canvas.
  x = Math.max(0, Math.min(x, videoWidth - side));
  y = Math.max(0, Math.min(y, videoHeight - side));
  const clampedSide = Math.min(side, videoWidth, videoHeight);

  return {
    x,
    y,
    width: clampedSide,
    height: clampedSide,
  };
}

/**
 * Crops the given region out of a live <video> element and returns it as a
 * JPEG Blob, resized to HAND_CROP_SIZE x HAND_CROP_SIZE.
 *
 * Crops directly from the video element (not the mirrored on-screen
 * canvas/CSS) — MediaPipe Camera runs with selfieMode: true, so landmark
 * coordinates already correspond to the video element's raw pixel buffer.
 * Cropping from `video` keeps the same coordinate space as the landmarks
 * used to compute the bounding box; the CSS mirror is a display-only
 * transform and doesn't affect this buffer.
 */
export function captureHandCropBlob(
  video: HTMLVideoElement,
  box: PixelBoundingBox,
  quality: number = 0.85,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = HAND_CROP_SIZE;
      canvas.height = HAND_CROP_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(
        video,
        box.x,
        box.y,
        box.width,
        box.height,
        0,
        0,
        HAND_CROP_SIZE,
        HAND_CROP_SIZE,
      );
      canvas.toBlob(
        (blob) => resolve(blob),
        "image/jpeg",
        quality,
      );
    } catch (err) {
      console.error("Hand-crop capture failed:", err);
      resolve(null);
    }
  });
}

/**
 * Converts a Blob (e.g. from captureHandCropBlob) into a base64 data URL
 * string, suitable for sending as JSON to the backend's `handCropImage`
 * field. Used by the live recognition path in VideoViewport.tsx, which
 * can't send a raw Blob over the same JSON POST as `features`/`sequence`.
 * decodeBase64Image() on the server already strips the "data:...;base64,"
 * prefix, so either form works — sending the full data URL here so the
 * payload is self-describing.
 */
export function blobToBase64(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    } catch (err) {
      console.error("Hand-crop base64 conversion failed:", err);
      resolve(null);
    }
  });
}
