import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import path from "path";
import gestureRoutes from "./routes/gesture.routes";
import recognitionRoutes from "./routes/recognition.routes";
import uploadRoutes from "./routes/upload.routes";
import signsRoutes from "./routes/signs.routes";
import keywordsRoutes from "./routes/keywords.routes";
import aiHistoryRoute from "./routes/aihistory.routes";
import translateRoutes from "./routes/translate.routes";
import authRoutes from "./routes/auth.routes";
import aiRoutes from "./routes/ollamaRoutes";

const app = express();

app.get("/health", (_req, res) => {
  res.status(200).type("text/plain").send("OK");
});

app.set("trust proxy", 1);
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(","),
    credentials: true,
  }),
);
app.use(express.json({ limit: "50mb" }));

// Serve locally uploaded sign media files
app.use("/public", express.static(path.join(process.cwd(), "public")));

app.use("/api/auth", authRoutes);
app.use("/api/gestures", gestureRoutes);
app.use("/api/recognize", recognitionRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/signs", signsRoutes);
app.use("/api/keywords", keywordsRoutes);
app.use("/ai-history", aiHistoryRoute);
app.use("/api/ai-history", aiHistoryRoute);
app.use("/api/translate", translateRoutes);
app.use("/api/ai", aiRoutes);

app.get("/", (_, res) => {
  res.json({
    success: true,
    message: "Sign Language API Running",
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
