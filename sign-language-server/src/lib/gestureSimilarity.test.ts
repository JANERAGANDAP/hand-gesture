import test from "node:test";
import assert from "node:assert/strict";
import { sequenceSummaryDistance } from "./gestureSimilarity";
function frame(value: number) {
  return {
    left_elbow_angle: value,
    right_elbow_angle: value + 1,
    left_wrist_x: value * 0.1,
    right_wrist_x: value * 0.1 + 0.2,
    left_finger_count: 2,
    right_finger_count: 2,
    left_hand_open: true,
    right_hand_open: false,
    left_fingers: [true, true, false, false, false],
    right_fingers: [true, true, false, false, false],
  };
}
test("identical sequences score lower than clearly different ones", () => {
  const a = [frame(1), frame(2), frame(3)];
  const b = [frame(1), frame(2), frame(3)];
  const c = [frame(10), frame(11), frame(12)];
  const sameScore = sequenceSummaryDistance(a, b);
  const differentScore = sequenceSummaryDistance(a, c);
  assert.ok(
    sameScore < differentScore,
    "identical sequences should score more similarly",
  );
  assert.equal(sameScore, 0, "truly identical frames should score exactly 0");
});
test("an empty sequence on either side returns +Infinity, never NaN or 0", () => {
  const a = [frame(1)];
  assert.equal(sequenceSummaryDistance([], a), Number.POSITIVE_INFINITY);
  assert.equal(sequenceSummaryDistance(a, []), Number.POSITIVE_INFINITY);
  assert.equal(sequenceSummaryDistance([], []), Number.POSITIVE_INFINITY);
});
test("a left/right finger-openness mismatch is penalized", () => {
  const openHand = [frame(5)];
  const closedHand = [
    {
      ...frame(5),
      left_fingers: [false, false, false, false, false],
    },
  ];
  const distance = sequenceSummaryDistance(openHand, closedHand);
  assert.ok(distance > 0, "differing finger state must increase the distance");
});
test("a boolean hand-open mismatch is penalized", () => {
  const a = [frame(5)];
  const b = [
    {
      ...frame(5),
      left_hand_open: false,
    },
  ];
  const distance = sequenceSummaryDistance(a, b);
  assert.ok(
    distance > 0,
    "differing left_hand_open must increase the distance",
  );
});
test("sequences longer than 6 frames only compare the last 6", () => {
  const longB = [
    frame(1),
    frame(2),
    frame(3),
    frame(4),
    frame(5),
    frame(6),
    frame(7),
  ];
  const shortB = [frame(2), frame(3), frame(4), frame(5), frame(6), frame(7)];
  assert.equal(
    sequenceSummaryDistance(longB, shortB),
    sequenceSummaryDistance(longB.slice(-6), shortB.slice(-6)),
    "only the last 6 frames should affect the score",
  );
});
