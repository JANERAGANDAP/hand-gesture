import express from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import prisma from "../config/prisma";
import {
  PUBLIC_BUCKET,
  PRIVATE_BUCKET,
  SIGNS_PREFIX,
  putObject,
  getObject,
  deleteObjects,
  publicObjectUrl,
  keyFromUrl,
  usesObjectStorage,
} from "../config/storage";
import { uploadLimiter } from "../middleware/rateLimiters";
import { sanitizeSignWord, isSameSignWord } from "../utils/signWordText";
import {
  authenticate,
  requireRole,
  AuthedRequest,
} from "../middleware/auth.middleware";
import {
  normalizeGestureKey,
  parseGestureTranslations,
  syncGestureRegistry,
  type GestureTranslations,
} from "../utils/gestureRegistry";
const router = express.Router();
router.use(uploadLimiter);
const ALLOWED_MIME_TYPES = [
  "video/mp4",
  // In-browser MediaRecorder (used by the new "record a sign" flow in
  // SignLibraryModal.tsx) produces video/webm on Chrome/Firefox — Safari
  // records video/mp4 directly, which is already allowed above.
  "video/webm",
  "image/jpeg",
  "image/png",
  "image/webp",
];
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_CHUNK_SIZE_BYTES = 3 * 1024 * 1024;
const MAX_CHUNK_COUNT = Math.ceil(MAX_FILE_SIZE_BYTES / MAX_CHUNK_SIZE_BYTES);
const MIME_EXTENSIONS: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
function normalizeMimeType(value: string) {
  return value.split(";", 1)[0].trim().toLowerCase();
}
const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  if (!ALLOWED_MIME_TYPES.includes(normalizeMimeType(file.mimetype))) {
    cb(new Error("Only MP4 video or JPG/PNG/WEBP images are allowed"));
    return;
  }
  cb(null, true);
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
  },
  fileFilter,
});
const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_CHUNK_SIZE_BYTES,
  },
  fileFilter,
});
// multer's fileFilter/size-limit errors call next(err), which would
// otherwise fall through to Express's default HTML error page instead of
// a JSON response. This wraps upload.single("file") so those errors come
// back the same way every other error in this route does.
function handleUpload(
  fieldName: string,
  uploader = upload,
  maxFileSizeLabel = "25MB",
) {
  const middleware = uploader.single(fieldName);
  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    middleware(req, res, (err: unknown) => {
      if (err) {
        const message =
          err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
            ? `File is too large (${maxFileSizeLabel} max)`
            : err instanceof Error
              ? err.message
              : "Upload failed";
        return res.status(400).json({ error: message });
      }
      next();
    });
  };
}

function isUploadSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function stagingKey(userId: string | number, sessionId: string, part: number) {
  return `upload-staging/${userId}/${sessionId}/${part}`;
}

async function findDuplicate(word: string) {
  const existingSigns = await prisma.signAsset.findMany({
    select: { id: true, word: true },
  });
  return existingSigns.find((sign) => isSameSignWord(sign.word, word));
}

