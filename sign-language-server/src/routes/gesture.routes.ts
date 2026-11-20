import { Router, type NextFunction, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import multer from "multer";
import prisma from "../config/prisma";
import { clearStatsCache } from "./recognition.routes";
import { generalLimiter, uploadLimiter } from "../middleware/rateLimiters";
import {
  buildGlobalStats,
  buildWordStats,
  dtwDistance,
} from "../lib/gestureStats";
import { RECOGNITION_CONFIG } from "../config/recognitionConfig";
import { authenticate, requireRole } from "../middleware/auth.middleware";
import { PRIVATE_BUCKET, putObject, signHandCropUrl } from "../config/storage";
import { parseJsonField } from "../utils/jsonField";
import {
  normalizeGestureKey,
  parseGestureTranslations,
  syncGestureRegistry,
} from "../utils/gestureRegistry";
import {
  hasIrregularWhitespace,
  sanitizeSignWord,
} from "../utils/signWordText";
import {
  parsePremadeGestureImport,
  type PremadeGestureInput,
} from "../utils/premadeGestureImport";

// Hand-crops live in a private bucket, so any gesture sent to the client
// gets its stored key swapped for a temporary readable (presigned) URL.
async function withSignedHandCrop<T extends { handCropUrl: string | null; features?: any; sequence?: any }>(
  gesture: T,
): Promise<T> {
  return {
    ...gesture,
    handCropUrl: await signHandCropUrl(gesture.handCropUrl),
    features: parseJsonField(gesture.features),
    sequence: parseJsonField(gesture.sequence),
  };
}
const router = Router();
router.use(generalLimiter);

const bulkGestureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!/\.(json|csv)$/i.test(file.originalname)) {
      callback(new Error("Only .json and .csv files are supported"));
      return;
    }
    callback(null, true);
  },
});
const parseBulkGestureFile = (req: Request, res: Response, next: NextFunction) => {
  bulkGestureUpload.single("file")(req, res, (error) => {
    if (error) {
      return res
        .status(
          error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
            ? 413
            : 400,
        )
        .json({ success: false, error: error.message });
    }
    return next();
  });
};

router.post(
  "/bulk",
  uploadLimiter,
  authenticate,
  requireRole("ADMIN"),
  parseBulkGestureFile,
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "Select a .json or .csv file to import",
      });
    }
    let rows: Array<
      PremadeGestureInput & {
        wordKey: string;
        translations: Record<string, string>;
      }
    > = [];
    try {
      const entries = parsePremadeGestureImport(
        req.file.originalname,
        req.file.buffer.toString("utf8"),
      );
      if (entries.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Import file must include at least one gesture",
        });
      }
      rows = entries.map((entry) => {
        const wordKey = normalizeGestureKey(entry.gestureLabel);
        if (!wordKey) {
          throw new Error(`Invalid gesture label "${entry.gestureLabel}"`);
        }
        return {
          ...entry,
          wordKey,
          translations: {
            English: entry.englishWord,
            Tagalog: entry.tagalogWord,
            Cebuano: entry.cebuanoWord,
          },
        };
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Invalid import file",
      });
    }
    const keys = rows.map((row) => row.wordKey);
    if (new Set(keys).size !== keys.length) {
      return res.status(400).json({
        success: false,
        error: "The import contains duplicate gesture labels",
      });
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.gesture.createMany({
          data: rows.map((row) => ({
            word: row.gestureLabel,
            wordKey: row.wordKey,
            language: "English",
            translations: row.translations,
            aliases: [
              ...new Set(
                [
                  row.gestureLabel,
                  row.englishWord,
                  row.tagalogWord,
                  row.cebuanoWord,
                ].filter(Boolean),
              ),
            ],
            landmarks: row.landmarks,
          })),
          skipDuplicates: true,
        });
        const registered = await tx.gesture.findMany({
          where: { wordKey: { in: keys } },
          select: {
            id: true,
            wordKey: true,
            aliases: true,
            translations: true,
          },
        });
        const byKey = new Map(registered.map((gesture) => [gesture.wordKey, gesture]));

        for (const row of rows) {
          const current = byKey.get(row.wordKey);
          if (!current) continue;
          const existingTranslations = parseGestureTranslations(
            current.translations,
          );
          await tx.gesture.update({
            where: { id: current.id },
            data: {
              translations: {
                ...existingTranslations,
                ...Object.fromEntries(
                  Object.entries(row.translations).filter(([, value]) => value),
                ),
              },
              aliases: [
                ...new Set([
                  ...current.aliases,
                  row.gestureLabel,
                  row.englishWord,
                  row.tagalogWord,
                  row.cebuanoWord,
                ].filter(Boolean)),
              ],
              landmarks: row.landmarks,
            },
          });
        }

        const assets = rows.flatMap((row) => {
          const gesture = byKey.get(row.wordKey);
          return row.imageUrl && gesture
            ? [{
                gestureId: gesture.id,
                word: row.gestureLabel,
                file: row.imageUrl,
                type: "image",
                isPublished: true,
              }]
            : [];
        });
        if (assets.length > 0) {
          const existingAssets = await tx.signAsset.findMany({
            where: {
              gestureId: { in: assets.map((asset) => asset.gestureId) },
              file: { in: assets.map((asset) => asset.file) },
            },
            select: { gestureId: true, file: true },
          });
          const existingKeys = new Set(
            existingAssets.map((asset) => `${asset.gestureId}:${asset.file}`),
          );
          const newAssets = assets.filter(
            (asset) => !existingKeys.has(`${asset.gestureId}:${asset.file}`),
          );
          if (newAssets.length > 0) {
            await tx.signAsset.createMany({ data: newAssets, skipDuplicates: true });
          }
        }
        return { imported: rows.length, assets: assets.length };
      });
      clearStatsCache();
      return res.status(201).json({ success: true, ...result });
    } catch (error) {
      console.error("Bulk gesture import failed:", error);
      return res.status(500).json({
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to import gestures",
      });
    }
  },
);

