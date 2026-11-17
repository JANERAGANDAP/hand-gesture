export const EPS = 1e-4;
import { parseJsonField } from "../utils/jsonField";
export const NUMERIC_FEATURE_KEYS = [
  "left_elbow_angle",
  "right_elbow_angle",
  "hands_distance",
  "left_hand_to_nose",
  "right_hand_to_nose",
  "left_wrist_x",
  "left_wrist_y",
  "left_wrist_z",
  "right_wrist_x",
  "right_wrist_y",
  "right_wrist_z",
  "left_palm_width",
  "right_palm_width",
  "left_arm_extension",
  "right_arm_extension",
  "hand_height_difference",
  "left_finger_count",
  "right_finger_count",
  "left_palm_normal_x",
  "left_palm_normal_y",
  "left_palm_normal_z",
  "right_palm_normal_x",
  "right_palm_normal_y",
  "right_palm_normal_z",
  "brow_raise",
  "brow_furrow",
  "mouth_open",
  "mouth_width",
] as const;
export const BOOLEAN_FEATURE_KEYS = [
  "left_hand_open",
  "right_hand_open",
  "left_hand_above_shoulder",
  "right_hand_above_shoulder",
] as const;
function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
function std(values: number[], avg: number): number {
  if (values.length < 2) return EPS;
  const variance =
    values.reduce((acc, v) => acc + (v - avg) ** 2, 0) / values.length;
  return Math.max(Math.sqrt(variance), EPS);
}
function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  if (values.length <= 3) return Math.max(...values);
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}
export interface WordStats {
  word: string;
  // "static" = CNN-eligible hand-shape word, "dynamic" = DTW-only motion
  // word. All rows for a given word are enforced to share one gestureType
  // (see gesture.routes.ts) so this can safely be a single per-word value.
  gestureType: "static" | "dynamic";
  sampleCount: number;
  numericMean: Record<string, number>;
  numericStd: Record<string, number>;
  booleanTrueRate: Record<string, number>;
  fingerTrueRate: {
    left: number[];
    right: number[];
  };
  sequences: any[][];
  maxInternalDistance: number;
}
export interface GlobalStats {
  numericStd: Record<string, number>;
}
export function buildGlobalStats(rows: any[]): GlobalStats {
  const allSamples: any[] = [];
  for (const row of rows) {
    const seq = Array.isArray(row.sequence) ? row.sequence : (Array.isArray(parseJsonField(row.sequence)) ? parseJsonField(row.sequence) as any[] : []);
    const feats = typeof row.features === "object" && row.features !== null ? row.features : parseJsonField(row.features);
    const frames = seq.length
      ? seq.map((f: any) => f.features ?? f)
      : feats
        ? [feats]
        : [];
    allSamples.push(...frames);
  }
  const numericStd: Record<string, number> = {};
  for (const key of NUMERIC_FEATURE_KEYS) {
    const values = allSamples
      .map((s) => Number(s?.[key]))
      .filter((v) => Number.isFinite(v));
    const avg = mean(values);
    numericStd[key] = std(values, avg);
  }
  return {
    numericStd,
  };
}
export function buildWordStats(
  word: string,
  rows: any[],
  globalStats: GlobalStats,
): WordStats {
  const samples: any[] = [];
  const sequences: any[][] = [];
  for (const row of rows) {
    const seq = Array.isArray(row.sequence) ? row.sequence : (Array.isArray(parseJsonField(row.sequence)) ? parseJsonField(row.sequence) as any[] : []);
    const feats = typeof row.features === "object" && row.features !== null ? row.features : parseJsonField(row.features);
    const frames = seq.length
      ? seq.map((f: any) => f.features ?? f)
      : feats
        ? [feats]
        : [];
    if (frames.length) {
      samples.push(...frames);
      sequences.push(frames);
    }
  }
  // Rows for one word are expected to share a single gestureType (enforced
  // at write time in gesture.routes.ts). Take the first row's value rather
  // than trusting every row to agree — defends against stale data written
  // before that enforcement existed.
  const gestureType: "static" | "dynamic" =
    String(rows[0]?.gestureType ?? "dynamic").toLowerCase() === "static"
      ? "static"
      : "dynamic";
  const numericMean: Record<string, number> = {};
  const numericStd: Record<string, number> = {};
  for (const key of NUMERIC_FEATURE_KEYS) {
    const values = samples
      .map((s) => Number(s?.[key]))
      .filter((v) => Number.isFinite(v));
    const avg = mean(values);
    numericMean[key] = avg;
    numericStd[key] = std(values, avg);
  }
  const booleanTrueRate: Record<string, number> = {};
  for (const key of BOOLEAN_FEATURE_KEYS) {
    const values = samples.map((s) => Boolean(s?.[key]));
    booleanTrueRate[key] = values.length
      ? values.filter(Boolean).length / values.length
      : 0.5;
  }
  const fingerTrueRate = {
    left: [0, 1, 2, 3, 4].map((i) => {
      const vals = samples.map((s) => Boolean(s?.left_fingers?.[i]));
      return vals.length ? vals.filter(Boolean).length / vals.length : 0.5;
    }),
    right: [0, 1, 2, 3, 4].map((i) => {
      const vals = samples.map((s) => Boolean(s?.right_fingers?.[i]));
      return vals.length ? vals.filter(Boolean).length / vals.length : 0.5;
    }),
  };
  let maxInternalDistance = 0;
  if (sequences.length >= 2) {
    const tempStats: WordStats = {
      word,
      gestureType,
      sampleCount: samples.length,
      numericMean,
      numericStd,
      booleanTrueRate,
      fingerTrueRate,
      sequences,
      maxInternalDistance: 0,
    };
    const pairwiseDistances: number[] = [];
    for (let i = 0; i < sequences.length; i++) {
      for (let j = i + 1; j < sequences.length; j++) {
        const d = dtwDistance(
          sequences[i],
          sequences[j],
          tempStats,
          globalStats,
        );
        if (Number.isFinite(d)) {
          pairwiseDistances.push(d);
        }
      }
    }
    maxInternalDistance = percentile(pairwiseDistances, 0.9);
  }
  return {
    word,
    gestureType,
    sampleCount: samples.length,
    numericMean,
    numericStd,
    booleanTrueRate,
    fingerTrueRate,
    sequences,
    maxInternalDistance,
  };
}
export function buildAllWordStats(rows: any[]): Map<string, WordStats> {
  const globalStats = buildGlobalStats(rows);
  const grouped = new Map<string, any[]>();
  for (const row of rows) {
    if (!row.word) continue;
    const list = grouped.get(row.word) ?? [];
    list.push(row);
    grouped.set(row.word, list);
  }
  const result = new Map<string, WordStats>();
  for (const [word, rows2] of grouped) {
    result.set(word, buildWordStats(word, rows2, globalStats));
  }
  return result;
}
// Per-word z-score distance of a single live frame against that word's trained stats.
export function frameDistance(
  current: any,
  stats: WordStats,
  globalStats: GlobalStats,
  prevFrame?: any,
): number {
  let total = 0;
  for (const key of NUMERIC_FEATURE_KEYS) {
    const value = Number(current?.[key]) || 0;
    const scale = globalStats.numericStd[key] || EPS;
    const z = (value - stats.numericMean[key]) / scale;
    total += z * z;
  }
  for (const key of BOOLEAN_FEATURE_KEYS) {
    const isTrue = Boolean(current?.[key]);
    const p = stats.booleanTrueRate[key];
    const surprise = isTrue ? 1 - p : p;
    total += (surprise * 3) ** 2;
  }
  for (let i = 0; i < 5; i++) {
    const leftIsTrue = Boolean(current?.left_fingers?.[i]);
    const leftP = stats.fingerTrueRate.left[i];
    total += (leftIsTrue ? 1 - leftP : leftP) ** 2 * 2.5;
    const rightIsTrue = Boolean(current?.right_fingers?.[i]);
    const rightP = stats.fingerTrueRate.right[i];
    total += (rightIsTrue ? 1 - rightP : rightP) ** 2 * 2.5;
  }
  if (prevFrame) {
    const dx = Math.abs(
      (current.right_wrist_x || 0) - (prevFrame.right_wrist_x || 0),
    );
    const dy = Math.abs(
      (current.right_wrist_y || 0) - (prevFrame.right_wrist_y || 0),
    );
    total += (dx + dy) * 8;
  }
  return total;
}
export function frameToFrameDistance(
  a: any,
  b: any,
  stats: WordStats,
  globalStats: GlobalStats,
): number {
  let total = 0;
  for (const key of NUMERIC_FEATURE_KEYS) {
    const av = Number(a?.[key]) || 0;
    const bv = Number(b?.[key]) || 0;
    const scale = globalStats.numericStd[key] || EPS;
    const z = (av - bv) / scale;
    total += z * z;
  }
  for (const key of BOOLEAN_FEATURE_KEYS) {
    if (Boolean(a?.[key]) !== Boolean(b?.[key])) total += 9;
  }
  for (let i = 0; i < 5; i++) {
    if (Boolean(a?.left_fingers?.[i]) !== Boolean(b?.left_fingers?.[i]))
      total += 2.5;
    if (Boolean(a?.right_fingers?.[i]) !== Boolean(b?.right_fingers?.[i]))
      total += 2.5;
  }
  return total;
}
const DTW_BAND_RADIUS = 8;
// Sakoe-Chiba banded DTW: compares two frame sequences, bailing out early
// once the best-so-far cost exceeds `bound` (keeps recognition fast).
export function dtwDistance(
  liveFrames: any[],
  storedFrames: any[],
  stats: WordStats,
  globalStats: GlobalStats,
  bound: number = Infinity,
): number {
  const n = liveFrames.length;
  const m = storedFrames.length;
  if (n === 0 || m === 0) return Infinity;
  const norm = Math.sqrt(n * m + 1);
  const rawBound = bound * norm;
  const band = Math.max(DTW_BAND_RADIUS, Math.abs(n - m));
  const cost: number[][] = Array.from(
    {
      length: n + 1,
    },
    () => new Array(m + 1).fill(Infinity),
  );
  cost[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    let rowMin = Infinity;
    const jStart = Math.max(1, i - band);
    const jEnd = Math.min(m, i + band);
    for (let j = jStart; j <= jEnd; j++) {
      const stepCost = frameToFrameDistance(
        liveFrames[i - 1],
        storedFrames[j - 1],
        stats,
        globalStats,
      );
      const prevBest = Math.min(
        cost[i - 1][j],
        cost[i][j - 1],
        cost[i - 1][j - 1],
      );
      cost[i][j] = stepCost + prevBest;
      if (cost[i][j] < rowMin) rowMin = cost[i][j];
    }
    if (rowMin > rawBound) {
      return Infinity;
    }
  }
  return cost[n][m] / Math.sqrt(n * m + 1);
}
// Converts a raw DTW distance to a 0-100 confidence via exponential decay.
export function distanceToConfidence(distance: number, scale = 50): number {
  if (!Number.isFinite(distance)) return 0;
  const confidence = 100 * Math.exp(-distance / scale);
  return Math.max(0, Math.min(100, Math.round(confidence)));
}
