import express from "express";
import prisma from "../config/prisma";
import { generalLimiter } from "../middleware/rateLimiters";
import { authenticate } from "../middleware/auth.middleware";
const router = express.Router();
router.use(generalLimiter);
router.get("/", authenticate, async (req, res) => {
  try {
    const keywords = await prisma.keyword.findMany();
    res.json(keywords);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch keywords",
    });
  }
});
export default router;
