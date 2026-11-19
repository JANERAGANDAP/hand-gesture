// src/services/recognitionApi.ts
import { apiClient } from "./api";
export interface RecognitionAlternative {
  word: string;
  confidence: number;
}
export interface RecognitionResult {
  recognized: boolean;
  word: string | null;
  confidence: number;
  score: number;
  prediction?: string[];
  alternatives?: RecognitionAlternative[];
  warning?: string;
  processingTime?: number;
  trainingWord?: string | null;
  samplesNeeded?: number | null;
  // Phase 6: why recognition failed, when it did. Previously computed by
  // the backend (recognition.routes.ts) but dropped here before it ever
  // reached a component — VideoViewport needs it to tell "still deciding"
  // apart from "confidently doesn't know this sign".
  reason?: string;
}
export interface RecognitionRequest {
  features?: any;
  sequence?: any[];
  language?: string;
  gestureType?: string;
  // Phase 5 (live wiring): base64/data-URL hand-shape crop for this frame,
  // when the caller was able to capture one (see VideoViewport.tsx). The
  // backend fuses this into scoring only for words tagged gestureType
  // "static" and only when its CNN model is loaded — omit or leave
  // undefined otherwise and recognition falls back to DTW/frame scoring,
  // same as before this field existed.
  handCropImage?: string;
}
const emptyResult: RecognitionResult = {
  recognized: false,
  word: null,
  confidence: 0,
  score: Number.MAX_SAFE_INTEGER,
};
type RecognitionResponse = RecognitionResult & {
  reason?: string;
  error?: string;
};
export async function recognize(
  request: RecognitionRequest,
): Promise<RecognitionResult> {
  if (!request.features) return emptyResult;
  try {
    const start = performance.now();
    const data = await apiClient.post<RecognitionResponse>(
      "/recognize",
      {
        features: request.features,
        sequence: request.sequence?.length ? request.sequence : [],
        language: request.language,
        gestureType: request.gestureType ?? "dynamic",
        handCropImage: request.handCropImage,
      },
      {
        timeout: 15000,
      },
    );
    const processingTime = Math.round(performance.now() - start);
    return {
      recognized: Boolean(data?.recognized),
      word: data?.word ?? null,
      confidence: Number(data?.confidence ?? 0),
      score: Number(data?.score ?? Infinity),
      alternatives: data?.alternatives ?? [],
      warning: data?.warning,
      reason: data?.reason,
      trainingWord: data?.trainingWord,
      samplesNeeded: data?.samplesNeeded,
      processingTime,
    };
  } catch (error: any) {
    if (error?.status === 429) {
      console.warn("Recognition request rate-limited — backing off.");
      return {
        ...emptyResult,
        warning: "rate_limited",
        reason: "rate_limited",
      };
    }
    const isAbort =
      error?.name === "AbortError" ||
      error?.code === "ECONNABORTED" ||
      /aborted/i.test(String(error?.message ?? ""));
    if (isAbort) {
      // Routine during continuous live recognition (a new request supersedes
      // an in-flight one, or the 15s timeout fires) — not a real failure.
      console.warn("Recognition request aborted/timed out — skipping.");
    } else {
      console.error("Recognition failed:", error);
    }
    return {
      ...emptyResult,
      reason: "request_failed",
    };
  }
}

// Asks the backend to build its gesture-stats cache (and wakes the server
// and database if they were idle) so the first live recognition is fast.
// Fire-and-forget: a failure here must never block the UI.
export async function warmRecognition(): Promise<void> {
  try {
    await apiClient.get("/recognize/warm", { timeout: 60000 });
  } catch (error) {
    console.warn("Recognition warm-up skipped:", error);
  }
}