function parseTranslationsField(value: unknown): GestureTranslations | null {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (parsed === undefined) return {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (
    Object.values(parsed).some(
      (translation) =>
        typeof translation !== "string" || !translation.trim(),
    )
  ) {
    return null;
  }
  return parseGestureTranslations(parsed);
}

function parseAliasesField(value: unknown): string[] | null {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (parsed === undefined) return [];
  if (!Array.isArray(parsed) || parsed.some((alias) => typeof alias !== "string")) {
    return null;
  }
  return parsed.map((alias: string) => alias.trim()).filter(Boolean);
}

async function saveUploadedSign(
  word: string,
  language: string,
  fileType: string,
  fileKey: string,
  isPublished: boolean,
  translations: GestureTranslations = {},
  aliases: string[] = [],
) {
  const publicUrl = publicObjectUrl(PUBLIC_BUCKET, fileKey);
  const created = await prisma.$transaction(async (tx) => {
    const gesture = await syncGestureRegistry(tx, {
      word,
      language,
      translations,
      aliases,
    });
    const asset = await tx.signAsset.create({
      data: {
        word,
        file: publicUrl,
        type: fileType,
        isPublished,
        gestureId: gesture.id,
      },
    });
    await tx.keyword.upsert({
      where: {
        language_keyword: {
          language,
          keyword: word,
        },
      },
      update: {
        value: word,
      },
      create: {
        language,
        keyword: word,
        value: word,
      },
    });
    return asset;
  });
  return {
    success: true,
    id: created.id,
    word,
    file: publicUrl,
    type: fileType,
    isPublished: created.isPublished,
  };
}

function parseChunkUploadMetadata(body: Record<string, unknown>) {
  const word = typeof body.word === "string" ? sanitizeSignWord(body.word) : "";
  const language =
    typeof body.language === "string" ? body.language.trim() : "";
  const fileName = typeof body.fileName === "string" ? body.fileName : "";
  const fileType = typeof body.type === "string" ? body.type : "";
  const size = Number(body.size);
  const translations = parseTranslationsField(body.translations);
  const aliases = parseAliasesField(body.aliases);

  if (
    !word ||
    !normalizeGestureKey(word) ||
    !language ||
    !translations ||
    !aliases ||
    !fileName ||
    !ALLOWED_MIME_TYPES.includes(fileType) ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > MAX_FILE_SIZE_BYTES
  ) {
    return null;
  }

  return {
    word,
    language,
    fileName,
    fileType,
    size,
    translations,
    aliases,
    isPublished: body.publish !== "false" && body.publish !== false,
  };
}

router.post("/chunk/start", authenticate, async (req: AuthedRequest, res) => {
  try {
    if (!usesObjectStorage()) {
      return res.status(501).json({
        code: "CHUNKED_UPLOADS_UNAVAILABLE",
        error: "Chunked uploads require configured object storage",
      });
    }

    const metadata = parseChunkUploadMetadata(req.body ?? {});
    if (!metadata) {
      return res.status(400).json({ error: "Invalid upload metadata" });
    }
    const duplicate = await findDuplicate(metadata.word);
    if (duplicate) {
      return res.status(409).json({
        error: `A sign for "${duplicate.word}" already exists — edit or delete it instead of adding a near-duplicate.`,
      });
    }

    return res.json({
      sessionId: randomUUID(),
      chunkSize: MAX_CHUNK_SIZE_BYTES,
    });
  } catch (err) {
    console.error("Upload session start failed:", err);
    return res.status(500).json({ error: "Could not start upload" });
  }
});

router.post(
  "/chunk/part",
  authenticate,
  handleUpload("file", chunkUpload, "3MB"),
  async (req: AuthedRequest, res) => {
    const file = req.file;
    const sessionId = req.body.sessionId;
    const partNumber = Number(req.body.partNumber);
    const user = req.user;
    if (
      !file ||
      !user ||
      !isUploadSessionId(sessionId) ||
      !Number.isInteger(partNumber) ||
      partNumber < 0 ||
      partNumber >= MAX_CHUNK_COUNT
    ) {
      return res.status(400).json({ error: "Invalid upload chunk" });
    }

    try {
      await putObject(
        PRIVATE_BUCKET,
        stagingKey(user.id, sessionId, partNumber),
        file.buffer,
        "application/octet-stream",
      );
      return res.json({ success: true, partNumber });
    } catch (err) {
      console.error("Upload chunk storage failed:", err);
      return res.status(500).json({ error: "Could not store upload chunk" });
    }
  },
);

router.post("/chunk/complete", authenticate, async (req: AuthedRequest, res) => {
  const user = req.user;
  const metadata = parseChunkUploadMetadata(req.body ?? {});
  const sessionId = req.body?.sessionId;
  const chunkCount = Number(req.body?.chunkCount);
  if (
    !user ||
    !metadata ||
    !isUploadSessionId(sessionId) ||
    !Number.isInteger(chunkCount) ||
    chunkCount !== Math.ceil(metadata.size / MAX_CHUNK_SIZE_BYTES) ||
    chunkCount < 1 ||
    chunkCount > MAX_CHUNK_COUNT
  ) {
    return res.status(400).json({ error: "Invalid upload completion request" });
  }

  const chunkKeys = Array.from({ length: chunkCount }, (_, part) =>
    stagingKey(user.id, sessionId, part),
  );

  try {
    const duplicate = await findDuplicate(metadata.word);
    if (duplicate) {
      await deleteObjects(PRIVATE_BUCKET, chunkKeys);
      return res.status(409).json({
        error: `A sign for "${duplicate.word}" already exists — edit or delete it instead of adding a near-duplicate.`,
      });
    }

    const chunks: Buffer[] = [];
    let totalSize = 0;
    for (const key of chunkKeys) {
      const chunk = await getObject(PRIVATE_BUCKET, key);
      totalSize += chunk.length;
      if (totalSize > metadata.size) {
        return res.status(400).json({ error: "Upload size does not match" });
      }
      chunks.push(chunk);
    }
    if (totalSize !== metadata.size) {
      return res.status(400).json({ error: "Upload size does not match" });
    }

    const fileKey = `${SIGNS_PREFIX}${randomUUID()}${MIME_EXTENSIONS[metadata.fileType]}`;
    await putObject(
      PUBLIC_BUCKET,
      fileKey,
      Buffer.concat(chunks, totalSize),
      metadata.fileType,
    );
    const saved = await saveUploadedSign(
      metadata.word,
      metadata.language,
      metadata.fileType,
      fileKey,
      metadata.isPublished,
      metadata.translations,
      metadata.aliases,
    );
    const cleanup = await deleteObjects(PRIVATE_BUCKET, chunkKeys);
    if (cleanup.failed) {
      console.error(`Failed to clean up ${cleanup.failed} staged upload chunk(s).`);
    }
    return res.json(saved);
  } catch (err) {
    console.error("Upload completion failed:", err);
    return res.status(500).json({ error: "Could not complete upload" });
  }
});

router.post("/chunk/abort", authenticate, async (req: AuthedRequest, res) => {
  const user = req.user;
  const sessionId = req.body?.sessionId;
  const chunkCount = Number(req.body?.chunkCount);
  if (
    !user ||
    !isUploadSessionId(sessionId) ||
    !Number.isInteger(chunkCount) ||
    chunkCount < 1 ||
    chunkCount > MAX_CHUNK_COUNT
  ) {
    return res.status(400).json({ error: "Invalid upload cancellation request" });
  }

  const keys = Array.from({ length: chunkCount }, (_, part) =>
    stagingKey(user.id, sessionId, part),
  );
  const cleanup = await deleteObjects(PRIVATE_BUCKET, keys);
  if (cleanup.failed) {
    console.error(`Failed to clean up ${cleanup.failed} staged upload chunk(s).`);
    return res.status(500).json({ error: "Could not clean up upload chunks" });
  }
  return res.json({ success: true });
});

// Uploading a sign asset — any signed-in user (students included). This
// endpoint is now shared by two different UIs: the Admin sign-management
// page (AdminSigns.tsx, unchanged) and the new record/upload actions
// inside the student-facing Sign Library (SignLibraryModal.tsx).
router.post(
  "/",
  authenticate,
  handleUpload("file"),
  async (req: AuthedRequest, res) => {
  try {
    const rawWord = req.body.word;
    const language =
      typeof req.body.language === "string" ? req.body.language.trim() : "";
    const translations = parseTranslationsField(req.body.translations);
    const aliases = parseAliasesField(req.body.aliases);
    const file = req.file;
    if (!rawWord || typeof rawWord !== "string" || !rawWord.trim()) {
      return res.status(400).json({
        error: "Word is required",
      });
    }
    if (typeof language !== "string" || !language.trim()) {
      return res.status(400).json({
        error: "Language is required",
      });
    }
    if (!translations || !aliases) {
      return res.status(400).json({
        error: "Translations must be a language-to-text object and aliases must be an array",
      });
    }
    const word = sanitizeSignWord(rawWord);
    if (!normalizeGestureKey(word)) {
      return res.status(400).json({
        error: "Word must contain at least one letter or number",
      });
    }
    // Catch likely-accidental duplicates (same phrase, different
    // casing/spacing) before they can quietly create two library
    // entries that both look right in the UI, and where speech will
    // arbitrarily always match one of them — confusing to debug later.
    const duplicate = await findDuplicate(word);
    if (duplicate) {
      return res.status(409).json({
        error: `A sign for "${duplicate.word}" already exists — edit or delete it instead of adding a near-duplicate.`,
      });
    }
    if (!file) {
      return res.status(400).json({

        error: "No file uploaded",
      });
    }
    // Optional staging flag from FormData (always a string, or absent).
    // Absent/anything other than the literal "false" keeps today's
    // default behavior: published immediately. Only TEACHER/ADMIN
    // uploads (AdminSigns.tsx) are expected to ever send "false" — the
    // student-facing Sign Library upload flow never sends this field,
    // so it always publishes immediately as previously agreed.
    const isPublished = req.body.publish !== "false";
    const fileType = normalizeMimeType(file.mimetype);
    const objectKey = `${SIGNS_PREFIX}${randomUUID()}${MIME_EXTENSIONS[fileType]}`;
    try {
      await putObject(PUBLIC_BUCKET, objectKey, file.buffer, fileType);
    } catch (uploadError) {
      console.error("Storage upload error:", uploadError);
      return res.status(500).json({
        error: "Upload failed",
      });
    }
    const saved = await saveUploadedSign(
      word,
      language,
      fileType,
      objectKey,
      isPublished,
      translations,
      aliases,
    );
    res.json(saved);
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({
      error: "Upload failed",
    });
  }
});
// Fixing whitespace-only issues on an existing upload's word text (see
// signWordText.ts / the health-check endpoint in signs.routes.ts) —
// TEACHER or ADMIN, same as the publish toggle above. Intentionally only
// re-sanitizes whatever text the client sends rather than accepting
// arbitrary new text, so this endpoint can't be repurposed as a general
// rename — that's a bigger feature (would need to also update any
// matching Keyword row, decide what happens to in-flight speech
// sessions caching the old word, etc.) and isn't what this is for.
router.patch(
  "/:id/word",
  authenticate,
  requireRole("TEACHER", "ADMIN"),
  async (req, res) => {
  try {
    let rawId: string | string[] | undefined = req.params.id;
    if (Array.isArray(rawId)) rawId = rawId[0];
    const id = rawId === undefined ? NaN : Number(rawId);
    if (!Number.isInteger(id)) {
      return res.status(400).json({
        error: "Valid numeric id is required",
      });
    }
    const existing = await prisma.signAsset.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Sign not found" });
    }
    const cleaned = sanitizeSignWord(existing.word);
    // Guard against the cleaned text colliding with a DIFFERENT existing
    // row (e.g. two legacy rows "Good  Morning" and "Good Morning" both
    // existed before this fix) — fixing one shouldn't silently create an
    // exact duplicate of the other.
    const collision = (
      await prisma.signAsset.findMany({ select: { id: true, word: true } })
    ).find((s) => s.id !== id && isSameSignWord(s.word, cleaned));
    if (collision) {
      return res.status(409).json({
        error: `Cleaning this up would duplicate "${collision.word}" (id ${collision.id}) — delete one of them instead.`,
      });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const gesture = await syncGestureRegistry(tx, {
        word: cleaned,
      });
      return tx.signAsset.update({
        where: { id },
        data: { word: cleaned, gestureId: gesture.id },
      });
    });
    res.json({
      success: true,
      id: updated.id,
      word: updated.word,
    });
  } catch (err) {
    console.error("Word cleanup error:", err);
    res.status(500).json({
      error: "Failed to clean up word text",
    });
  }
});
// Toggling the staging flag on an existing upload — TEACHER or ADMIN
// (not STUDENT: the staging gate exists to let teachers review before
// publishing, so students shouldn't be able to flip it themselves).
router.patch(
  "/:id/publish",
  authenticate,
  requireRole("TEACHER", "ADMIN"),
  async (req, res) => {
  try {
    let rawId: string | string[] | undefined = req.params.id;
    if (Array.isArray(rawId)) rawId = rawId[0];
    const id = rawId === undefined ? NaN : Number(rawId);
    if (!Number.isInteger(id)) {
      return res.status(400).json({
        error: "Valid numeric id is required",
      });
    }
    if (typeof req.body.isPublished !== "boolean") {
      return res.status(400).json({
        error: "isPublished (boolean) is required",
      });
    }
    const updated = await prisma.signAsset.update({
      where: { id },
      data: { isPublished: req.body.isPublished },
    });
    res.json({
      success: true,
      id: updated.id,
      isPublished: updated.isPublished,
    });
  } catch (err) {
    console.error("Publish toggle error:", err);
    res.status(500).json({
      error: "Failed to update publish state",
    });
  }
});

