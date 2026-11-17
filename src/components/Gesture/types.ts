export interface HistoryEntry {
  id: number;
  gesture: string;
  language: string;
  time: string;
  source: "gesture" | "speech";
}
export interface SignAsset {
  id: number;
  word: string;
  file: string;
  type: string;
}
