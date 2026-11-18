export type LandmarkPoint = { x: number; y: number; z: number };

export type PremadeGestureInput = {
  gestureLabel: string;
  englishWord: string;
  tagalogWord: string;
  cebuanoWord: string;
  landmarks: LandmarkPoint[];
  imageUrl?: string;
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field");
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function parseLandmarks(value: unknown): LandmarkPoint[] {
  let landmarks = value;
  if (typeof landmarks === "string") {
    try {
      landmarks = JSON.parse(landmarks);
    } catch {
      throw new Error("Each landmarks cell must contain valid JSON");
    }
  }
  if (
    !Array.isArray(landmarks) ||
    landmarks.length !== 21 ||
    !landmarks.every(
      (point) =>
        point !== null &&
        typeof point === "object" &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        Number.isFinite(point.z),
    )
  ) {
    throw new Error("Each gesture must contain exactly 21 finite x/y/z landmarks");
  }
  return landmarks;
}

function validateEntries(value: unknown): PremadeGestureInput[] {
  const source =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "gestures" in value
      ? (value as { gestures: unknown }).gestures
      : value;
  if (!Array.isArray(source)) {
    throw new Error("Import must contain an array of gesture entries");
  }
  if (source.length > 1000) {
    throw new Error("A single import is limited to 1000 gestures");
  }
  return source.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Gesture at row ${index + 1} must be an object`);
    }
    const record = entry as Record<string, unknown>;
    const fields = ["gestureLabel", "englishWord", "tagalogWord", "cebuanoWord"];
    if (
      fields.some(
        (field) =>
          typeof record[field] !== "string" ||
          (field === "gestureLabel" && !(record[field] as string).trim()),
      )
    ) {
      throw new Error(
        `Gesture at row ${index + 1} must include gestureLabel and language words as strings`,
      );
    }
    if (
      record.imageUrl !== undefined &&
      record.imageUrl !== "" &&
      (typeof record.imageUrl !== "string" ||
        !/^https?:\/\//i.test(record.imageUrl))
    ) {
      throw new Error(`Gesture at row ${index + 1} has an invalid imageUrl`);
    }
    return {
      gestureLabel: (record.gestureLabel as string).trim(),
      englishWord: (record.englishWord as string).trim(),
      tagalogWord: (record.tagalogWord as string).trim(),
      cebuanoWord: (record.cebuanoWord as string).trim(),
      landmarks: parseLandmarks(record.landmarks),
      ...(record.imageUrl ? { imageUrl: record.imageUrl as string } : {}),
    };
  });
}

export function parsePremadeGestureImport(
  fileName: string,
  content: string,
): PremadeGestureInput[] {
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Import file contains invalid JSON");
    }
    return validateEntries(parsed);
  }
  if (extension !== "csv") {
    throw new Error("Only .json and .csv imports are supported");
  }
  const rows = parseCsv(content);
  if (rows.length === 0) throw new Error("CSV file is empty");
  const headers = rows[0].map((header) => header.trim());
  const requiredHeaders = [
    "gestureLabel",
    "englishWord",
    "tagalogWord",
    "cebuanoWord",
    "landmarks",
  ];
  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new Error(`CSV is missing required columns: ${missing.join(", ")}`);
  }
  const entries = rows.slice(1).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])),
  );
  return validateEntries(entries);
}
