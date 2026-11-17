export const FRAME_JITTER_THRESHOLD = 0.9;
export const MIN_MOVEMENT_FOR_DIRECTION_CHECK = 0.05;
export interface WristSnapshot {
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
}
export function wristSnapshot(features: any): WristSnapshot {
  return {
    leftX: features.left_wrist_x ?? 0,
    leftY: features.left_wrist_y ?? 0,
    rightX: features.right_wrist_x ?? 0,
    rightY: features.right_wrist_y ?? 0,
  };
}
export function isTrackingGlitch(history: WristSnapshot[]): boolean {
  if (history.length < 3) return false;
  const [prev2, prev1, curr] = history.slice(-3);
  const dxL1 = prev1.leftX - prev2.leftX;
  const dyL1 = prev1.leftY - prev2.leftY;
  const dxL2 = curr.leftX - prev1.leftX;
  const dyL2 = curr.leftY - prev1.leftY;
  const dxR1 = prev1.rightX - prev2.rightX;
  const dyR1 = prev1.rightY - prev2.rightY;
  const dxR2 = curr.rightX - prev1.rightX;
  const dyR2 = curr.rightY - prev1.rightY;
  const magL1 = Math.hypot(dxL1, dyL1);
  const magL2 = Math.hypot(dxL2, dyL2);
  const magR1 = Math.hypot(dxR1, dyR1);
  const magR2 = Math.hypot(dxR2, dyR2);
  const leftMeaningful =
    magL1 > MIN_MOVEMENT_FOR_DIRECTION_CHECK &&
    magL2 > MIN_MOVEMENT_FOR_DIRECTION_CHECK;
  const rightMeaningful =
    magR1 > MIN_MOVEMENT_FOR_DIRECTION_CHECK &&
    magR2 > MIN_MOVEMENT_FOR_DIRECTION_CHECK;
  const leftReversed = leftMeaningful && dxL1 * dxL2 + dyL1 * dyL2 < 0;
  const rightReversed = rightMeaningful && dxR1 * dxR2 + dyR1 * dyR2 < 0;
  const totalJump = magL2 + magR2;
  return (leftReversed || rightReversed) && totalJump > FRAME_JITTER_THRESHOLD;
}
export function sustainedWristSpeed(history: WristSnapshot[]): number {
  if (history.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1];
    const b = history[i];
    total +=
      Math.hypot(b.leftX - a.leftX, b.leftY - a.leftY) +
      Math.hypot(b.rightX - a.rightX, b.rightY - a.rightY);
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