// Deleting an uploaded sign asset — Admin only.
router.delete(
  "/delete",
  authenticate,
  requireRole("ADMIN"),
  upload.single("file"),
  async (req, res) => {
  try {
    const word = req.body.word;
    const parsedId = Number.parseInt(req.body.id, 10);
    if (!word || !Number.isInteger(parsedId)) {
      return res.status(400).json({
        error: "Valid numeric id and word are required",
      });
    }
    const id = parsedId;
    const existing = await prisma.signAsset.findUnique({
      where: {
        id,
      },
    });
    // Idempotency guard: if this id is already gone (e.g. a duplicate
    // request from a double-click, or a retry after a dropped
    // response), treat it as already-deleted rather than falling
    // through to `.delete()`, which throws P2025 on a missing row.
    // The caller's desired end state — this row not existing — is
    // already true, so this is a success, not an error.
    if (!existing) {
      return res.json({
        success: true,
        alreadyDeleted: true,
      });
    }
    // Remove the file from storage (deleteObjects logs its own failures).
    const objectKey = keyFromUrl(existing.file, PUBLIC_BUCKET);
    if (objectKey) await deleteObjects(PUBLIC_BUCKET, [objectKey]);
    await prisma.signAsset.delete({
      where: {
        id,
      },
    });
    const keyword = await prisma.keyword.findFirst({
      where: {
        keyword: word,
      },
    });
    if (keyword) {
      await prisma.keyword.delete({
        where: {
          id: keyword.id,
        },
      });
    }
    res.json({
      success: true,
    });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({
      error: "Deletion failed",
    });
  }
});
export default router;