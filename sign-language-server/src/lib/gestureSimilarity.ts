import { NUMERIC_FEATURE_KEYS, BOOLEAN_FEATURE_KEYS } from "./gestureStats";

// Cheap fallback distance (not DTW): compares just the last 6 frames of two
// sequences frame-by-frame, padding the shorter one by repeating its last frame.
export function sequenceSummaryDistance(
  liveFrames: any[],
  storedFrames: any[],
) {
  if (!liveFrames.length || !storedFrames.length)
    return Number.POSITIVE_INFINITY;
  const live = liveFrames.slice(-6);
  const stored = storedFrames.slice(-6);
  const size = Math.max(live.length, stored.length);
  let total = 0;
  for (let i = 0; i < size; i++) {
    const a = live[i] ?? live[live.length - 1];
    const b = stored[i] ?? stored[stored.length - 1];
    for (const key of NUMERIC_FEATURE_KEYS) {
      const av = Number(a?.[key] ?? 0);
      const bv = Number(b?.[key] ?? 0);
      total += Math.abs(av - bv) * 0.7;
    }
    for (const key of BOOLEAN_FEATURE_KEYS) {
      total += Boolean(a?.[key]) !== Boolean(b?.[key]) ? 3 : 0;
    }
    const leftFingers = a?.left_fingers ?? [];
    const rightFingers = a?.right_fingers ?? [];
    const storedLeft = b?.left_fingers ?? [];
    const storedRight = b?.right_fingers ?? [];
    for (let j = 0; j < 5; j += 1) {
      total += Boolean(leftFingers[j]) !== Boolean(storedLeft[j]) ? 2 : 0;
      total += Boolean(rightFingers[j]) !== Boolean(storedRight[j]) ? 2 : 0;
    }
  }
  return total / size;
}