router.get("/templates", authenticate, async (_req, res) => {
  try {
    const templates = await prisma.gesture.findMany({
      where: { isActive: true, landmarks: { not: Prisma.DbNull } },
      select: {
        id: true,
        word: true,
        aliases: true,
        translations: true,
        landmarks: true,
      },
    });
    return res.json({ success: true, templates });
  } catch (error) {
    console.error("Could not load hand landmark templates:", error);
    return res.status(500).json({
      success: false,
      error: "Could not load hand landmark templates",
    });
  }
});

// Phase 2 of the CNN plan: gestureType is a per-WORD decision, not
// per-recording — fusion later gates on it per word, so every recording
// of the same word must agree. Normalizes casing (recorder UI and bulk
// ingest have historically disagreed — "DYNAMIC" vs "dynamic") and
// rejects anything that isn't one of the two known values.
type GestureType = "static" | "dynamic";
function normalizeGestureType(value: unknown): GestureType | null {
  const lowered = String(value ?? "").toLowerCase();
  return lowered === "static" || lowered === "dynamic" ? lowered : null;
}

// Hand-crop images are small (224x224 JPEGs, ~10-30KB) — 2MB is generous
// headroom, not a real limit we expect to hit.
const MAX_HAND_CROP_BYTES = 2 * 1024 * 1024;
const handCropUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_HAND_CROP_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Only image files are allowed"));
      return;
    }
    cb(null, true);
  },
});
// Uploads a single cropped hand-shape image captured mid-recording, used
// later to train the CNN hand-shape classifier (Phase 1 of CNN integration).
// Returns the object key (private bucket) so it can be attached to the gesture record in the
// POST "/" call below. Teacher or Admin only, same as gesture creation.
router.post(
  "/hand-crop",
  uploadLimiter,
  authenticate,
  requireRole("TEACHER", "ADMIN"),
  handCropUpload.single("file"),
  async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({
          success: false,
          error: "No image uploaded",
        });
      }
      const objectKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      await putObject(PRIVATE_BUCKET, objectKey, file.buffer, file.mimetype);
      // Private bucket: return the key, not a URL. Readers sign it on demand.
      return res.json({
        success: true,
        url: objectKey,
      });
    } catch (err) {
      console.error("Hand-crop upload error:", err);
      return res.status(500).json({
        success: false,
        error: "Upload failed",
      });
    }
  },
);

