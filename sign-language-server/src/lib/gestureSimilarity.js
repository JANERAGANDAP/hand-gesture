function sequenceSummaryDistance(liveFrames, storedFrames) {
  if (!liveFrames.length || !storedFrames.length) return Number.POSITIVE_INFINITY;

  const live = liveFrames.slice(-6);
  const stored = storedFrames.slice(-6);

  const size = Math.max(live.length, stored.length);
  let total = 0;

  for (let i = 0; i < size; i += 1) {
    const a = live[i] ?? live[live.length - 1];
    const b = stored[i] ?? stored[stored.length - 1];

    const keys = [
      'left_elbow_angle',
      'right_elbow_angle',
      'left_wrist_x',
      'right_wrist_x',
      'left_wrist_y',
      'right_wrist_y',
      'hands_distance',
      'left_hand_to_nose',
      'right_hand_to_nose',
      'left_palm_width',
      'right_palm_width',
      'left_arm_extension',
      'right_arm_extension',
      'hand_height_difference',
    ];

    for (const key of keys) {
      const av = Number(a?.[key] ?? 0);
      const bv = Number(b?.[key] ?? 0);
      total += Math.abs(av - bv) * 0.7;
    }

    const booleanKeys = [
      'left_hand_open',
      'right_hand_open',
      'left_hand_above_shoulder',
      'right_hand_above_shoulder',
    ];

    for (const key of booleanKeys) {
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

module.exports = { sequenceSummaryDistance };
