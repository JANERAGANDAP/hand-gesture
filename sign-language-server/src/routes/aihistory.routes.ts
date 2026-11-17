import { Router } from "express";
import prisma from "../config/prisma";
import { normalizeForCacheKey } from "../utils/hybridTranslator";
import { generalLimiter, aiLimiter } from "../middleware/rateLimiters";
import { authenticate } from "../middleware/auth.middleware";
const router = Router();
router.post("/", authenticate, generalLimiter, async (req, res) => {
  try {
    const { language, rawGestureInput, composedSentence } = req.body;
    const history = await prisma.aISentenceHistory.create({
      data: {
        language,
        rawGestureInput,
        normalizedInput: normalizeForCacheKey(rawGestureInput ?? ""),
        composedSentence,
      },
    });
    res.json(history);
  } catch (err) {
    console.error("AI history save error:", err);
    res.status(500).json({
      error: "Failed to save history",
    });
  }
});
router.get("/get-history", authenticate, generalLimiter, async (_req, res) => {
  try {
    const history = await prisma.aISentenceHistory.findMany({
      orderBy: {
        createdAt: "desc",
      },
      take: 200,
    });
    res.json(history);
  } catch (err) {
    console.error("AI history fetch error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch history",
    });
  }
});
router.post("/lookup", authenticate, aiLimiter, async (req, res) => {
  try {
    const { rawGestureInput, language } = req.body;
    const normalized = normalizeForCacheKey(rawGestureInput ?? "");
    const existing = await prisma.aISentenceHistory.findFirst({
      where: {
        normalizedInput: normalized,
        language,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    res.json(existing);
  } catch (err) {
    console.error("AI history lookup error:", err);
    res.status(500).json({
      error: "Lookup failed",
    });
  }
});
export default router;
