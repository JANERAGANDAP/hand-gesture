import "dotenv/config";
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
import { UPLOAD_DIR } from "./config/storage";

const app = express();
const serveClient = process.env.SERVE_CLIENT === "true";
const clientDist = path.resolve(__dirname, "../../dist");

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
app.use("/public", express.static(UPLOAD_DIR));

app.use("/api/auth", authRoutes);
app.use("/api/gestures", gestureRoutes);
app.use("/api/recognize", recognitionRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/signs", signsRoutes);
app.use("/api/keywords", keywordsRoutes);
app.use("/api/ai-history", aiHistoryRoute);
app.use("/ai-history", aiHistoryRoute);
app.use("/api/translate", translateRoutes);
app.use("/api/ai", aiRoutes);

app.get("/", (_req, res) => {
  if (serveClient) {
    return res.sendFile(path.join(clientDist, "index.html"));
  }

  res.json({
    success: true,
    message: "Sign Language API Running",
  });
});

if (serveClient) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    const isApiRoute =
      req.path === "/api" ||
      req.path.startsWith("/api/") ||
      req.path === "/ai" ||
      req.path.startsWith("/ai/") ||
      req.path === "/ai-history" ||
      req.path.startsWith("/ai-history/");

    if (req.method !== "GET" || isApiRoute || req.path === "/health") {
      return next();
    }

    res.sendFile(path.join(clientDist, "index.html"), (error) => {
      if (error) next(error);
    });
  });
}

export default app;
