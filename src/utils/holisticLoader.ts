// src/utils/holisticLoader.ts
// Loads and initializes the MediaPipe Holistic model once and shares it.
// Why: the first Holistic call downloads and compiles several MB of WASM
// and model files. Doing it up front (and only once) removes the delay
// before the first gesture is detected and avoids reloading it each time
// the camera restarts.
declare const Holistic: any;

const MEDIAPIPE_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/holistic/";

// Cached so every caller waits on the same single load.
let holisticPromise: Promise<any> | null = null;

export function loadHolistic(): Promise<any> {
  if (holisticPromise) return holisticPromise;

  holisticPromise = (async () => {
    if (typeof Holistic === "undefined") {
      throw new Error("MediaPipe Holistic script is not loaded");
    }
    const instance = new Holistic({
      locateFile: (file: string) => `${MEDIAPIPE_CDN}${file}`,
    });
    instance.setOptions({
      modelComplexity: 0,
      smoothLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    // Forces the model download/compile now instead of on the first frame.
    await instance.initialize();
    return instance;
  })();

  // On failure, forget the cached promise so a Retry can load again.
  holisticPromise.catch(() => {
    holisticPromise = null;
  });

  return holisticPromise;
}