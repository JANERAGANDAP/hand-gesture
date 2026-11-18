import { readFile } from "fs/promises";
import path from "path";
import prisma from "../src/config/prisma";
import { normalizeGestureKey } from "../src/utils/gestureRegistry";

type Landmark = { x: number; y: number; z: number };
type PremadeGesture = {
  gestureLabel: string;
  englishWord: string;
  tagalogWord: string;
  cebuanoWord: string;
  landmarks: Landmark[];
  imageUrl?: string;
};

function isLandmarkArray(value: unknown): value is Landmark[] {
  return (
    Array.isArray(value) &&
    value.length === 21 &&
    value.every(
      (point) =>
        point !== null &&
        typeof point === "object" &&
        Number.isFinite((point as Landmark).x) &&
        Number.isFinite((point as Landmark).y) &&
        Number.isFinite((point as Landmark).z),
    )
  );
}

async function seed() {
  const filePath = path.resolve(__dirname, "../scripts/premade-gestures.json");
  const source: unknown = JSON.parse(await readFile(filePath, "utf8"));
  const entriesValue =
    source &&
    typeof source === "object" &&
    !Array.isArray(source) &&
    "gestures" in source
      ? (source as { gestures: unknown }).gestures
      : source;
  if (!Array.isArray(entriesValue)) {
    throw new Error("premade-gestures.json must contain a gestures array");
  }
  const entries = entriesValue as PremadeGesture[];
  for (const [index, entry] of entries.entries()) {
    if (
      !entry ||
      typeof entry.gestureLabel !== "string" ||
      !entry.gestureLabel.trim() ||
      typeof entry.englishWord !== "string" ||
      typeof entry.tagalogWord !== "string" ||
      typeof entry.cebuanoWord !== "string" ||
      !isLandmarkArray(entry.landmarks) ||
      (entry.imageUrl !== undefined &&
        (typeof entry.imageUrl !== "string" ||
          !/^https?:\/\//i.test(entry.imageUrl)))
    ) {
      throw new Error(`Invalid premade gesture at array index ${index}`);
    }
  }

  const rows = entries.map((entry) => {
    const translations = {
      English: entry.englishWord.trim(),
      Tagalog: entry.tagalogWord.trim(),
      Cebuano: entry.cebuanoWord.trim(),
    };
    const aliases = [
      ...new Set(
        [entry.gestureLabel.trim(), ...Object.values(translations)].filter(Boolean),
      ),
    ];
    return {
      word: entry.gestureLabel.trim(),
      wordKey: normalizeGestureKey(entry.gestureLabel),
      language: "English",
      translations,
      aliases,
      landmarks: entry.landmarks,
      imageUrl: entry.imageUrl,
    };
  });
  if (rows.some((row) => !row.wordKey)) {
    throw new Error("Gesture labels must contain a letter or number");
  }

  await prisma.$transaction(async (tx) => {
    if (rows.length > 0) {
      await tx.gesture.createMany({
        data: rows.map(({ imageUrl: _imageUrl, ...gesture }) => gesture),
        skipDuplicates: true,
      });
    }
    const keys = rows.map((row) => row.wordKey);
    const gestures = await tx.gesture.findMany({
      where: { wordKey: { in: keys } },
      select: { id: true, wordKey: true },
    });
    const idsByKey = new Map(gestures.map((gesture) => [gesture.wordKey, gesture.id]));

    for (const row of rows) {
      const gestureId = idsByKey.get(row.wordKey);
      if (gestureId === undefined) continue;
      await tx.gesture.update({
        where: { id: gestureId },
        data: {
          translations: row.translations,
          aliases: row.aliases,
          landmarks: row.landmarks,
        },
      });
    }

    const requestedAssets = rows.flatMap((row) => {
      const gestureId = idsByKey.get(row.wordKey);
      return row.imageUrl && gestureId !== undefined
        ? [{ gestureId, word: row.word, file: row.imageUrl, type: "image" }]
        : [];
    });
    if (requestedAssets.length > 0) {
      const existing = await tx.signAsset.findMany({
        where: { file: { in: requestedAssets.map((asset) => asset.file) } },
        select: { gestureId: true, file: true },
      });
      const existingKeys = new Set(
        existing.map((asset) => `${asset.gestureId}:${asset.file}`),
      );
      const newAssets = requestedAssets.filter(
        (asset) => !existingKeys.has(`${asset.gestureId}:${asset.file}`),
      );
      if (newAssets.length > 0) {
        await tx.signAsset.createMany({ data: newAssets, skipDuplicates: true });
      }
    }
  });
  console.log(`Seeded ${rows.length} premade gesture entries.`);
}

seed()
  .catch((error) => {
    console.error("Premade gesture seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
