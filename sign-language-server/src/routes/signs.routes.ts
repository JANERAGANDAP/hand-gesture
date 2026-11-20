import express from "express";
import prisma from "../config/prisma";
import { generalLimiter } from "../middleware/rateLimiters";
import { sanitizeSignWord, hasIrregularWhitespace } from "../utils/signWordText";
import {
  authenticate,
  requireRole,
  AuthedRequest,
} from "../middleware/auth.middleware";
import {
  normalizeSpeechText,
  signLookupScore,
} from "../utils/signLookup";
const router = express.Router();
router.use(generalLimiter);
router.get("/lookup", authenticate, async (req: AuthedRequest, res) => {
  const rawText = req.query.text;
  if (typeof rawText !== "string" || !rawText.trim() || rawText.length > 100) {
    return res.status(400).json({
      success: false,
      error: "text must contain between 1 and 100 characters",
    });
  }
  const query = normalizeSpeechText(rawText);
  if (!query) {
    return res.json({ success: true, signs: [] });
  }
  try {
    const canSeeUnpublished =
      req.user?.role === "TEACHER" || req.user?.role === "ADMIN";
    const visibilityFilter = canSeeUnpublished ? {} : { isPublished: true };
    const sharedFilter = {
      isActive: true,
      assets: { some: visibilityFilter },
    };
    const select = {
      word: true,
      wordKey: true,
      aliases: true,
      translations: true,
      assets: {
        where: visibilityFilter,
      },
    } as const;
    let gestures = await prisma.gesture.findMany({
      where: {
        ...sharedFilter,
        OR: [{ wordKey: query }, { aliases: { has: query } }],
      },
      select,
    });
    if (gestures.length === 0 && query.length >= 4 && !query.includes(" ")) {
      gestures = await prisma.gesture.findMany({
        where: sharedFilter,
        select,
      });
    }
    const matches = gestures
      .map((gesture) => {
        const translations =
          gesture.translations &&
          typeof gesture.translations === "object" &&
          !Array.isArray(gesture.translations)
            ? Object.values(gesture.translations as Record<string, unknown>)
                .filter((value): value is string => typeof value === "string")
            : [];
        const score = signLookupScore(rawText, [
          gesture.word,
          gesture.wordKey,
          ...gesture.aliases,
          ...translations,
          ...gesture.assets.map((asset) => asset.word),
        ]);
        return { gesture, score };
      })
      .filter(
        (match): match is { gesture: (typeof gestures)[number]; score: number } =>
          match.score !== null,
      )
      .sort((left, right) => left.score - right.score)
      .flatMap(({ gesture }) =>
        gesture.assets.map((asset) => ({
          ...asset,
          gesture: {
            aliases: gesture.aliases,
            translations: gesture.translations,
          },
        })),
      );
    return res.json({ success: true, signs: matches });
  } catch (error) {
    console.error("Sign lookup failed:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to search the sign dictionary",
    });
  }
});
router.get("/", authenticate, async (req: AuthedRequest, res) => {
  try {
    // TEACHER/ADMIN can see staged (unpublished) uploads so they can
    // review before publishing; STUDENT only ever sees published ones.
    // This is the enforcement point for the isPublished staging gate —
    // the Sign Library and speech-side dynamicAssets both read from here.
    const canSeeUnpublished =
      req.user?.role === "TEACHER" || req.user?.role === "ADMIN";
    const gestures = await prisma.signAsset.findMany({
      where: canSeeUnpublished ? {} : { isPublished: true },
      include: {
        gesture: {
          select: {
            aliases: true,
            translations: true,
          },
        },
      },
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
  requireRole("ADMIN"),
  async (_req, res) => {
    try {
      const allSigns = await prisma.signAsset.findMany({
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
