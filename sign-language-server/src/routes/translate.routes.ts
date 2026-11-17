import { Router } from "express";
import { translateWithHybridFallback } from "../utils/hybridTranslator";
import { aiLimiter } from "../middleware/rateLimiters";
import { authenticate } from "../middleware/auth.middleware";
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
    const result = await translateWithHybridFallback(
      text,
      sourceLanguage,
      targetLanguage,
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
