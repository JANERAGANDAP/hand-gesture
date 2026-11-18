// src/utils/holisticLoader.ts
// Load the legacy Holistic runtime only on admin recording pages. Loading it
// globally alongside tasks-vision can replace Emscripten runtime settings.

export const MEDIAPIPE_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1675471629/";

declare global {
  interface Window {
    Holistic?: new (config: {
      locateFile: (fileName: string) => string;
    }) => any;
  }
}

let scriptPromise: Promise<void> | null = null;

export function loadHolisticScript(): Promise<void> {
  if (typeof window.Holistic !== "undefined") return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${MEDIAPIPE_CDN}holistic.js`;
    script.async = true;
    script.onload = () => {
      if (typeof window.Holistic === "undefined") {
        scriptPromise = null;
        reject(new Error("MediaPipe Holistic script loaded without its API"));
        return;
      }
      resolve();
    };
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Failed to load the MediaPipe Holistic script"));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

// Cached so every caller waits on the same single load.
let holisticPromise: Promise<any> | null = null;

export function loadHolistic(): Promise<any> {
  if (holisticPromise) return holisticPromise;

  holisticPromise = (async () => {
    await loadHolisticScript();
    const Holistic = window.Holistic;
    if (!Holistic) throw new Error("MediaPipe Holistic is unavailable");
    const instance = new Holistic({
      locateFile: (file: string) =>
        `${MEDIAPIPE_CDN}${file.replace(/^\/+/, "")}`,
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