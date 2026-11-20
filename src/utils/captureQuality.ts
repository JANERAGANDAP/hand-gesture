export const FRAME_JITTER_THRESHOLD = 0.9;
export const MIN_MOVEMENT_FOR_DIRECTION_CHECK = 0.05;
export interface WristSnapshot {
  leftX: number | null;
  leftY: number | null;
  rightX: number | null;
  rightY: number | null;
}
export function wristSnapshot(features: any): WristSnapshot {
  return {
    leftX: features.left_hand_detected ? features.left_wrist_x ?? null : null,
    leftY: features.left_hand_detected ? features.left_wrist_y ?? null : null,
    rightX: features.right_hand_detected
      ? features.right_wrist_x ?? null
      : null,
    rightY: features.right_hand_detected
      ? features.right_wrist_y ?? null
      : null,
  };
}
function wristMovement(
  before: WristSnapshot,
  after: WristSnapshot,
  hand: "left" | "right",
) {
  const beforeX = before[`${hand}X`];
  const beforeY = before[`${hand}Y`];
  const afterX = after[`${hand}X`];
  const afterY = after[`${hand}Y`];
  if (
    beforeX === null ||
    beforeY === null ||
    afterX === null ||
    afterY === null
  ) {
    return null;
  }
  const dx = afterX - beforeX;
  const dy = afterY - beforeY;
  return { dx, dy, magnitude: Math.hypot(dx, dy) };
}
export function isTrackingGlitch(history: WristSnapshot[]): boolean {
  if (history.length < 3) return false;
  const [prev2, prev1, curr] = history.slice(-3);
  const leftPrevious = wristMovement(prev2, prev1, "left");
  const leftCurrent = wristMovement(prev1, curr, "left");
  const rightPrevious = wristMovement(prev2, prev1, "right");
  const rightCurrent = wristMovement(prev1, curr, "right");
  const leftReversed =
    leftPrevious !== null &&
    leftCurrent !== null &&
    leftPrevious.magnitude > MIN_MOVEMENT_FOR_DIRECTION_CHECK &&
    leftCurrent.magnitude > MIN_MOVEMENT_FOR_DIRECTION_CHECK &&
    leftPrevious.dx * leftCurrent.dx + leftPrevious.dy * leftCurrent.dy < 0;
  const rightReversed =
    rightPrevious !== null &&
    rightCurrent !== null &&
    rightPrevious.magnitude > MIN_MOVEMENT_FOR_DIRECTION_CHECK &&
    rightCurrent.magnitude > MIN_MOVEMENT_FOR_DIRECTION_CHECK &&
    rightPrevious.dx * rightCurrent.dx +
      rightPrevious.dy * rightCurrent.dy <
      0;
  const totalJump =
    (leftCurrent?.magnitude ?? 0) + (rightCurrent?.magnitude ?? 0);
  return (leftReversed || rightReversed) && totalJump > FRAME_JITTER_THRESHOLD;
}
export function sustainedWristSpeed(history: WristSnapshot[]): number {
  if (history.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < history.length; i++) {
    const previous = history[i - 1];
    const current = history[i];
    total +=
      (wristMovement(previous, current, "left")?.magnitude ?? 0) +
      (wristMovement(previous, current, "right")?.magnitude ?? 0);
  }
  return total / (history.length - 1);
}
export const SHOULDER_WIDTH_TOO_FAR = 0.12;
export const SHOULDER_WIDTH_TOO_CLOSE = 0.5;
export const SUSTAINED_SPEED_WARNING = 0.35;
export function getCaptureWarning(
  pose: any[] | undefined,
  hasHands: boolean,
  wristHistory: WristSnapshot[],
  checkSpeed: boolean,
  hasFace?: boolean,
): string | null {
  if (!pose || pose.length < 13) {
    return "Step into frame so your upper body is visible";
  }
  if (!hasHands) {
    return "No hands detected — move your hands into frame";
  }
  if (hasFace === false) {
    return "Face not detected — make sure your face is in frame too";
  }
  const leftShoulder = pose[11];
  const rightShoulder = pose[12];
  const shoulderWidth =
    leftShoulder && rightShoulder
      ? Math.hypot(
          leftShoulder.x - rightShoulder.x,
          leftShoulder.y - rightShoulder.y,
        )
      : null;
  if (shoulderWidth !== null && shoulderWidth < SHOULDER_WIDTH_TOO_FAR) {
    return "You're a bit far from the camera — move closer";
  }
  if (shoulderWidth !== null && shoulderWidth > SHOULDER_WIDTH_TOO_CLOSE) {
    return "You're very close to the camera — step back a little";
  }
  if (
    checkSpeed &&
    sustainedWristSpeed(wristHistory) > SUSTAINED_SPEED_WARNING
  ) {
    return "Signing quite fast — a touch slower gives a cleaner recording";
  }
  return null;
}
