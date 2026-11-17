import express from "express";
import multer from "multer";
import path from "path";
import prisma from "../config/prisma";
import {
  PUBLIC_BUCKET,
  SIGNS_PREFIX,
  putObject,
  deleteObjects,
  publicObjectUrl,
  keyFromUrl,
} from "../config/storage";
import { uploadLimiter } from "../middleware/rateLimiters";
import { sanitizeSignWord, isSameSignWord } from "../utils/signWordText";
import {
  authenticate,
  requireRole,
  AuthedRequest,
} from "../middleware/auth.middleware";
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
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(new Error("Only MP4 video or JPG/PNG/WEBP images are allowed"));
      return;
    }
    cb(null, true);
  },
});
// multer's fileFilter/size-limit errors call next(err), which would
// otherwise fall through to Express's default HTML error page instead of
// a JSON response. This wraps upload.single("file") so those errors come
// back the same way every other error in this route does.
function handleUpload(fieldName: string) {
  const middleware = upload.single(fieldName);
  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    middleware(req, res, (err: unknown) => {
      if (err) {
        const message =
          err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
            ? "File is too large (25MB max)"
            : err instanceof Error
              ? err.message
              : "Upload failed";
        return res.status(400).json({ error: message });
      }
      next();
    });
  };
}
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
    const language = req.body.language;
    const file = req.file;
    if (!rawWord || typeof rawWord !== "string" || !rawWord.trim()) {
      return res.status(400).json({
        error: "Word is required",
      });
    }
    const word = sanitizeSignWord(rawWord);
    // Catch likely-accidental duplicates (same phrase, different
    // casing/spacing) before they can quietly create two library
    // entries that both look right in the UI, and where speech will
    // arbitrarily always match one of them — confusing to debug later.
    const existingSigns = await prisma.speechSign.findMany({
      select: { id: true, word: true },
    });
    const duplicate = existingSigns.find((s) => isSameSignWord(s.word, word));
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
    const objectKey = `${SIGNS_PREFIX}${Date.now()}${path.extname(file.originalname)}`;
    try {
      await putObject(PUBLIC_BUCKET, objectKey, file.buffer, file.mimetype);
    } catch (uploadError) {
      console.error("Storage upload error:", uploadError);
      return res.status(500).json({
        error: "Upload failed",
      });
    }
    const publicUrl = publicObjectUrl(PUBLIC_BUCKET, objectKey);
    const created = await prisma.speechSign.create({
      data: {
        word,
        file: publicUrl,
        type: file.mimetype,
        isPublished,
      },
    });
    await prisma.keyword.upsert({
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
    res.json({
      success: true,
      id: created.id,
      word,
      file: publicUrl,
      type: file.mimetype,
      isPublished: created.isPublished,
    });
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
    const existing = await prisma.speechSign.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Sign not found" });
    }
    const cleaned = sanitizeSignWord(existing.word);
    // Guard against the cleaned text colliding with a DIFFERENT existing
    // row (e.g. two legacy rows "Good  Morning" and "Good Morning" both
    // existed before this fix) — fixing one shouldn't silently create an
    // exact duplicate of the other.
    const collision = (
      await prisma.speechSign.findMany({ select: { id: true, word: true } })
    ).find((s) => s.id !== id && isSameSignWord(s.word, cleaned));
    if (collision) {
      return res.status(409).json({
        error: `Cleaning this up would duplicate "${collision.word}" (id ${collision.id}) — delete one of them instead.`,
      });
    }
    const updated = await prisma.speechSign.update({
      where: { id },
      data: { word: cleaned },
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
    const updated = await prisma.speechSign.update({
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
    const existing = await prisma.speechSign.findUnique({
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
    await prisma.speechSign.delete({
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