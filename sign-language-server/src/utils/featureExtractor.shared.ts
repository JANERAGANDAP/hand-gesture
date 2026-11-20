interface Point {
  x: number;
  y: number;
  z: number;
}
export interface GestureFeatures {
  left_elbow_angle: number;
  right_elbow_angle: number;
  left_hand_open: boolean;
  right_hand_open: boolean;
  left_hand_detected: boolean;
  right_hand_detected: boolean;
  left_hand_above_shoulder: boolean;
  right_hand_above_shoulder: boolean;
  hands_distance: number;
  left_fingers: boolean[];
  right_fingers: boolean[];
  left_finger_extensions: number[];
  right_finger_extensions: number[];
  left_finger_directions: number[];
  right_finger_directions: number[];
  left_finger_joint_angles: number[];
  right_finger_joint_angles: number[];
  left_finger_count: number;
  right_finger_count: number;
  left_hand_to_nose: number;
  right_hand_to_nose: number;
  left_wrist_x: number;
  left_wrist_y: number;
  left_wrist_z: number;
  right_wrist_x: number;
  right_wrist_y: number;
  right_wrist_z: number;
  left_palm_width: number;
  right_palm_width: number;
  left_arm_extension: number;
  right_arm_extension: number;
  hand_height_difference: number;
  left_palm_normal_x: number;
  left_palm_normal_y: number;
  left_palm_normal_z: number;
  right_palm_normal_x: number;
  right_palm_normal_y: number;
  right_palm_normal_z: number;
  brow_raise: number;
  brow_furrow: number;
  mouth_open: number;
  mouth_width: number;
  featureVector: number[];
}
const ZERO_FACE_FEATURES = {
  brow_raise: 0,
  brow_furrow: 0,
  mouth_open: 0,
  mouth_width: 0,
};
function extractFaceFeatures(face: any[] = []) {
  if (!Array.isArray(face) || face.length < 468) {
    return ZERO_FACE_FEATURES;
  }
  const leftEyeOuter = safePoint(face, 33);
  const rightEyeOuter = safePoint(face, 263);
  const leftEyeTop = safePoint(face, 159);
  const rightEyeTop = safePoint(face, 386);
  const leftBrow = safePoint(face, 105);
  const rightBrow = safePoint(face, 334);
  const leftBrowInner = safePoint(face, 55);
  const rightBrowInner = safePoint(face, 285);
  const lipTop = safePoint(face, 13);
  const lipBottom = safePoint(face, 14);
  const mouthLeft = safePoint(face, 61);
  const mouthRight = safePoint(face, 291);
  if (!leftEyeOuter || !rightEyeOuter) {
    return ZERO_FACE_FEATURES;
  }
  const faceWidth = Math.max(distance(leftEyeOuter, rightEyeOuter), 0.001);
  const browRaiseLeft =
    leftBrow && leftEyeTop ? distance(leftBrow, leftEyeTop) / faceWidth : 0;
  const browRaiseRight =
    rightBrow && rightEyeTop ? distance(rightBrow, rightEyeTop) / faceWidth : 0;
  const browRaise = (browRaiseLeft + browRaiseRight) / 2;
  const browFurrow =
    leftBrowInner && rightBrowInner
      ? distance(leftBrowInner, rightBrowInner) / faceWidth
      : 0;
  const mouthOpen =
    lipTop && lipBottom ? distance(lipTop, lipBottom) / faceWidth : 0;
  const mouthWidth =
    mouthLeft && mouthRight ? distance(mouthLeft, mouthRight) / faceWidth : 0;
  return {
    brow_raise: Number(browRaise.toFixed(4)),
    brow_furrow: Number(browFurrow.toFixed(4)),
    mouth_open: Number(mouthOpen.toFixed(4)),
    mouth_width: Number(mouthWidth.toFixed(4)),
  };
}
function safePoint(landmarks: any[] | undefined, index: number): Point | null {
  if (!Array.isArray(landmarks)) return null;
  const p = landmarks[index];
  if (!p || typeof p.x !== "number" || typeof p.y !== "number") {
    return null;
  }
  return {
    x: p.x,
    y: p.y,
    z: typeof p.z === "number" ? p.z : 0,
  };
}
function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
function rotateYaw(p: Point, center: Point, angle: number): Point {
  const dx = p.x - center.x;
  const dz = p.z - center.z;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: center.x + dx * cos - dz * sin,
    y: p.y,
    z: center.z + dx * sin + dz * cos,
  };
}
function rotateRoll(p: Point, center: Point, angle: number): Point {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
    z: p.z,
  };
}
function sub(a: Point, b: Point): Point {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}
function cross(a: Point, b: Point): Point {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function normalize(v: Point): Point {
  const mag = Math.hypot(v.x, v.y, v.z);
  if (mag < 1e-6)
    return {
      x: 0,
      y: 0,
      z: 0,
    };
  return {
    x: v.x / mag,
    y: v.y / mag,
    z: v.z / mag,
  };
}
export function calculateAngle(a: Point, b: Point, c: Point): number {
  const ab = sub(a, b);
  const cb = sub(c, b);
  const dot = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z;
  const magAB = Math.hypot(ab.x, ab.y, ab.z);
  const magCB = Math.hypot(cb.x, cb.y, cb.z);
  if (magAB === 0 || magCB === 0) {
    return 0;
  }
  const cosine = dot / (magAB * magCB);
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * (180 / Math.PI);
}
function fingerExtension(hand: any[], joints: number[]): number {
  const points = joints
    .map((index) => safePoint(hand, index))
    .filter((point): point is Point => point !== null);
  if (points.length !== joints.length) return 0;
  let chainLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    chainLength += distance(points[index - 1], points[index]);
  }
  if (chainLength < 1e-6) return 0;
  return Math.max(
    0,
    Math.min(1, distance(points[0], points[points.length - 1]) / chainLength),
  );
}
const FINGER_LANDMARK_CHAINS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];
const FINGER_JOINT_TRIPLES = [
  [[0, 1, 2], [1, 2, 3], [2, 3, 4]],
  [[0, 5, 6], [5, 6, 7], [6, 7, 8]],
  [[0, 9, 10], [9, 10, 11], [10, 11, 12]],
  [[0, 13, 14], [13, 14, 15], [14, 15, 16]],
  [[0, 17, 18], [17, 18, 19], [18, 19, 20]],
];
export function detectHandState(hand: any[] = []) {
  const zeroNormal = {
    x: 0,
    y: 0,
    z: 0,
  };
  if (!Array.isArray(hand) || hand.length < 21) {
    return {
      open: false,
      detected: false,
      fingerCount: 0,
      fingers: [false, false, false, false, false],
      extensions: [0, 0, 0, 0, 0],
      directions: Array(15).fill(0),
      jointAngles: Array(15).fill(0),
      palmWidth: 0,
      palmNormal: zeroNormal,
    };
  }
  const wrist = safePoint(hand, 0);
  const indexMcp = safePoint(hand, 5);
  const pinkyMcp = safePoint(hand, 17);
  const extensions = [
    ...FINGER_LANDMARK_CHAINS.map((chain) => fingerExtension(hand, chain)),
  ];
  const directions = FINGER_LANDMARK_CHAINS.flatMap((chain) => {
    const base = safePoint(hand, chain[0]);
    const tip = safePoint(hand, chain[chain.length - 1]);
    const direction = base && tip ? normalize(sub(tip, base)) : { x: 0, y: 0, z: 0 };
    return [direction.x, direction.y, direction.z];
  });
  const jointAngles = FINGER_JOINT_TRIPLES.flatMap((finger) =>
    finger.map((joints) => {
      const points = joints.map((index) => safePoint(hand, index));
      if (!points[0] || !points[1] || !points[2]) return 0;
      return calculateAngle(points[0], points[1], points[2]) / 180;
    }),
  );
  const fingers = extensions.map(
    (extension, index) => extension >= (index === 0 ? 0.72 : 0.78),
  );
  const fingerCount = fingers.filter(Boolean).length;
  const palmWidth = indexMcp && pinkyMcp ? distance(indexMcp, pinkyMcp) : 0;
  const palmNormal =
    wrist && indexMcp && pinkyMcp
      ? normalize(cross(sub(indexMcp, wrist), sub(pinkyMcp, wrist)))
      : zeroNormal;
  return {
    open: fingerCount >= 3,
    detected: Boolean(wrist && indexMcp && pinkyMcp),
    fingerCount,
    fingers,
    extensions,
    directions,
    jointAngles,
    palmWidth,
    palmNormal,
    wrist,
  };
}
export function extractFeatures(
  pose: any[] = [],
  leftHand: any[] = [],
  rightHand: any[] = [],
  face: any[] = [],
): GestureFeatures | null {
  if (!Array.isArray(pose) || pose.length < 17) {
    return null;
  }
  const leftShoulder = safePoint(pose, 11);
  const rightShoulder = safePoint(pose, 12);
  const leftElbow = safePoint(pose, 13);
  const rightElbow = safePoint(pose, 14);
  const leftWrist = safePoint(pose, 15);
  const rightWrist = safePoint(pose, 16);
  if (
    !leftShoulder ||
    !rightShoulder ||
    !leftElbow ||
    !rightElbow ||
    !leftWrist ||
    !rightWrist
  ) {
    return null;
  }
  const nose = safePoint(pose, 0) ?? {
    x: (leftShoulder.x + rightShoulder.x) / 2,
    y: (leftShoulder.y + rightShoulder.y) / 2,
    z: (leftShoulder.z + rightShoulder.z) / 2,
  };
  const shoulderWidth = Math.max(distance(leftShoulder, rightShoulder), 0.001);
  const leftHandState = detectHandState(leftHand);
  const rightHandState = detectHandState(rightHand);
  const leftPalmWidth = leftHandState.palmWidth / shoulderWidth;
  const rightPalmWidth = rightHandState.palmWidth / shoulderWidth;
  const faceFeatures = extractFaceFeatures(face);
  const center = {
    x: (leftShoulder.x + rightShoulder.x) / 2,
    y: (leftShoulder.y + rightShoulder.y) / 2,
    z: (leftShoulder.z + rightShoulder.z) / 2,
  };
  // Undo body yaw/roll so features are comparable regardless of camera angle.
  const yawAngle = Math.atan2(
    rightShoulder.z - leftShoulder.z,
    rightShoulder.x - leftShoulder.x,
  );
  const leftShoulderYaw = rotateYaw(leftShoulder, center, -yawAngle);
  const rightShoulderYaw = rotateYaw(rightShoulder, center, -yawAngle);
  const leftWristYaw = rotateYaw(leftWrist, center, -yawAngle);
  const rightWristYaw = rotateYaw(rightWrist, center, -yawAngle);
  const rollAngle = Math.atan2(
    rightShoulderYaw.y - leftShoulderYaw.y,
    rightShoulderYaw.x - leftShoulderYaw.x,
  );
  const leftShoulderR = rotateRoll(leftShoulderYaw, center, -rollAngle);
  const rightShoulderR = rotateRoll(rightShoulderYaw, center, -rollAngle);
  const leftWristR = rotateRoll(leftWristYaw, center, -rollAngle);
  const rightWristR = rotateRoll(rightWristYaw, center, -rollAngle);
  const leftElbowAngle = calculateAngle(leftShoulder, leftElbow, leftWrist);
  const rightElbowAngle = calculateAngle(rightShoulder, rightElbow, rightWrist);
  const leftArmExtension = distance(leftShoulder, leftWrist) / shoulderWidth;
  const rightArmExtension = distance(rightShoulder, rightWrist) / shoulderWidth;
  const handsDistance = distance(leftWrist, rightWrist) / shoulderWidth;
  const leftWristX = (leftWristR.x - center.x) / shoulderWidth;
  const leftWristY = (leftWristR.y - center.y) / shoulderWidth;
  const leftWristZ = (leftWristR.z - center.z) / shoulderWidth;
  const rightWristX = (rightWristR.x - center.x) / shoulderWidth;
  const rightWristY = (rightWristR.y - center.y) / shoulderWidth;
  const rightWristZ = (rightWristR.z - center.z) / shoulderWidth;
  const featureVector = [
    leftElbowAngle,
    rightElbowAngle,
    Number(leftHandState.open),
    Number(rightHandState.open),
    Number(leftHandState.detected),
    Number(rightHandState.detected),
    leftArmExtension,
    rightArmExtension,
    handsDistance,
    leftWristX,
    leftWristY,
    leftWristZ,
    rightWristX,
    rightWristY,
    rightWristZ,
    leftHandState.fingerCount,
    rightHandState.fingerCount,
    ...leftHandState.extensions,
    ...rightHandState.extensions,
    ...leftHandState.directions,
    ...rightHandState.directions,
    ...leftHandState.jointAngles,
    ...rightHandState.jointAngles,
    leftHandState.palmNormal.x,
    leftHandState.palmNormal.y,
    leftHandState.palmNormal.z,
    rightHandState.palmNormal.x,
    rightHandState.palmNormal.y,
    rightHandState.palmNormal.z,
    faceFeatures.brow_raise,
    faceFeatures.brow_furrow,
    faceFeatures.mouth_open,
    faceFeatures.mouth_width,
  ];
  return {
    left_elbow_angle: Math.round(leftElbowAngle),
    right_elbow_angle: Math.round(rightElbowAngle),
    left_hand_open: leftHandState.open,
    right_hand_open: rightHandState.open,
    left_hand_detected: leftHandState.detected,
    right_hand_detected: rightHandState.detected,
    left_hand_above_shoulder: leftWristR.y < leftShoulderR.y,
    right_hand_above_shoulder: rightWristR.y < rightShoulderR.y,
    hands_distance: Number(handsDistance.toFixed(4)),
    left_fingers: leftHandState.fingers,
    right_fingers: rightHandState.fingers,
    left_finger_extensions: leftHandState.extensions.map((value) =>
      Number(value.toFixed(4)),
    ),
    right_finger_extensions: rightHandState.extensions.map((value) =>
      Number(value.toFixed(4)),
    ),
    left_finger_directions: leftHandState.directions.map((value) =>
      Number(value.toFixed(4)),
    ),
    right_finger_directions: rightHandState.directions.map((value) =>
      Number(value.toFixed(4)),
    ),
    left_finger_joint_angles: leftHandState.jointAngles.map((value) =>
      Number(value.toFixed(4)),
    ),
    right_finger_joint_angles: rightHandState.jointAngles.map((value) =>
      Number(value.toFixed(4)),
    ),
    left_finger_count: leftHandState.fingerCount,
    right_finger_count: rightHandState.fingerCount,
    left_hand_to_nose: Number(
      (distance(leftWrist, nose) / shoulderWidth).toFixed(4),
    ),
    right_hand_to_nose: Number(
      (distance(rightWrist, nose) / shoulderWidth).toFixed(4),
    ),
    left_wrist_x: Number(leftWristX.toFixed(4)),
    left_wrist_y: Number(leftWristY.toFixed(4)),
    left_wrist_z: Number(leftWristZ.toFixed(4)),
    right_wrist_x: Number(rightWristX.toFixed(4)),
    right_wrist_y: Number(rightWristY.toFixed(4)),
    right_wrist_z: Number(rightWristZ.toFixed(4)),
    left_palm_width: Number(leftPalmWidth.toFixed(4)),
    right_palm_width: Number(rightPalmWidth.toFixed(4)),
    left_arm_extension: Number(leftArmExtension.toFixed(4)),
    right_arm_extension: Number(rightArmExtension.toFixed(4)),
    hand_height_difference: Number((leftWristR.y - rightWristR.y).toFixed(4)),
    left_palm_normal_x: Number(leftHandState.palmNormal.x.toFixed(4)),
    left_palm_normal_y: Number(leftHandState.palmNormal.y.toFixed(4)),
    left_palm_normal_z: Number(leftHandState.palmNormal.z.toFixed(4)),
    right_palm_normal_x: Number(rightHandState.palmNormal.x.toFixed(4)),
    right_palm_normal_y: Number(rightHandState.palmNormal.y.toFixed(4)),
    right_palm_normal_z: Number(rightHandState.palmNormal.z.toFixed(4)),
    brow_raise: faceFeatures.brow_raise,
    brow_furrow: faceFeatures.brow_furrow,
    mouth_open: faceFeatures.mouth_open,
    mouth_width: faceFeatures.mouth_width,
    featureVector,
  };
}
