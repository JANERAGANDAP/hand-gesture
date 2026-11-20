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
const FINGER_DIRECTION_WEIGHT = 15;
const FINGER_JOINT_ANGLE_WEIGHT = 10;

type OptionalFeatureVector = (number | undefined)[];

function featureArrayMean(
  samples: any[],
  featureKey: string,
  handDetectedKey: string,
  length: number,
): OptionalFeatureVector {
  return Array.from({ length }, (_, i) => {
    const values = samples
      .filter((sample) => sample?.[handDetectedKey] !== false)
      .map((sample) => sample?.[featureKey]?.[i])
      .filter((value) => Number.isFinite(value));
    return values.length ? mean(values) : undefined;
  });
}

function featureKeysMean(
  samples: any[],
  featureKeys: string[],
  handDetectedKey: string,
): OptionalFeatureVector {
  return featureKeys.map((key) => {
    const values = samples
      .filter((sample) => sample?.[handDetectedKey] === true)
      .map((sample) => sample?.[key])
      .filter((value) => Number.isFinite(value));
    return values.length ? mean(values) : undefined;
  });
}

function meanArrayDistance(
  values: any,
  means: OptionalFeatureVector | undefined,
  weight: number,
): number {
  if (!Array.isArray(values) || !means) return 0;
  let total = 0;
  for (let i = 0; i < means.length; i += 1) {
    if (Number.isFinite(values[i]) && Number.isFinite(means[i])) {
      total += (values[i] - means[i]!) ** 2 * weight;
    }
  }
  return total;
}

