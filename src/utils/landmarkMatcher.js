function normalizeLandmarks(points) {
  if (!Array.isArray(points) || points.length !== 21) return null;
  const coordinates = points.map((point) => [
    Number(point?.x),
    Number(point?.y),
    Number(point?.z),
  ]);
  if (coordinates.some((point) => point.some((value) => !Number.isFinite(value)))) {
    return null;
  }
  const origin = coordinates[0];
  const middleBase = coordinates[9];
  const scale = Math.hypot(
    middleBase[0] - origin[0],
    middleBase[1] - origin[1],
    middleBase[2] - origin[2],
  );
  if (scale < 1e-6) return null;
  return coordinates.map((point) =>
    point.map((value, axis) => (value - origin[axis]) / scale),
  );
}

function normalizedDistance(left, right) {
  let total = 0;
  for (let point = 0; point < 21; point += 1) {
    const dx = left[point][0] - right[point][0];
    const dy = left[point][1] - right[point][1];
    const dz = left[point][2] - right[point][2];
    total += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return total / 21;
}

export function matchLandmarkTemplate(points, templates, minimumConfidence = 0.82) {
  const normalized = normalizeLandmarks(points);
  if (!normalized || !Array.isArray(templates)) return null;

  let best = null;
  for (const template of templates) {
    const candidate = normalizeLandmarks(template?.landmarks);
    if (!candidate) continue;
    const distance = normalizedDistance(normalized, candidate);
    const confidence = Math.max(0, 1 - distance / 0.7);
    if (!best || confidence > best.confidence) {
      best = { word: template.word, confidence, distance };
    }
  }
  return best && best.confidence >= minimumConfidence ? best : null;
}
