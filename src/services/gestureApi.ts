import {
  apiClient,
  authHeaders,
  buildUrl,
  invalidateSignLibraryCache,
} from "./api";
export interface GestureResponse {
  success: boolean;
  gesture?: any;
  message?: string;
  error?: string;
}
export interface GestureData {
  word: string;
  language?: string;
  gestureType?: "static" | "dynamic";
  features: Record<string, any>;
  sequence?: any[];
  frameCount?: number;
  description?: string;
  // Public URL of the cropped hand-shape image for this recording, if one
  // was captured (see handCrop.ts + AdminSignRecorder.tsx). Optional —
  // absent for recordings made before CNN Phase 1, or if capture failed.
  handCropUrl?: string;
}
export async function saveGesture(data: GestureData): Promise<GestureResponse> {
  try {
    const response = await apiClient.post<any>(
      "/gestures",
      {
        word: data.word.trim(),
        language: data.language ?? "FSL",
        // Lowercase, matching the schema/DB convention — historically this
        // sent .toUpperCase() here while bulk ingest and the schema default
        // both used lowercase, leaving mixed-case values in the DB. The
        // backend normalizes/validates this regardless, but keep it
        // consistent at the source.
        gestureType: data.gestureType ?? "dynamic",
        features: data.features,
        sequence: data.sequence ?? [],
        frameCount: data.frameCount ?? data.sequence?.length ?? 0,
        description: data.description ?? "",
        handCropUrl: data.handCropUrl,
      },
      {
        timeout: 15000,
      },
    );
    const result = response.data ?? response;
    if (result?.success) invalidateSignLibraryCache();
    return result;
  } catch (error: any) {
    console.error("Failed to save gesture:", error);
    return {
      success: false,
      error: error?.response?.data?.error ?? "Failed to save gesture",
    };
  }
}
export interface HandCropUploadResult {
  success: boolean;
  url?: string;
  error?: string;
}
// This call has its own timeout, unlike saveGesture/checkGestureConsistency
// which get theirs from apiClient's `timeout` option — see gesture-save
// latency investigation. Before this, uploadHandCrop had NO timeout at all:
// a stalled connection would hang indefinitely rather than failing. It now
// runs in the background (see uploadAndAttachHandCrop in
// AdminSignRecorder.tsx) so a stall here no longer blocks the save button,
// but it should still fail cleanly rather than leave a promise open forever.
const HAND_CROP_UPLOAD_TIMEOUT_MS = 20000;
/**
 * Uploads a single cropped hand-shape JPEG (see utils/handCrop.ts) and
 * returns its public URL. Uses raw fetch + FormData directly rather than
 * apiClient, since apiClient only sends JSON bodies.
 */
export async function uploadHandCrop(
  blob: Blob,
): Promise<HandCropUploadResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    HAND_CROP_UPLOAD_TIMEOUT_MS,
  );
  try {
    const formData = new FormData();
    formData.append("file", blob, "hand-crop.jpg");
    const response = await fetch(buildUrl("/gestures/hand-crop"), {
      method: "POST",
      headers: authHeaders(),
      body: formData,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.success) {
      return {
        success: false,
        error: body.error ?? `HTTP ${response.status}`,
      };
    }
    return { success: true, url: body.url };
  } catch (error: any) {
    console.error("Hand-crop upload failed:", error);
    return {
      success: false,
      error:
        error?.name === "AbortError"
          ? "Upload timed out"
          : (error?.message ?? "Hand-crop upload failed"),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
/**
 * Attaches a hand-crop image URL to an already-saved gesture. Used by the
 * background upload flow: the gesture record is saved immediately after
 * recording (see AdminSignRecorder.tsx), and this call patches in the crop
 * URL once its upload finishes, rather than saveGesture waiting on it.
 */
export async function attachHandCropUrl(
  gestureId: number,
  handCropUrl: string,
): Promise<GestureResponse> {
  try {
    const response = await apiClient.put<any>(
      `/gestures/${gestureId}`,
      { handCropUrl },
      { timeout: 15000 },
    );
    return response.data ?? response;
  } catch (error: any) {
    console.error("Failed to attach hand-crop URL:", error);
    return {
      success: false,
      error: error?.response?.data?.error ?? "Failed to attach hand-crop image",
    };
  }
}
export interface ConsistencyCheckResult {
  success: boolean;
  isOutlier: boolean;
  distance?: number | null;
  existingSpread?: number;
  reason?: string;
  // The word's existing gestureType, if it already has recordings — null
  // for a brand-new word. Used to lock the static/dynamic toggle so a word
  // can't end up with mixed recordings (see gesture.routes.ts).
  existingGestureType?: "static" | "dynamic" | null;
}
export async function checkGestureConsistency(
  word: string,
  sequence: any[],
): Promise<ConsistencyCheckResult> {
  try {
    const response = await apiClient.post<any>(
      "/gestures/consistency-check",
      {
        word: word.trim(),
        sequence,
      },
      {
        timeout: 15000,
      },
    );
    return response.data ?? response;
  } catch (error) {
    console.error("Consistency check failed:", error);
    return {
      success: false,
      isOutlier: false,
    };
  }
}
export interface RecordedGestureSummary {
  word: string;
  language: string;
  gestureType: string;
  count: number;
  handCropUrl: string | null;
  lastRecordedAt: string;
}
export interface RegisteredGestureLibraryEntry {
  word: string;
  gestureType: string;
  count: number;
  handCropUrl: string | null;
}
export async function getGestureLibrary(): Promise<{
  success: boolean;
  words: RegisteredGestureLibraryEntry[];
  error?: string;
}> {
  try {
    return await apiClient.get<{
      success: boolean;
      words: RegisteredGestureLibraryEntry[];
      error?: string;
    }>("/gestures/library");
  } catch (error) {
    console.error("Failed to load registered gestures:", error);
    return {
      success: false,
      words: [],
      error:
        error instanceof Error
          ? error.message
          : "Failed to load registered gestures",
    };
  }
}
export async function getGestureSummary(): Promise<{
  success: boolean;
  words: RecordedGestureSummary[];
  error?: string;
  warning?: string;
}> {
  try {
    const response = await apiClient.get<any>("/gestures/summary");
    return response.data ?? response;
  } catch (error: any) {
    console.error("Failed to load recorded signs:", error);
    return {
      success: false,
      words: [],
      error: error?.response?.data?.error ?? "Failed to load recorded signs",
    };
  }
}

export async function deleteWord(
  word: string,
  language: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await apiClient.delete<any>(
      `/gestures/by-word/${encodeURIComponent(word)}?language=${encodeURIComponent(language)}`,
    );
    const result = response.data ?? response;
    if (result?.success) invalidateSignLibraryCache();
    return result;
  } catch (error: any) {
    console.error("Failed to delete word:", error);
    return {
      success: false,
      error: error?.response?.data?.error ?? "Failed to delete word",
    };
  }
}