function pairArrayDistance(a: any, b: any, weight: number): number {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  let total = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
      total += (a[i] - b[i]) ** 2 * weight;
    }
  }
  return total;
}

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
  fingerExtensionMean?: {
    left: (number | undefined)[];
    right: (number | undefined)[];
  };
  handPresenceRate?: {
    left: number | undefined;
    right: number | undefined;
  };
  fingerDirectionMean?: {
    left: OptionalFeatureVector;
    right: OptionalFeatureVector;
  };
  fingerJointAngleMean?: {
    left: OptionalFeatureVector;
    right: OptionalFeatureVector;
  };
  palmNormalMean?: {
    left: OptionalFeatureVector;
    right: OptionalFeatureVector;
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
  const leftExtensionMean = [0, 1, 2, 3, 4].map((i) => {
    const vals = samples
      .map((sample) => sample?.left_finger_extensions?.[i])
      .filter((value) => Number.isFinite(value));
    return vals.length ? mean(vals) : undefined;
  });
  const rightExtensionMean = [0, 1, 2, 3, 4].map((i) => {
    const vals = samples
      .map((sample) => sample?.right_finger_extensions?.[i])
      .filter((value) => Number.isFinite(value));
    return vals.length ? mean(vals) : undefined;
  });
  const fingerExtensionMean =
    [...leftExtensionMean, ...rightExtensionMean].some((value) =>
      Number.isFinite(value),
    )
      ? { left: leftExtensionMean, right: rightExtensionMean }
      : undefined;
  const presenceRate = (key: string) => {
    const values = samples
      .map((sample) => sample?.[key])
      .filter((value) => typeof value === "boolean");
    return values.length
      ? values.filter(Boolean).length / values.length
      : undefined;
  };
  const leftHandPresenceRate = presenceRate("left_hand_detected");
  const rightHandPresenceRate = presenceRate("right_hand_detected");
  const handPresenceRate =
    leftHandPresenceRate !== undefined || rightHandPresenceRate !== undefined
      ? { left: leftHandPresenceRate, right: rightHandPresenceRate }
      : undefined;
  const leftFingerDirectionMean = featureArrayMean(
    samples,
    "left_finger_directions",
    "left_hand_detected",
    15,
  );
  const rightFingerDirectionMean = featureArrayMean(
    samples,
    "right_finger_directions",
    "right_hand_detected",
    15,
  );
  const fingerDirectionMean =
    [...leftFingerDirectionMean, ...rightFingerDirectionMean].some(
      (value) => value !== undefined,
    )
      ? {
          left: leftFingerDirectionMean,
          right: rightFingerDirectionMean,
        }
      : undefined;
  const leftFingerJointAngleMean = featureArrayMean(
    samples,
    "left_finger_joint_angles",
    "left_hand_detected",
    15,
  );
  const rightFingerJointAngleMean = featureArrayMean(
    samples,
    "right_finger_joint_angles",
    "right_hand_detected",
    15,
  );
  const fingerJointAngleMean =
    [...leftFingerJointAngleMean, ...rightFingerJointAngleMean].some(
      (value) => value !== undefined,
    )
      ? {
          left: leftFingerJointAngleMean,
          right: rightFingerJointAngleMean,
        }
      : undefined;
  const leftPalmNormalMean = featureKeysMean(
    samples,
    ["left_palm_normal_x", "left_palm_normal_y", "left_palm_normal_z"],
    "left_hand_detected",
  );
  const rightPalmNormalMean = featureKeysMean(
    samples,
    ["right_palm_normal_x", "right_palm_normal_y", "right_palm_normal_z"],
    "right_hand_detected",
  );
  const palmNormalMean =
    [...leftPalmNormalMean, ...rightPalmNormalMean].some(
      (value) => value !== undefined,
    )
      ? { left: leftPalmNormalMean, right: rightPalmNormalMean }
      : undefined;
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
      fingerExtensionMean,
      handPresenceRate,
      fingerDirectionMean,
      fingerJointAngleMean,
      palmNormalMean,
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
    fingerExtensionMean,
    handPresenceRate,
    fingerDirectionMean,
    fingerJointAngleMean,
    palmNormalMean,
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
  for (const [key, side] of [
    ["left_hand_detected", "left"],
    ["right_hand_detected", "right"],
  ] as const) {
    const value = current?.[key];
    const rate = stats.handPresenceRate?.[side];
    if (typeof value === "boolean" && rate !== undefined) {
      const surprise = value ? 1 - rate : rate;
      total += (surprise * 3) ** 2;
    }
  }
  for (let i = 0; i < 5; i++) {
    const leftIsTrue = Boolean(current?.left_fingers?.[i]);
    const leftP = stats.fingerTrueRate.left[i];
    total += (leftIsTrue ? 1 - leftP : leftP) ** 2 * 2.5;
    const rightIsTrue = Boolean(current?.right_fingers?.[i]);
    const rightP = stats.fingerTrueRate.right[i];
    total += (rightIsTrue ? 1 - rightP : rightP) ** 2 * 2.5;
    const leftExtension = current?.left_finger_extensions?.[i];
    const leftExtensionMean = stats.fingerExtensionMean?.left?.[i];
    if (
      Number.isFinite(leftExtension) &&
      leftExtensionMean !== undefined &&
      Number.isFinite(leftExtensionMean)
    ) {
      total += (leftExtension - leftExtensionMean) ** 2 * 12;
    }
    const rightExtension = current?.right_finger_extensions?.[i];
    const rightExtensionMean = stats.fingerExtensionMean?.right?.[i];
    if (
      Number.isFinite(rightExtension) &&
      rightExtensionMean !== undefined &&
      Number.isFinite(rightExtensionMean)
    ) {
      total += (rightExtension - rightExtensionMean) ** 2 * 12;
    }
  }
  if (current?.left_hand_detected !== false) {
    total += meanArrayDistance(
      current?.left_finger_directions,
      stats.fingerDirectionMean?.left,
      FINGER_DIRECTION_WEIGHT,
    );
    total += meanArrayDistance(
      current?.left_finger_joint_angles,
      stats.fingerJointAngleMean?.left,
      FINGER_JOINT_ANGLE_WEIGHT,
    );
  }
  if (current?.right_hand_detected !== false) {
    total += meanArrayDistance(
      current?.right_finger_directions,
      stats.fingerDirectionMean?.right,
      FINGER_DIRECTION_WEIGHT,
    );
    total += meanArrayDistance(
      current?.right_finger_joint_angles,
      stats.fingerJointAngleMean?.right,
      FINGER_JOINT_ANGLE_WEIGHT,
    );
  }
  if (current?.left_hand_detected !== false) {
    total += meanArrayDistance(
      [
        current?.left_palm_normal_x,
        current?.left_palm_normal_y,
        current?.left_palm_normal_z,
      ],
      stats.palmNormalMean?.left,
      12,
    );
  }
  if (current?.right_hand_detected !== false) {
    total += meanArrayDistance(
      [
        current?.right_palm_normal_x,
        current?.right_palm_normal_y,
        current?.right_palm_normal_z,
      ],
      stats.palmNormalMean?.right,
      12,
    );
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
  for (const key of ["left_hand_detected", "right_hand_detected"]) {
    if (
      typeof a?.[key] === "boolean" &&
      typeof b?.[key] === "boolean" &&
      a[key] !== b[key]
    ) {
      total += 9;
    }
  }
  for (let i = 0; i < 5; i++) {
    if (Boolean(a?.left_fingers?.[i]) !== Boolean(b?.left_fingers?.[i]))
      total += 2.5;
    if (Boolean(a?.right_fingers?.[i]) !== Boolean(b?.right_fingers?.[i]))
      total += 2.5;
    const aLeftExtension = a?.left_finger_extensions?.[i];
    const bLeftExtension = b?.left_finger_extensions?.[i];
    if (Number.isFinite(aLeftExtension) && Number.isFinite(bLeftExtension)) {
      total += (aLeftExtension - bLeftExtension) ** 2 * 12;
    }
    const aRightExtension = a?.right_finger_extensions?.[i];
    const bRightExtension = b?.right_finger_extensions?.[i];
    if (
      Number.isFinite(aRightExtension) &&
      Number.isFinite(bRightExtension)
    ) {
      total += (aRightExtension - bRightExtension) ** 2 * 12;
    }
  }
  if (a?.left_hand_detected !== false && b?.left_hand_detected !== false) {
    total += pairArrayDistance(
      a?.left_finger_directions,
      b?.left_finger_directions,
      FINGER_DIRECTION_WEIGHT,
    );
    total += pairArrayDistance(
      a?.left_finger_joint_angles,
      b?.left_finger_joint_angles,
      FINGER_JOINT_ANGLE_WEIGHT,
    );
  }
  if (a?.right_hand_detected !== false && b?.right_hand_detected !== false) {
    total += pairArrayDistance(
      a?.right_finger_directions,
      b?.right_finger_directions,
      FINGER_DIRECTION_WEIGHT,
    );
    total += pairArrayDistance(
      a?.right_finger_joint_angles,
      b?.right_finger_joint_angles,
      FINGER_JOINT_ANGLE_WEIGHT,
    );
  }
  if (a?.left_hand_detected !== false && b?.left_hand_detected !== false) {
    total += pairArrayDistance(
      [
        a?.left_palm_normal_x,
        a?.left_palm_normal_y,
        a?.left_palm_normal_z,
      ],
      [
        b?.left_palm_normal_x,
        b?.left_palm_normal_y,
        b?.left_palm_normal_z,
      ],
      12,
    );
  }
  if (a?.right_hand_detected !== false && b?.right_hand_detected !== false) {
    total += pairArrayDistance(
      [
        a?.right_palm_normal_x,
        a?.right_palm_normal_y,
        a?.right_palm_normal_z,
      ],
      [
        b?.right_palm_normal_x,
        b?.right_palm_normal_y,
        b?.right_palm_normal_z,
      ],
      12,
    );
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
