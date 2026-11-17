const NUMERIC_FEATURE_KEYS = [
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
type NumericKey = (typeof NUMERIC_FEATURE_KEYS)[number];

// Exponential moving average smoother for jittery per-frame landmark features.
export class FeatureSmoother {
  private previous: Partial<Record<NumericKey, number>> = {};
  private readonly alpha: number;
  constructor(alpha: number = 0.35) {
    this.alpha = alpha;
  }
  smooth<T extends Record<string, any>>(features: T): T {
    const smoothed: Record<string, any> = {
      ...features,
    };
    for (const key of NUMERIC_FEATURE_KEYS) {
      const raw = Number(features[key]);
      if (!Number.isFinite(raw)) continue;
      const prev = this.previous[key];
      const next =
        prev === undefined ? raw : this.alpha * raw + (1 - this.alpha) * prev;
      this.previous[key] = next;
      smoothed[key] = next;
    }
    return smoothed as T;
  }
  reset() {
    this.previous = {};
  }
}
