export const RECOGNITION_CONFIG = {
  RECOGNITION_TOP_K: 8,
  // Was 12: recorded templates hold up to RECORD_FRAMES (30, in
  // AdminSignRecorder.tsx) frames per take, so truncating the live
  // comparison window to only the most recent 12 frames meant DTW only
  // ever saw the tail end of a performed gesture — biasing recognition
  // toward whatever segment (usually the final held position) happened
  // to be in that short window, rather than the gesture as a whole.
  // Raised to sit close to RECORD_FRAMES so live comparisons cover most
  // of a full gesture instead of just its last fraction of a second.
  MAX_LIVE_FRAMES: 28,
  MAX_SEQUENCES_PER_WORD: 10,
  DYNAMIC_MATCH_DISTANCE_LIMIT: 35,
  INTERNAL_DISTANCE_MULTIPLIER: 2.2,
  MIN_EFFECTIVE_LIMIT: 28,
  MAX_EFFECTIVE_LIMIT: 60,
  MIN_SAMPLES_FOR_RECOGNITION: 1,
  CONFIDENCE_SCALE: 55,
  DYNAMIC_MIN_CONFIDENCE: 45,
  AMBIGUITY_GAP_TIGHT: 3,
  AMBIGUITY_GAP_TIGHT_PENALTY: 20,
  AMBIGUITY_GAP_LOOSE: 6,
  AMBIGUITY_GAP_LOOSE_PENALTY: 10,
  STATS_CACHE_MS: 300_000, // 5 min; clearStatsCache() runs on every gesture save/edit/delete

  // Static words (gestureType: "static") skip DTW entirely — it measures
  // motion-alignment, which a held hand-shape doesn't have — and score on
  // frameScore alone (the per-word z-score distance over MediaPipe hand/
  // pose landmarks, see gestureStats.ts's frameDistance). This used to be
  // a CNN-primary/frameScore-fallback split (an image-based hand-shape
  // CNN scored the crop when confident enough); the CNN was removed since
  // it needed far more per-word training samples than this app's
  // few-shot, teacher-adds-a-word-and-it's-live workflow produces, while
  // frameScore already does the same per-word template matching DTW does
  // for dynamic words — just on a single frame instead of a sequence.
  // Dynamic words are untouched by any of this.
} as const;
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Per-word distance limit: scales with how spread out that word's own recordings are.
export function computeEffectiveLimit(
  stats:
    | {
        maxInternalDistance?: number;
        sequences?: unknown[];
      }
    | null
    | undefined,
): number {
  const cfg = RECOGNITION_CONFIG;
  const hasEnoughRecordingsForVarianceSignal =
    !!stats && Array.isArray(stats.sequences) && stats.sequences.length >= 2;
  if (!hasEnoughRecordingsForVarianceSignal) {
    return cfg.DYNAMIC_MATCH_DISTANCE_LIMIT;
  }
  const scaled =
    (stats!.maxInternalDistance ?? 0) * cfg.INTERNAL_DISTANCE_MULTIPLIER;
  return clamp(scaled, cfg.MIN_EFFECTIVE_LIMIT, cfg.MAX_EFFECTIVE_LIMIT);
}

// Docks confidence when the best and second-best matches are too close to call.
export function applyAmbiguityPenalty(
  confidence: number,
  gapToSecondBest: number | null,
): number {
  const cfg = RECOGNITION_CONFIG;
  let adjusted = confidence;
  if (gapToSecondBest !== null) {
    if (gapToSecondBest < cfg.AMBIGUITY_GAP_TIGHT) {
      adjusted -= cfg.AMBIGUITY_GAP_TIGHT_PENALTY;
    } else if (gapToSecondBest < cfg.AMBIGUITY_GAP_LOOSE) {
      adjusted -= cfg.AMBIGUITY_GAP_LOOSE_PENALTY;
    }
  }
  return clamp(Math.round(adjusted), 0, 100);
}