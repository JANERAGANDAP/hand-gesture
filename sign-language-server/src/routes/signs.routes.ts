import express from "express";
import prisma from "../config/prisma";
import { generalLimiter } from "../middleware/rateLimiters";
import { sanitizeSignWord, hasIrregularWhitespace } from "../utils/signWordText";
import {
  authenticate,
  requireRole,
  AuthedRequest,
} from "../middleware/auth.middleware";
const router = express.Router();
router.use(generalLimiter);
router.get("/", authenticate, async (req: AuthedRequest, res) => {
  try {
    // TEACHER/ADMIN can see staged (unpublished) uploads so they can
    // review before publishing; STUDENT only ever sees published ones.
    // This is the enforcement point for the isPublished staging gate —
    // the Sign Library and speech-side dynamicAssets both read from here.
    const canSeeUnpublished =
      req.user?.role === "TEACHER" || req.user?.role === "ADMIN";
    const gestures = await prisma.speechSign.findMany({
      where: canSeeUnpublished ? {} : { isPublished: true },
    });
    res.json(gestures);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch gestures",
    });
  }
});
// Diagnostic for TEACHER/ADMIN: flags existing rows saved before the
// whitespace-sanitization fix in upload.routes.ts was added — a recorded
// word with a double space, a leading/trailing space, a tab, or (most
// commonly, from copy-pasting a phrase) a non-breaking space (U+00A0)
// looks completely normal in the Sign Library UI but silently can never
// match anything a student says, since speech is always transcribed as
// clean single-space text. New uploads can no longer end up this way
// (sanitized at save time), but this catches anything recorded before
// that existed, without silently rewriting anyone's data — an admin
// reviews and fixes each one deliberately (rename via AdminSigns.tsx).
router.get(
  "/health-check",
  authenticate,
  requireRole("TEACHER", "ADMIN"),
  async (_req, res) => {
    try {
      const allSigns = await prisma.speechSign.findMany({
        select: { id: true, word: true },
      });
      const flagged = allSigns
        .filter((s) => hasIrregularWhitespace(s.word))
        .map((s) => ({
          id: s.id,
          word: s.word,
          cleaned: sanitizeSignWord(s.word),
        }));
      res.json({
        success: true,
        totalChecked: allSigns.length,
        flaggedCount: flagged.length,
        flagged,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        success: false,
        error: "Failed to run library health check",
      });
    }
  },
);
export default router;