// Recording a new gesture — Teacher or Admin only.
router.post("/", authenticate, requireRole("TEACHER", "ADMIN"), async (req, res) => {
  try {
    const {
      word,
      language = "FSL",
      gestureType: rawGestureType = "dynamic",
      features,
      sequence = [],
      frameCount = 0,
      description = "",
      handCropUrl,
      translations: rawTranslations,
      aliases: rawAliases,
    } = req.body;
    if (!word || typeof word !== "string" || !word.trim()) {
      return res.status(400).json({
        success: false,
        error: "Word is required",
      });
    }
    if (!normalizeGestureKey(word)) {
      return res.status(400).json({
        success: false,
        error: "Word must contain at least one letter or number",
      });
    }
    if (typeof language !== "string" || !language.trim()) {
      return res.status(400).json({
        success: false,
        error: "Language is required",
      });
    }
    const normalizedLanguage = language.trim();
    if (!features || typeof features !== "object") {
      return res.status(400).json({
        success: false,
        error: "Features are required",
      });
    }
    if (handCropUrl !== undefined && typeof handCropUrl !== "string") {
      return res.status(400).json({
        success: false,
        error: "handCropUrl must be a string",
      });
    }
    if (
      rawAliases !== undefined &&
      (!Array.isArray(rawAliases) ||
        rawAliases.some((alias: unknown) => typeof alias !== "string"))
    ) {
      return res.status(400).json({
        success: false,
        error: "aliases must be an array of strings",
      });
    }
    const gestureType = normalizeGestureType(rawGestureType);
    if (!gestureType) {
      return res.status(400).json({
        success: false,
        error: 'gestureType must be "static" or "dynamic"',
      });
    }
    const trimmedWord = word.trim();
    const existingForWord = await prisma.signGesture.findFirst({
      where: { word: trimmedWord, isActive: true },
      select: { gestureType: true },
    });
    if (
      existingForWord &&
      normalizeGestureType(existingForWord.gestureType) !== gestureType
    ) {
      return res.status(409).json({
        success: false,
        error: `"${trimmedWord}" already has recordings saved as "${normalizeGestureType(existingForWord.gestureType)}" — a word can't mix static and dynamic recordings.`,
      });
    }
    const gesture = await prisma.$transaction(async (tx) => {
      const registryEntry = await syncGestureRegistry(tx, {
        word: trimmedWord,
        language: normalizedLanguage,
        aliases: rawAliases,
        translations: parseGestureTranslations(rawTranslations),
      });
      return tx.signGesture.create({
        data: {
          word: trimmedWord,
          language: normalizedLanguage,
          gestureType,
          features,
          sequence,
          frameCount,
          description,
          handCropUrl: handCropUrl || null,
          gestureId: registryEntry.id,
        },
      });
    });
    clearStatsCache();
    return res.status(201).json({
      success: true,
      gesture: await withSignedHandCrop(gesture),
    });
  } catch (err: any) {
    console.error("Gesture save error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to save gesture",
    });
  }
});
// Runs during recording to flag an outlier take — Teacher or Admin only.
router.post("/consistency-check", authenticate, requireRole("TEACHER", "ADMIN"), async (req, res) => {
  // Timing instrumentation — see gesture-save latency investigation. Logs
  // to the server console (visible in Render logs) so a slow request can be
  // attributed to the DB round-trip vs. the DTW computation, since those
  // would need different fixes (a query/index issue vs. an algorithm one).
  const requestStart = Date.now();
  try {
    const { word, sequence } = req.body;
    if (!word || typeof word !== "string" || !word.trim()) {
      return res.status(400).json({
        success: false,
        error: "Word is required",
      });
    }
 
    const dbStart = Date.now();
    // Most consistency checks are for short/static recordings. Fetch only the
    // gesture type first so these requests never transfer stored JSON sequences.
    const existingGesture = await prisma.signGesture.findFirst({
      where: {
        word: word.trim(),
        isActive: true,
      },
      select: {
        gestureType: true,
      },
    });
    const existingGestureType = existingGesture
      ? normalizeGestureType(existingGesture.gestureType)
      : null;

    // Short recordings only need the existing type for frontend validation.
    if (!Array.isArray(sequence) || sequence.length < 4) {
      console.log(
        `[consistency-check-timing] word="${word.trim()}" rows=0 db=${Date.now() - dbStart}ms dtw=0ms total=${Date.now() - requestStart}ms`,
      );
      return res.json({
        success: true,
        isOutlier: false,
        reason: "sequence_too_short",
        existingGestureType,
      });
    }

    // Dynamic recordings still need full templates for DTW outlier checking.
    const existingRows = await prisma.signGesture.findMany({
      where: {
        word: word.trim(),
        isActive: true,
      },
      select: {
        word: true,
        features: true,
        sequence: true,
        gestureType: true,
      },
    });
    const dbMs = Date.now() - dbStart;
    const dtwStart = Date.now();
    const globalStats = buildGlobalStats(existingRows);
    const stats = buildWordStats(word.trim(), existingRows, globalStats);
    const candidateFrames = sequence.map((f: any) => f.features ?? f);
    let minDistance = Infinity;
    for (const stored of stats.sequences) {
      const d = dtwDistance(
        candidateFrames,
        stored,
        stats,
        globalStats,
        minDistance,
      );
      if (d < minDistance) minDistance = d;
    }
    const dtwMs = Date.now() - dtwStart;
    console.log(
      `[consistency-check-timing] word="${word.trim()}" rows=${existingRows.length} db=${dbMs}ms dtw=${dtwMs}ms total=${Date.now() - requestStart}ms`,
    );
    const tolerance = Math.max(
      stats.maxInternalDistance *
        RECOGNITION_CONFIG.INTERNAL_DISTANCE_MULTIPLIER,
      RECOGNITION_CONFIG.MIN_EFFECTIVE_LIMIT,
    );
    const isOutlier = Number.isFinite(minDistance) && minDistance > tolerance;
    return res.json({
      success: true,
      isOutlier,
      distance: Number.isFinite(minDistance)
        ? Math.round(minDistance * 10) / 10
        : null,
      existingSpread: Math.round(stats.maxInternalDistance * 10) / 10,
      existingGestureType,
    });
  } catch (err) {
    console.error("Consistency check error:", err);
    return res.json({
      success: true,
      isOutlier: false,
      reason: "check_failed",
    });
  }
});
router.get("/dataset/export/ml", authenticate, requireRole("TEACHER", "ADMIN"), async (_, res) => {
  try {
    const gestures = await prisma.signGesture.findMany({
      where: {
        isActive: true,
      },
      select: {
      word: true,
      features: true,
      sequence: true,
    },
    });
    const dataset = gestures.flatMap((gesture) => {
      const seq = parseJsonField<any[]>(gesture.sequence);
      const feats = parseJsonField<any>(gesture.features);
      if (Array.isArray(seq) && seq.length > 0) {
        return seq.map((frame: any, idx: number) => ({
          word: gesture.word,
          frame_index: idx,
          ...(typeof frame === "object" &&
          frame !== null &&
          typeof frame.features === "object"
            ? frame.features
            : typeof frame === "object" && frame !== null
              ? frame
              : {}),
        }));
      }
      return [
        {
          word: gesture.word,
          frame_index: 0,
          ...(typeof feats === "object" && feats !== null
            ? feats
            : {}),
        },
      ];
    });
    res.json({
      success: true,
      total_samples: dataset.length,
      total_gestures: gestures.length,
      dataset,
    });
  } catch (err) {
    console.error("ML export error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to export dataset",
    });
  }
});
function parseGestureId(rawId: string | string[] | undefined): number | null {
  if (Array.isArray(rawId)) rawId = rawId[0];
  if (rawId === undefined) return null;
  const id = Number(rawId);
  return Number.isInteger(id) ? id : null;
}
// Dashboard view for Teacher/Admin: what's actually been recorded so far,
// grouped by word — so recording progress is visible without having to
// export the raw dataset. Registered before "/:id" since "summary" would
// otherwise be swallowed by that single-segment param route.
router.get("/library", authenticate, async (_req, res) => {
  try {
    const gestures = await prisma.signGesture.findMany({
      where: { isActive: true },
      select: {
        word: true,
        gestureType: true,
        handCropUrl: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    const byWord = new Map<
      string,
      {
        word: string;
        gestureType: string;
        count: number;
        handCropUrl: string | null;
      }
    >();
    for (const gesture of gestures) {
      const key = gesture.word.trim().toLocaleLowerCase();
      const existing = byWord.get(key);
      if (!existing) {
        byWord.set(key, {
          word: gesture.word,
          gestureType: gesture.gestureType,
          count: 1,
          handCropUrl: gesture.handCropUrl,
        });
        continue;
      }
      existing.count += 1;
      if (!existing.handCropUrl && gesture.handCropUrl) {
        existing.handCropUrl = gesture.handCropUrl;
      }
    }
    let handCropWarning = false;
    const words = await Promise.all(
      Array.from(byWord.values())
        .sort((left, right) => left.word.localeCompare(right.word))
        .map(async (word) => {
          try {
            return {
              ...word,
              handCropUrl: await signHandCropUrl(word.handCropUrl),
            };
          } catch (error) {
            handCropWarning = true;
            console.error(
              `Could not sign the hand-crop image for registered sign "${word.word}":`,
              error,
            );
            return { ...word, handCropUrl: null };
          }
        }),
    );
    res.json({
      success: true,
      words,
      ...(handCropWarning
        ? { warning: "Some registered-gesture images are unavailable." }
        : {}),
    });
  } catch (error) {
    console.error("Gesture library error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to load registered gestures",
    });
  }
});
router.get(
  "/health-check",
  authenticate,
  requireRole("ADMIN"),
  async (_req, res) => {
    try {
      const gestures = await prisma.signGesture.findMany({
        where: { isActive: true },
        select: { id: true, word: true, language: true },
      });
      const flaggedByWord = new Map<
        string,
        {
          id: number;
          word: string;
          language: string;
          cleaned: string;
          count: number;
        }
      >();
      for (const gesture of gestures) {
        if (!hasIrregularWhitespace(gesture.word)) continue;
        const key = `${gesture.word}\u0000${gesture.language}`;
        const flagged = flaggedByWord.get(key);
        if (flagged) {
          flagged.count += 1;
        } else {
          flaggedByWord.set(key, {
            id: gesture.id,
            word: gesture.word,
            language: gesture.language,
            cleaned: sanitizeSignWord(gesture.word),
            count: 1,
          });
        }
      }
      const flagged = Array.from(flaggedByWord.values()).sort((a, b) =>
        a.word.localeCompare(b.word),
      );
      return res.json({
        success: true,
        totalChecked: gestures.length,
        flaggedCount: flagged.length,
        flagged,
      });
    } catch (error) {
      console.error("Recorded gesture health check failed:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to run recorded gesture health check",
      });
    }
  },
);

router.get(
  "/summary",
  authenticate,
  requireRole("TEACHER", "ADMIN"),
  async (_req, res) => {
    try {
      const gestures = await prisma.signGesture.findMany({
        where: { isActive: true },
        select: {
          word: true,
          language: true,
          gestureType: true,
          handCropUrl: true,
          createdAt: true,
        },
        orderBy: { word: "asc" },
      });
      const byWord = new Map<
        string,
        {
          word: string;
          language: string;
          gestureType: string;
          count: number;
          handCropUrl: string | null;
          lastRecordedAt: Date;
        }
      >();
      for (const g of gestures) {
        const key = `${g.word}::${g.language}`;
        const existing = byWord.get(key);
        if (!existing) {
          byWord.set(key, {
            word: g.word,
            language: g.language,
            gestureType: g.gestureType,
            count: 1,
            handCropUrl: g.handCropUrl,
            lastRecordedAt: g.createdAt,
          });
          continue;
        }
        existing.count += 1;
        if (g.createdAt > existing.lastRecordedAt) {
          existing.lastRecordedAt = g.createdAt;
        }
        // Prefer the most recently-captured crop for the thumbnail.
        if (g.handCropUrl && g.createdAt >= existing.lastRecordedAt) {
          existing.handCropUrl = g.handCropUrl;
        }
      }
      const summary = Array.from(byWord.values()).sort((a, b) =>
        a.word.localeCompare(b.word),
      );
      let handCropWarning = false;
      const words = await Promise.all(
        summary.map(async (w) => {
          try {
            return {
              ...w,
              handCropUrl: await signHandCropUrl(w.handCropUrl),
            };
          } catch (error) {
            handCropWarning = true;
            console.error(
              `Could not sign the hand-crop image for recorded sign "${w.word}":`,
              error,
            );
            return { ...w, handCropUrl: null };
          }
        }),
      );
      res.json({
        success: true,
        words,
        ...(handCropWarning
          ? {
              warning:
                "Some recorded-sign thumbnails are unavailable. Configure object storage to display them.",
            }
          : {}),
      });
    } catch (err) {
      console.error("Gesture summary error:", err);
      res.status(500).json({
        success: false,
        error: "Failed to load recorded signs",
      });
    }
  },
);
// Viewing a single recorded gesture (e.g. its image/sequence) — Teacher or Admin.
router.get("/:id", authenticate, requireRole("TEACHER", "ADMIN"), async (req, res) => {
  try {
    const id = parseGestureId(req.params.id);
    if (id === null) {
      return res.status(400).json({
        success: false,
        error: "Invalid gesture id",
      });
    }
    const gesture = await prisma.signGesture.findUnique({
      where: {
        id,
      },
    });
    if (!gesture) {
      return res.status(404).json({
        success: false,
        error: "Gesture not found",
      });
    }
    return res.json({
      success: true,
      gesture: await withSignedHandCrop(gesture),
    });
  } catch (err) {
    console.error("Gesture fetch error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch gesture",
    });
  }
});
const UPDATABLE_GESTURE_FIELDS = [
  "word",
  "language",
  "gestureType",
  "features",
  "sequence",
  "frameCount",
  "description",
  "isActive",
  // Attached after the fact by the background hand-crop upload (see
  // uploadAndAttachHandCrop in AdminSignRecorder.tsx) — the gesture record
  // is saved immediately after recording, and the crop image is patched in
  // once its upload finishes, so save no longer waits on it.
  "handCropUrl",
] as const;
function pickUpdatableFields(body: Record<string, any>): Record<string, any> {
  const data: Record<string, any> = {};
  for (const key of UPDATABLE_GESTURE_FIELDS) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  return data;
}
// Editing an existing gesture — Teacher or Admin (delete is Admin-only, below).
router.put("/:id", authenticate, requireRole("TEACHER", "ADMIN"), async (req, res) => {
  try {
    const id = parseGestureId(req.params.id);
    if (id === null) {
      return res.status(400).json({
        success: false,
        error: "Invalid gesture id",
      });
    }
    const data = pickUpdatableFields(req.body ?? {});
    if (Object.keys(data).length === 0) {
      return res.status(400).json({
        success: false,
        error: "No updatable fields provided",
      });
    }
    if (data.handCropUrl !== undefined && typeof data.handCropUrl !== "string") {
      return res.status(400).json({
        success: false,
        error: "handCropUrl must be a string",
      });
    }
    if (data.gestureType !== undefined) {
      const normalized = normalizeGestureType(data.gestureType);
      if (!normalized) {
        return res.status(400).json({
          success: false,
          error: 'gestureType must be "static" or "dynamic"',
        });
      }
      data.gestureType = normalized;
      const current = await prisma.signGesture.findUnique({
        where: { id },
        select: { word: true },
      });
      const word = data.word ?? current?.word;
      if (word) {
        // Compare via normalizeGestureType rather than a raw DB equality
        // check — some rows predate the casing fix below and are stored
        // as "DYNAMIC"/"STATIC", which would otherwise look like a false
        // conflict against the now-lowercase value.
        const siblings = await prisma.signGesture.findMany({
          where: { word, isActive: true, id: { not: id } },
          select: { gestureType: true },
        });
        const conflicting = siblings.some(
          (s) => normalizeGestureType(s.gestureType) !== normalized,
        );
        if (conflicting) {
          return res.status(409).json({
            success: false,
            error: `Other active recordings of "${word}" use a different gestureType — a word can't mix static and dynamic recordings.`,
          });
        }
      }
    }
    const gesture = await prisma.$transaction(async (tx) => {
      if (typeof data.word === "string" && data.word.trim()) {
        const current = await tx.signGesture.findUnique({
          where: { id },
          select: { language: true },
        });
        const registryEntry = await syncGestureRegistry(tx, {
          word: data.word,
          language: data.language ?? current?.language,
        });
        data.gestureId = registryEntry.id;
      }
      return tx.signGesture.update({
        where: { id },
        data,
      });
    });
    // Rebuild recognition statistics only when recognition data changes.
    const recognitionFields = [
      "word",
      "gestureType",
      "features",
      "sequence",
      "isActive",
    ];

    if (recognitionFields.some((field) => data[field] !== undefined)) {
      clearStatsCache();
    }
    return res.json({
      success: true,
      gesture: await withSignedHandCrop(gesture),
    });
  } catch (err) {
    console.error("Gesture update error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to update gesture",
    });
  }
});


