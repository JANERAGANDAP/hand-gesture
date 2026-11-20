import test from "node:test";
import assert from "node:assert/strict";
import { extractFeatures } from "./featureExtractor";

function landmarks(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    x: index * 0.01,
    y: index * 0.01,
    z: 0,
  }));
}

test("extractFeatures preserves left/right hand presence independently", () => {
  const pose = landmarks(17);
  pose[11] = { x: 0, y: 0, z: 0 };
  pose[12] = { x: 1, y: 0, z: 0 };
  const hand = landmarks(21);

  const leftOnly = extractFeatures(pose, hand, []);
  const rightOnly = extractFeatures(pose, [], hand);

  assert.equal(leftOnly?.left_hand_detected, true);
  assert.equal(leftOnly?.right_hand_detected, false);
  assert.equal(rightOnly?.left_hand_detected, false);
  assert.equal(rightOnly?.right_hand_detected, true);
});

test("extractFeatures records 3D finger direction and joint articulation", () => {
  const pose = landmarks(17);
  pose[11] = { x: 0, y: 0, z: 0 };
  pose[12] = { x: 1, y: 0, z: 0 };
  const makeHand = (
    direction: { x: number; y: number; z: number },
    bent = false,
  ) => {
    const hand = landmarks(21);
    const base = { x: 0.2, y: 0.2, z: 0 };
    hand[5] = base;
    if (bent) {
      hand[6] = { x: 0.2, y: 0, z: 0 };
      hand[7] = { x: 0.5, y: 0, z: 0 };
      hand[8] = { x: 0.8, y: 0, z: 0 };
    } else {
      hand[6] = {
        x: base.x + direction.x / 3,
        y: base.y + direction.y / 3,
        z: base.z + direction.z / 3,
      };
      hand[7] = {
        x: base.x + (direction.x * 2) / 3,
        y: base.y + (direction.y * 2) / 3,
        z: base.z + (direction.z * 2) / 3,
      };
      hand[8] = {
        x: base.x + direction.x,
        y: base.y + direction.y,
        z: base.z + direction.z,
      };
    }
    return hand;
  };

  const upHand = makeHand({ x: 0, y: -1, z: 0 });
  const up = extractFeatures(pose, [], upHand);
  const forward = extractFeatures(
    pose,
    [],
    makeHand({ x: 0, y: 0, z: 1 }),
  );
  const bent = extractFeatures(
    pose,
    [],
    makeHand({ x: 0, y: -1, z: 0 }, true),
  );

  assert.equal(up?.right_finger_directions.length, 15);
  assert.equal(up?.right_finger_joint_angles.length, 15);
  assert.notDeepEqual(
    up?.right_finger_directions.slice(3, 6),
    forward?.right_finger_directions.slice(3, 6),
  );
  assert.notEqual(
    up?.right_finger_joint_angles[4],
    bent?.right_finger_joint_angles[4],
  );
});
