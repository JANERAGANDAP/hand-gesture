declare const POSE_CONNECTIONS: any;
declare const HAND_CONNECTIONS: any;
declare const drawConnectors: any;
declare const drawLandmarks: any;
interface HolisticResults {
  poseLandmarks?: any;
  leftHandLandmarks?: any;
  rightHandLandmarks?: any;
}
interface SkeletonColors {
  pose: {
    line: string;
    point: string;
  };
  hand: {
    line: string;
    point: string;
  };
}
const DEFAULT_COLORS: SkeletonColors = {
  pose: {
    line: "#00ffcc",
    point: "#ffcc00",
  },
  hand: {
    line: "#00ccff",
    point: "#ff00cc",
  },
};
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  results: HolisticResults,
  colors: SkeletonColors = DEFAULT_COLORS,
): void {
  if (results.poseLandmarks) {
    drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {
      lineWidth: 4,
      color: colors.pose.line,
    });
    drawLandmarks(ctx, results.poseLandmarks, {
      radius: 3,
      color: colors.pose.point,
    });
  }
  if (results.leftHandLandmarks) {
    drawConnectors(ctx, results.leftHandLandmarks, HAND_CONNECTIONS, {
      lineWidth: 3,
      color: colors.hand.line,
    });
    drawLandmarks(ctx, results.leftHandLandmarks, {
      radius: 4,
      color: colors.hand.point,
    });
  }
  if (results.rightHandLandmarks) {
    drawConnectors(ctx, results.rightHandLandmarks, HAND_CONNECTIONS, {
      lineWidth: 3,
      color: colors.hand.line,
    });
    drawLandmarks(ctx, results.rightHandLandmarks, {
      radius: 4,
      color: colors.hand.point,
    });
  }
}
