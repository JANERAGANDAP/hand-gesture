import { Router } from "express";
import { translateWithHybridFallback } from "../utils/hybridTranslator";
import { aiLimiter } from "../middleware/rateLimiters";
import { authenticate } from "../middleware/auth.middleware";
import prisma from "../config/prisma";
import { normalizeGestureKey } from "../utils/gestureRegistry";
const router = Router();
router.post("/", authenticate, aiLimiter, async (req, res) => {
  try {
    const { text, sourceLanguage, targetLanguage } = req.body ?? {};
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({
        error: "text is required",
      });
    }
    if (text.length > 500) {
      return res.status(400).json({
        error: "text is too long (max 500 characters)",
      });
    }
    const target = typeof targetLanguage === "string" ? targetLanguage.trim() : "";
    const wordKey = normalizeGestureKey(text);
    if (wordKey && target) {
      const registeredGesture = await prisma.gesture.findUnique({
        where: { wordKey },
        select: { isActive: true, translations: true },
      });
      if (registeredGesture?.isActive) {
        const translations = registeredGesture.translations;
        if (
          translations &&
          typeof translations === "object" &&
          !Array.isArray(translations)
        ) {
          const translated = Object.entries(translations).find(
            ([language]) => language.toLowerCase() === target.toLowerCase(),
          )?.[1];
          if (typeof translated === "string" && translated.trim()) {
            return res.json({
              translatedText: translated,
              sourceLanguage: sourceLanguage || "English",
              targetLanguage: target,
              provider: "gesture-registry",
            });
          }
        }
      }
    }
    const result = await translateWithHybridFallback(
      text,
      sourceLanguage,
      target,
    );
    res.json({
      translatedText: result.translatedText,
      sourceLanguage: sourceLanguage || "English",
      targetLanguage: targetLanguage || "Tagalog",
      provider: result.provider,
    });
  } catch (error) {
    console.error("Hybrid translation error:", error);
    res.status(500).json({
      error: "Translation failed",
    });
  }
});
export default router;
