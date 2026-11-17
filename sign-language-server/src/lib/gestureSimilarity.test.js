const test = require('node:test');
const assert = require('node:assert/strict');
const { sequenceSummaryDistance } = require('./gestureSimilarity.js');

function frame(value) {
  return {
    left_elbow_angle: value,
    right_elbow_angle: value + 1,
    left_wrist_x: value * 0.1,
    right_wrist_x: value * 0.1 + 0.2,
    left_finger_count: 2,
    right_finger_count: 2,
    left_hand_open: true,
    right_hand_open: false,
  };
}

test('same gesture sequence gets a smaller distance than a different one', () => {
  const a = [frame(1), frame(2), frame(3)];
  const b = [frame(1), frame(2), frame(3)];
  const c = [frame(10), frame(11), frame(12)];

  const sameScore = sequenceSummaryDistance(a, b);
  const differentScore = sequenceSummaryDistance(a, c);

  assert.ok(sameScore < differentScore, 'identical sequences should score more similarly');
});
