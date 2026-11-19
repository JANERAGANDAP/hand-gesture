interface HolisticResults {
  poseLandmarks?: any;
  leftHandLandmarks?: any;
  rightHandLandmarks?: any;
  faceLandmarks?: any;
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
const HAND_BONES = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
] as const;
const UPPER_BODY_CONNECTIONS = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
] as const;
const FACE_PATHS = [
  [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10],
  [33, 160, 158, 133, 153, 144, 33],
  [362, 385, 387, 263, 373, 380, 362],
  [105, 66, 107, 55],
  [334, 296, 336, 285],
  [1, 2, 98, 97, 2],
  [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291],
  [13, 312, 311, 310, 415, 308, 291],
] as const;

function drawHand(
  ctx: CanvasRenderingContext2D,
  landmarks: any[],
  colors: SkeletonColors["hand"],
): void {
  if (!Array.isArray(landmarks) || landmarks.length !== 21) return;
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  ctx.lineWidth = Math.max(3, width / 220);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = colors.line;
  ctx.shadowColor = "#0f172a";
  ctx.shadowBlur = 5;

  for (const [fromIndex, toIndex] of HAND_BONES) {
    const from = landmarks[fromIndex];
    const to = landmarks[toIndex];
    if (
      !from ||
      !to ||
      !Number.isFinite(from.x) ||
      !Number.isFinite(from.y) ||
      !Number.isFinite(to.x) ||
      !Number.isFinite(to.y)
    ) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(from.x * width, from.y * height);
    ctx.lineTo(to.x * width, to.y * height);
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
  for (const point of landmarks) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
    ctx.beginPath();
    ctx.arc(
      point.x * width,
      point.y * height,
      Math.max(4, width / 150),
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = "#f8fafc";
    ctx.fill();
    ctx.lineWidth = Math.max(2, width / 320);
    ctx.strokeStyle = colors.line;
    ctx.stroke();
  }
}

function drawConnections(
  ctx: CanvasRenderingContext2D,
  landmarks: any[],
  connections: ReadonlyArray<readonly [number, number]>,
  color: string,
  lineWidth: number,
  pointRadius: number,
): void {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const visiblePoints = new Set<number>();
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "#0f172a";
  ctx.shadowBlur = 4;

  for (const [fromIndex, toIndex] of connections) {
    const from = landmarks[fromIndex];
    const to = landmarks[toIndex];
    if (
      !from ||
      !to ||
      !Number.isFinite(from.x) ||
      !Number.isFinite(from.y) ||
      !Number.isFinite(to.x) ||
      !Number.isFinite(to.y)
    ) {
      continue;
    }
    ctx.moveTo(from.x * width, from.y * height);
    ctx.lineTo(to.x * width, to.y * height);
    visiblePoints.add(fromIndex);
    visiblePoints.add(toIndex);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  for (const index of visiblePoints) {
    const point = landmarks[index];
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, pointRadius, 0, Math.PI * 2);
    ctx.fillStyle = "#f8fafc";
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, lineWidth / 2);
    ctx.strokeStyle = color;
    ctx.stroke();
  }
}

function drawFace(ctx: CanvasRenderingContext2D, landmarks: any[]): void {
  if (!Array.isArray(landmarks) || landmarks.length < 468) return;
  const connections = FACE_PATHS.flatMap((path) =>
    path.slice(1).map((point, index) => [path[index], point] as const),
  );
  drawConnections(ctx, landmarks, connections, "#fbbf24", 1.5, 2.5);
}

export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  results: HolisticResults,
  colors: SkeletonColors = DEFAULT_COLORS,
): void {
  if (Array.isArray(results.poseLandmarks)) {
    drawConnections(
      ctx,
      results.poseLandmarks,
      UPPER_BODY_CONNECTIONS,
      colors.pose.line,
      4,
      4,
    );
  }
  if (Array.isArray(results.faceLandmarks)) {
    drawFace(ctx, results.faceLandmarks);
  }
  if (results.leftHandLandmarks) {
    drawHand(ctx, results.leftHandLandmarks, colors.hand);
  }
  if (results.rightHandLandmarks) {
    drawHand(ctx, results.rightHandLandmarks, colors.hand);
  }
}
