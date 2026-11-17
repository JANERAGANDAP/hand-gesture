import { apiClient } from "./api";
export interface AISentenceHistoryEntry {
  id: number;
  language: string;
  rawGestureInput: string;
  composedSentence: string;
  createdAt: string;
}
export async function saveAISentenceHistory(
  language: string,
  rawGestureInput: string,
  composedSentence: string,
) {
  try {
    return await apiClient.post<AISentenceHistoryEntry>("/ai-history", {
      language,
      rawGestureInput,
      composedSentence,
    });
  } catch (error) {
    console.error("Failed to save AI history:", error);
    throw error;
  }
}
export async function findAISentence(
  language: string,
  rawGestureInput: string,
) {
  try {
    return await apiClient.post<AISentenceHistoryEntry | null>(
      "/ai-history/lookup",
      {
        language,
        rawGestureInput,
      },
    );
  } catch (error) {
    console.error("Failed to find AI sentence:", error);
    return null;
  }
}