router.delete(
  "/by-word/:word",
  authenticate,
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const  word  = Array.isArray(req.params.word) ? req.params.word[0] : req.params.word;
        if (!word){
          return res.status(400).json({success: false, error: "Word is required"});
        }
      const language = (req.query.language as string) || undefined;
      const result = await prisma.signGesture.updateMany({
          where: {
            word,
            ...(language ? { language } : {}),
            isActive: true,
          },
          data: { isActive: false },
        });

        if (result.count > 0) {
          clearStatsCache();
        }
        return res.json({ success: true, message: "Word deleted" });
    } catch (err) {
      console.error("Gesture word delete error:", err);
      return res.status(500).json({
        success: false,
        error: "Failed to delete word",
      });
    }
  },
);

router.patch(
  "/by-word/:word/word",
  authenticate,
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const rawWord = Array.isArray(req.params.word)
        ? req.params.word[0]
        : req.params.word;
      if (!rawWord) {
        return res.status(400).json({
          success: false,
          error: "Word is required",
        });
      }
      const language =
        typeof req.query.language === "string"
          ? req.query.language.trim()
          : undefined;
      const existing = await prisma.signGesture.findMany({
        where: {
          word: rawWord,
          ...(language ? { language } : {}),
          isActive: true,
        },
        select: { language: true },
      });
      if (existing.length === 0) {
        return res.status(404).json({
          success: false,
          error: "No active recordings found for this word",
        });
      }

      const cleaned = sanitizeSignWord(rawWord);
      let updatedCount = 0;
      await prisma.$transaction(async (tx) => {
        for (const currentLanguage of new Set(
          existing.map((gesture) => gesture.language),
        )) {
          const registryEntry = await syncGestureRegistry(tx, {
            word: cleaned,
            language: currentLanguage,
          });
          const updated = await tx.signGesture.updateMany({
            where: {
              word: rawWord,
              language: currentLanguage,
              isActive: true,
            },
            data: {
              word: cleaned,
              gestureId: registryEntry.id,
            },
          });
          updatedCount += updated.count;
        }
      });
      clearStatsCache();
      return res.json({
        success: true,
        word: cleaned,
        updated: updatedCount,
      });
    } catch (error) {
      console.error("Recorded gesture word cleanup failed:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to clean up recorded gesture word",
      });
    }
  },
);

router.get("/dataset/export/all", authenticate, requireRole("TEACHER", "ADMIN"), async (_, res) => {
  try {
    const gestures = await prisma.signGesture.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        word: true,
        language: true,
        features: true,
        sequence: true,
        frameCount: true,
      },
    });
    return res.json({
      success: true,
      total: gestures.length,
      dataset: gestures,
    });
  } catch (err) {
    console.error("Full export error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to export dataset",
    });
  }
});
// Note: the old "/dataset/export/hand-crops" route was removed here — it
// existed solely to feed ml-training/export_dataset.py (the CNN training
// pipeline), which has been retired now that static-word recognition uses
// frameScore (landmark distance) instead of an image-based CNN. handCropUrl
// itself is still captured/stored/displayed (see AdminSigns.tsx admin
// thumbnail preview) — only this CNN-specific export endpoint was dead.
export default router;