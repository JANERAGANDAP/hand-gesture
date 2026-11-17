// src/utils/heuristicGestureDetector.ts
// Robust geometric classifier for standard sign language gestures.
// Uses MediaPipe 3D landmark points and extracted features to recognize
// core signs in real time without requiring hundreds of pre-recorded takes.

import type { GestureFeatures } from "./featureExtractor";

export interface HeuristicMatch {
  word: string;
  confidence: number;
}

interface Point3D {
  x: number;
  y: number;
  z?: number;
}

function dist(a: Point3D, b: Point3D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Evaluates live MediaPipe landmarks and features to determine if a known sign is being performed.
 */
export function detectHeuristicSign(
  features: GestureFeatures,
  poseLandmarks: any[] = [],
  leftHand: any[] = [],
  rightHand: any[] = [],
  _history: GestureFeatures[] = [],
): HeuristicMatch | null {
  if (!features) return null;

  const hasRight = Array.isArray(rightHand) && rightHand.length >= 21;
  const hasLeft = Array.isArray(leftHand) && leftHand.length >= 21;
  const hasPose = Array.isArray(poseLandmarks) && poseLandmarks.length >= 25;

  // Primary active hand: prefer whichever hand is active/visible
  const dominantHand = hasRight ? rightHand : hasLeft ? leftHand : null;
  const isRight = hasRight;
  const activeFingers = isRight ? features.right_fingers : features.left_fingers;
  const activeFingerCount = isRight ? features.right_finger_count : features.left_finger_count;
  const handToNose = isRight ? features.right_hand_to_nose : features.left_hand_to_nose;
  const handAboveShoulder = isRight ? features.right_hand_above_shoulder : features.left_hand_above_shoulder;

  const nose = hasPose ? poseLandmarks[0] : null;
  const chestY = hasPose ? (poseLandmarks[11].y + poseLandmarks[12].y) / 2 : 0.5;
  const chestX = hasPose ? (poseLandmarks[11].x + poseLandmarks[12].x) / 2 : 0.5;

  if (dominantHand && dominantHand.length >= 21) {
    const wrist = dominantHand[0];
    const thumbTip = dominantHand[4];
    const indexTip = dominantHand[8];
    const indexMcp = dominantHand[5];
    const middleTip = dominantHand[12];

    const thumbUp = thumbTip.y < indexMcp.y;
    const indexOnly = activeFingers[1] && !activeFingers[2] && !activeFingers[3] && !activeFingers[4];
    const thumbAndIndexOnly = activeFingers[0] && activeFingers[1] && !activeFingers[2] && !activeFingers[3] && !activeFingers[4];
    const fist = activeFingerCount === 0 || (activeFingerCount === 1 && activeFingers[0]); // curled fingers
    const flatHand = activeFingerCount >= 4;
    const threeFingersW = activeFingers[1] && activeFingers[2] && activeFingers[3] && !activeFingers[4]; // W shape

    // ── 1. "I" / "me" (Index pointing to one's chest / self) ──
    // Index finger extended, tip pointing towards chest / body center
    if (indexOnly && Math.abs(indexTip.x - chestX) < 0.18 && indexTip.y > chestY - 0.05 && indexTip.y < chestY + 0.3) {
      return { word: "I", confidence: 0.94 };
    }

    // ── 2. "you" (Index finger pointing forward away from body towards camera) ──
    // Hand extended forward, pointing at camera (away from chest center)
    const armExt = isRight ? features.right_arm_extension : features.left_arm_extension;
    if (indexOnly && (Math.abs(indexTip.x - chestX) > 0.15 || armExt > 0.35) && indexTip.y > chestY - 0.25) {
      return { word: "you", confidence: 0.90 };
    }

    // ── 3. "hungry" (C-hand or bent fingers on chest/stomach moving downward) ──
    // Hand placed over chest/stomach area (near chest center), NOT index-only pointing
    const handOnTorso = Math.abs(wrist.x - chestX) < 0.20 && wrist.y > chestY && wrist.y < chestY + 0.45;
    if (handOnTorso && !indexOnly && activeFingerCount >= 2 && activeFingerCount <= 5) {
      return { word: "hungry", confidence: 0.90 };
    }

    // ── 4. "black" (Index finger drawing across / pointing near the forehead or eyebrow) ──
    // Index finger near forehead (above nose, hand above shoulder or near eyes/temple)
    if (indexOnly && nose && wrist.y < nose.y + 0.08 && handToNose < 0.28) {
      return { word: "black", confidence: 0.90 };
    }

    // ── 5. "water" (W-shape hand or 3 fingers touching chin/mouth) ──
    if ((threeFingersW || (activeFingers[1] && activeFingers[2] && activeFingerCount <= 3)) && handToNose < 0.22 && wrist.y > (nose?.y ?? 0)) {
      return { word: "water", confidence: 0.88 };
    }

    // ── 6. "eat" / "food" (Fingertips bunched together or pinching near mouth) ──
    const fingersNearThumb = dist(indexTip, thumbTip) < 0.08 && dist(middleTip, thumbTip) < 0.08;
    if ((fingersNearThumb || activeFingerCount <= 2) && !indexOnly && handToNose < 0.18 && wrist.y > (nose?.y ?? 0)) {
      return { word: "eat", confidence: 0.88 };
    }

    // ── 7. "thank you" (Flat open hand starting at chin/lips and opening forward) ──
    if (flatHand && handToNose < 0.26 && wrist.y > (nose?.y ?? 0) && wrist.y < chestY) {
      return { word: "thank you", confidence: 0.91 };
    }

    // ── 8. "hello" / "hi" (Open hand raised near temple / above shoulder waving) ──
    if (flatHand && handAboveShoulder && handToNose < 0.35) {
      return { word: "hello", confidence: 0.92 };
    }

    // ── 9. "help" (Thumbs up hand or two hands together near chest) ──
    if (hasRight && hasLeft) {
      // Two hands close together in front of chest
      if (features.hands_distance < 0.22 && Math.abs(wrist.y - chestY) < 0.25) {
        return { word: "help", confidence: 0.90 };
      }
    } else if (fist && thumbUp && Math.abs(wrist.y - chestY) < 0.25) {
      return { word: "help", confidence: 0.86 };
    }

    // ── 10. "good" (Thumbs up gesture) ──
    if (fist && thumbUp && wrist.y < chestY + 0.15 && !handAboveShoulder) {
      return { word: "good", confidence: 0.90 };
    }

    // ── 11. "yes" (Fist nodding / closed fist, thumb over fingers) ──
    if (fist && !thumbUp && Math.abs(wrist.y - chestY) < 0.25) {
      return { word: "yes", confidence: 0.88 };
    }

    // ── 12. "no" (Index and middle finger tapping / pinching thumb) ──
    if (thumbAndIndexOnly && dist(thumbTip, indexTip) < 0.06 && Math.abs(wrist.y - chestY) < 0.25) {
      return { word: "no", confidence: 0.88 };
    }

    // ── 13. "please" (Flat palm over center of chest) ──
    if (flatHand && Math.abs(wrist.x - chestX) < 0.12 && Math.abs(wrist.y - chestY) < 0.15) {
      return { word: "please", confidence: 0.89 };
    }

    // ── 14. "sorry" (Fist on center of chest) ──
    if (fist && Math.abs(wrist.x - chestX) < 0.14 && Math.abs(wrist.y - chestY) < 0.18) {
      return { word: "sorry", confidence: 0.88 };
    }

    // ── 15. "stop" (Open flat hand pushed forward away from chest towards camera) ──
    const stopArmExt = isRight ? features.right_arm_extension : features.left_arm_extension;
    if (flatHand && stopArmExt > 0.35 && Math.abs(wrist.x - chestX) > 0.12) {
      if (wrist.y > chestY - 0.25 && wrist.y < chestY + 0.25) {
        return { word: "stop", confidence: 0.90 };
      }
    }
  }

  return null;
}
