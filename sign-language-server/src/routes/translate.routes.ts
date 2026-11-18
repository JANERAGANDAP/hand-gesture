import { Router } from "express";
import { translateWithHybridFallback } from "../utils/hybridTranslator";
import { aiLimiter } from "../middleware/rateLimiters";
import { authenticate } from "../middleware/auth.middleware";
import prisma from "../config/prisma";
import { normalizeGestureKey } from "../utils/gestureRegistry";
import {
  normalizeSpeechText,
  resolveRegisteredTranslation,
} from "../utils/signLookup";
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
    const aliasKey = normalizeSpeechText(text);
    if ((wordKey || aliasKey) && target) {
      const registeredGesture = await prisma.gesture.findFirst({
        where: {
          isActive: true,
          OR: [
            ...(wordKey ? [{ wordKey }] : []),
            ...(aliasKey ? [{ aliases: { has: aliasKey } }] : []),
          ],
        },
        select: {
          word: true,
          language: true,
          translations: true,
        },
      });
      if (registeredGesture) {
        const translated = resolveRegisteredTranslation(
          registeredGesture,
          target,
        );
        if (translated) {
          return res.json({
            translatedText: translated,
            sourceLanguage: sourceLanguage || registeredGesture.language,
            targetLanguage: target,
            provider: "gesture-registry",
          });
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
