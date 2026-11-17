import { Router } from "express";
import { callGroq, GroqMessage } from "../utils/groqClient";
import { aiLimiter } from "../middleware/rateLimiters";
const router = Router();
router.use(aiLimiter);
router.post("/", async (req, res) => {
  try {
    const messages = req.body?.messages;
    if (!Array.isArray(messages)) {
      return res.status(400).json({
        error: "messages is required",
      });
    }
    const content = await callGroq(messages as GroqMessage[], req.body?.model);
    res.json({
      message: {
        role: "assistant",
        content: content || "",
      },
      provider: "groq",
    });
  } catch (error) {
    console.error("Groq Error:", error);
    res.status(500).json({
      error: "Failed to connect to Groq",
    });
  }
});
export default router;
