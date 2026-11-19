// src/components/Gesture/VideoViewport.tsx
import React, { useEffect, useRef, useState } from "react";
import { useToast } from "../../contexts/ToastContext";
import { buildSmartSentence } from "../../utils/sentenceBuilder";
import { RECOGNITION_UI_CONFIG } from "../../config/recognitionConfig";
import { GestureStabilityTracker } from "../../utils/gestureStability";
import { matchLandmarkTemplate } from "../../utils/landmarkMatcher.js";
import { API_ROOT } from "../../config";
import { authHeaders } from "../../services/api";
import { HAND_LANDMARKER_RESTART_KEY } from "../../utils/holisticLoader";
declare const Camera: any;
const AUTO_SPEAK_IDLE_MS = 2500;
const LANDMARK_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm";
const HAND_LANDMARKER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const LANDMARK_CACHE_KEY = "gesture-landmark-templates-v1";
const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
] as const;
const HAND_COLORS = ["#22d3ee", "#f472b6"];

function drawHandLandmarkOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  hands: Array<Array<{ x: number; y: number }>>,
) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, width, height);

  hands.forEach((landmarks, handIndex) => {
    const color = HAND_COLORS[handIndex % HAND_COLORS.length];
    context.lineWidth = Math.max(3, width / 220);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = color;
    context.shadowColor = "#0f172a";
    context.shadowBlur = 5;

    for (const [fromIndex, toIndex] of HAND_CONNECTIONS) {
      const from = landmarks[fromIndex];
      const to = landmarks[toIndex];
      if (!from || !to) continue;
      context.beginPath();
      context.moveTo(from.x * width, from.y * height);
      context.lineTo(to.x * width, to.y * height);
      context.stroke();
    }

    for (const point of landmarks) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      context.beginPath();
      context.arc(
        point.x * width,
        point.y * height,
        Math.max(4, width / 150),
        0,
        Math.PI * 2,
      );
      context.fillStyle = "#f8fafc";
      context.fill();
      context.lineWidth = Math.max(2, width / 320);
      context.strokeStyle = color;
      context.stroke();
    }
  });
}

function normalizeConfidence(raw: number): number {
  const value = raw > 1 ? raw / 100 : raw;
  return Math.max(0, Math.min(1, value));
}
function passesConfidenceGate(confidence: number): boolean {
  return (
    normalizeConfidence(confidence) >=
    RECOGNITION_UI_CONFIG.CONFIDENCE_THRESHOLD
  );
}
type Language = "English" | "Cebuano" | "Tagalog" | "Ilocano" | "Bikolano";
interface VideoViewportProps {
  language: Language;
  isCapturing: boolean;
  onGestureDetected?: (gestureName: string, language: string) => void;
  onWordDetected?: (gestureName: string, language: string) => void;
}
const VideoViewport: React.FC<VideoViewportProps> = ({
  language,
  isCapturing,
  onGestureDetected,
  onWordDetected,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastWordRef = useRef("");
  const lastWordTimeRef = useRef(0);
  const sentenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentenceBufferRef = useRef<string[]>([]);
  const autoSpeakRef = useRef(true);
  const stabilityTrackerRef = useRef(
    new GestureStabilityTracker(
      RECOGNITION_UI_CONFIG.CONFIDENCE_THRESHOLD,
      RECOGNITION_UI_CONFIG.DETECTION_STABILITY_MS,
      RECOGNITION_UI_CONFIG.CONSECUTIVE_MATCH_THRESHOLD,
    ),
  );
  // Phase 6 UNKNOWN path: separate streak from streakWordRef/streakCountRef
  // above (which track a specific candidate word repeating) — this tracks
  // consecutive "we have no idea" responses instead, regardless of which
  // word (if any) briefly flickered as a low-scoring candidate in between.
  const unknownStreakRef = useRef(0);
  const [isUnknown, setIsUnknown] = useState(false);
  // Hand-tracking model status, shown as an overlay so the first-load wait
  // is visible instead of looking like a frozen camera.
  const [modelStatus, setModelStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  // Bumped by the Retry button to re-run model loading and camera start.
  const [modelRetryKey, setModelRetryKey] = useState(0);
  const landmarkTemplatesRef = useRef<any[]>([]);
  const [landmarkTemplateCount, setLandmarkTemplateCount] = useState(0);
  const [autoSpeak, setAutoSpeak] = useState(true);
  // Latest language, read inside the camera effect so changing language
  // does not restart the camera or reload the hand-tracking model.
  const languageRef = useRef(language);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);
  useEffect(() => {
    setModelStatus("loading");
  }, [modelRetryKey]);
  const [sentence, setSentence] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<number>(0);
  const [handVisible, setHandVisible] = useState(false);
  const handVisibleRef = useRef(false);
  const [previewWord, setPreviewWord] = useState<string | null>(null);
  const { showToast } = useToast();
  const onGestureDetectedRef = useRef(onGestureDetected);
  const onWordDetectedRef = useRef(onWordDetected);
  const showToastRef = useRef(showToast);
  useEffect(() => {
    onGestureDetectedRef.current = onGestureDetected;
  }, [onGestureDetected]);
  useEffect(() => {
    onWordDetectedRef.current = onWordDetected;
  }, [onWordDetected]);
  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);
  useEffect(() => {
    autoSpeakRef.current = autoSpeak;
    if (!autoSpeak && sentenceTimerRef.current) {
      clearTimeout(sentenceTimerRef.current);
      sentenceTimerRef.current = null;
    }
  }, [autoSpeak]);
  useEffect(() => {
    let cancelled = false;
    const loadTemplates = async () => {
      try {
        const cached = localStorage.getItem(LANDMARK_CACHE_KEY);
        if (cached) {
          const parsed: unknown = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            landmarkTemplatesRef.current = parsed;
            setLandmarkTemplateCount(parsed.length);
          }
        }
      } catch (error) {
        console.warn("Could not read cached gesture templates:", error);
      }
      try {
        const response = await fetch(`${API_ROOT}/api/gestures/templates`, {
          headers: authHeaders(),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (cancelled || !Array.isArray(data.templates)) return;
        landmarkTemplatesRef.current = data.templates;
        setLandmarkTemplateCount(data.templates.length);
        localStorage.setItem(
          LANDMARK_CACHE_KEY,
          JSON.stringify(data.templates),
        );
      } catch (error) {
        console.error("Could not load browser gesture templates:", error);
      }
    };
    void loadTemplates();
    const refresh = () => void loadTemplates();
    window.addEventListener("sign-library-updated", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("sign-library-updated", refresh);
    };
  }, []);
  useEffect(() => {
    if (!isCapturing) {
      handVisibleRef.current = false;
      setHandVisible(false);
      if (canvasRef.current) {
        const context = canvasRef.current.getContext("2d");
        context?.clearRect(
          0,
          0,
          canvasRef.current.width,
          canvasRef.current.height,
        );
      }
      setSentence([]);
      sentenceBufferRef.current = [];
      setConfidence(0);
      setPreviewWord(null);
      stabilityTrackerRef.current.reset();
      unknownStreakRef.current = 0;
      setIsUnknown(false);
      if (sentenceTimerRef.current) {
        clearTimeout(sentenceTimerRef.current);
        sentenceTimerRef.current = null;
      }
      lastWordRef.current = "";
      lastWordTimeRef.current = 0;
    }
  }, [isCapturing]);
  useEffect(() => {
    if (!isCapturing || !videoRef.current) return;
    if ("Holistic" in window && typeof window.Holistic !== "undefined") {
      try {
        if (sessionStorage.getItem(HAND_LANDMARKER_RESTART_KEY) !== "true") {
          sessionStorage.setItem(HAND_LANDMARKER_RESTART_KEY, "true");
          window.location.reload();
          return;
        }
      } catch (error) {
        console.error("Could not isolate the MediaPipe runtimes:", error);
        setModelStatus("error");
        showToastRef.current(
          "Reload the page before starting live recognition.",
          "error",
        );
        return;
      }
      setModelStatus("error");
      showToastRef.current(
        "Legacy MediaPipe is still active. Reload the page and try again.",
        "error",
      );
      return;
    }
    try {
      sessionStorage.removeItem(HAND_LANDMARKER_RESTART_KEY);
    } catch (error) {
      console.error("Could not reset the MediaPipe runtime marker:", error);
    }
    let handLandmarker: import("@mediapipe/tasks-vision").HandLandmarker | null =
      null;
    let cam: any = null;
    let stopped = false;
    const start = async () => {
      try {
        const { FilesetResolver, HandLandmarker } = await import(
          "@mediapipe/tasks-vision"
        );
        const vision = await FilesetResolver.forVisionTasks(LANDMARK_WASM_URL);
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: HAND_LANDMARKER_MODEL_URL },
          runningMode: "VIDEO",
          numHands: 2,
        });
        if (stopped) {
          handLandmarker.close();
          return;
        }
        setModelStatus("ready");
      } catch (error) {
        console.error("MediaPipe Hands failed to load:", error);
        if (!stopped) {
          setModelStatus("error");
          showToastRef.current("MediaPipe Hands failed to load.", "error");
        }
        return;
      }
      if (stopped) return;
      const handleRecognitionResult = (result: any) => {
        const rawConfidence = Number(result?.confidence ?? 0);
        setConfidence(Math.round(normalizeConfidence(rawConfidence) * 100));
        if (result?.recognized && result.word) {
          // Real progress toward a match — clear any UNKNOWN streak so it
          // doesn't linger onscreen once the model has something to say.
          unknownStreakRef.current = 0;
          if (isUnknown) setIsUnknown(false);
          const confidenceValue = Number(result.confidence ?? 0);
          if (!passesConfidenceGate(confidenceValue)) {
            stabilityTrackerRef.current.reset();
            setPreviewWord(null);
            return;
          }
          const word = result.word;
          const now2 = Date.now();
          if (
            !stabilityTrackerRef.current.accepts(
              word,
              normalizeConfidence(confidenceValue),
              now2,
            )
          ) {
            if (stabilityTrackerRef.current.hasAccepted(word)) return;
            setPreviewWord(word);
            return;
          }
          const isSameWord = lastWordRef.current === word;
          const timeSinceLast = now2 - lastWordTimeRef.current;
          if (
            isSameWord &&
            timeSinceLast < RECOGNITION_UI_CONFIG.REPEAT_DEBOUNCE_MS
          ) {
            return;
          }
          if (
            !isSameWord &&
            timeSinceLast < RECOGNITION_UI_CONFIG.WORD_TRANSITION_DEBOUNCE_MS
          ) {
            return;
          }
          lastWordRef.current = word;
          lastWordTimeRef.current = now2;
          setPreviewWord(null);
          if (sentenceBufferRef.current[sentenceBufferRef.current.length - 1] !== word) {
            const updated = [...sentenceBufferRef.current, word];
            sentenceBufferRef.current = updated;
            setSentence(updated);
          }
          onWordDetectedRef.current?.(word, languageRef.current);
          showToastRef.current(`Recognized: ${word}`, "success");
        } else if (result?.warning !== "rate_limited") {
          // Phase 6 UNKNOWN path: only count this as a confident "I don't
          // know this sign" when the model actually looked at real input
          // and rejected it (low_confidence/low_match) — not when it's
          // still building up training data, has no qualified candidates,
          // or got no features at all. Those are "can't tell yet", not
          // "tried and drew a blank", so they reset the streak instead.
          if (
            result?.reason === "low_confidence" ||
            result?.reason === "low_match"
          ) {
            unknownStreakRef.current += 1;
            if (
              unknownStreakRef.current >=
              RECOGNITION_UI_CONFIG.UNKNOWN_STREAK_THRESHOLD
            ) {
              setIsUnknown(true);
            }
          } else {
            unknownStreakRef.current = 0;
            setIsUnknown(false);
          }
          stabilityTrackerRef.current.reset();
          setPreviewWord(null);
        }
      };
      cam = new Camera(videoRef.current, {
        onFrame: async () => {
          const video = videoRef.current;
          if (stopped || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            return;
          }
          try {
            const handResults = handLandmarker!.detectForVideo(
              video,
              performance.now(),
            );
            const handLandmarks = handResults.landmarks ?? [];
            if (canvasRef.current) {
              drawHandLandmarkOverlay(
                canvasRef.current,
                video,
                handLandmarks as Array<Array<{ x: number; y: number }>>,
              );
            }
            const foundHands = handLandmarks.length > 0;
            if (handVisibleRef.current !== foundHands) {
              handVisibleRef.current = foundHands;
              setHandVisible(foundHands);
            }
            if (handLandmarks.length === 0) {
              setConfidence(0);
              stabilityTrackerRef.current.reset();
              setPreviewWord(null);
              if (
                autoSpeakRef.current &&
                sentenceBufferRef.current.length > 0 &&
                sentenceTimerRef.current === null
              ) {
                sentenceTimerRef.current = setTimeout(() => {
                  const bufferedWords = sentenceBufferRef.current;
                  if (bufferedWords.length > 0) {
                    onGestureDetectedRef.current?.(
                      buildSmartSentence(bufferedWords),
                      languageRef.current,
                    );
                    sentenceBufferRef.current = [];
                    setSentence([]);
                  }
                  sentenceTimerRef.current = null;
                }, AUTO_SPEAK_IDLE_MS);
              }
            } else {
              if (sentenceTimerRef.current) {
                clearTimeout(sentenceTimerRef.current);
                sentenceTimerRef.current = null;
              }
              const matches = handLandmarks
                .map((landmarks) =>
                  matchLandmarkTemplate(
                    landmarks,
                    landmarkTemplatesRef.current,
                    0.82,
                  ),
                )
                .filter(
                  (match): match is NonNullable<typeof match> => match !== null,
                )
                .sort((leftMatch, rightMatch) =>
                  rightMatch.confidence - leftMatch.confidence,
                );
              const localMatch = matches[0];
              if (localMatch) {
                handleRecognitionResult({
                  recognized: true,
                  word: localMatch.word,
                  confidence: localMatch.confidence,
                });
              } else {
                stabilityTrackerRef.current.reset();
                setPreviewWord(null);
              }
            }
          } catch (error) {
            console.error("MediaPipe hand detection failed:", error);
          }
        },
        width: 640,
        height: 480,
        selfieMode: true,
      });
      await cam.start();
    };
    start();
    return () => {
      stopped = true;
      if (canvasRef.current) {
        const context = canvasRef.current.getContext("2d");
        context?.clearRect(
          0,
          0,
          canvasRef.current.width,
          canvasRef.current.height,
        );
      }
      handVisibleRef.current = false;
      if (sentenceTimerRef.current) {
        clearTimeout(sentenceTimerRef.current);
        sentenceTimerRef.current = null;
      }
      cam?.stop();
      handLandmarker?.close();
    };
  }, [isCapturing, modelRetryKey]);
  const speakSentence = () => {
    if (sentenceTimerRef.current) {
      clearTimeout(sentenceTimerRef.current);
      sentenceTimerRef.current = null;
    }
    if (sentenceBufferRef.current.length === 0) return;
    onGestureDetectedRef.current?.(
      buildSmartSentence(sentenceBufferRef.current),
      languageRef.current,
    );
    sentenceBufferRef.current = [];
    setSentence([]);
    lastWordRef.current = "";
    stabilityTrackerRef.current.reset();
  };
  const undoLastWord = () => {
    if (sentenceTimerRef.current) {
      clearTimeout(sentenceTimerRef.current);
      sentenceTimerRef.current = null;
    }
    const updated = sentenceBufferRef.current.slice(0, -1);
    sentenceBufferRef.current = updated;
    setSentence(updated);
  };
  const clearSentence = () => {
    if (sentenceTimerRef.current) {
      clearTimeout(sentenceTimerRef.current);
      sentenceTimerRef.current = null;
    }
    sentenceBufferRef.current = [];
    setSentence([]);
    lastWordRef.current = "";
    stabilityTrackerRef.current.reset();
  };
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Live Gesture Recognition</h2>
        <span style={{ fontSize: 12, color: "var(--pearl-text-muted, #6b7280)" }}>
          {landmarkTemplateCount} local MediaPipe templates
        </span>
      </div>

      <div style={styles.cameraCard}>
        <video ref={videoRef} autoPlay playsInline muted style={styles.video} />
        <canvas ref={canvasRef} style={styles.canvas} />

        {modelStatus === "loading" && (
          <div style={styles.modelStatusOverlay}>Loading hand tracking…</div>
        )}
        {modelStatus === "error" && (
          <div style={styles.modelStatusOverlay}>
            Hand tracking failed to load.
            <button
              type="button"
              style={styles.retryButton}
              onClick={() => setModelRetryKey((key) => key + 1)}
            >
              Retry
            </button>
          </div>
        )}

        <div style={styles.confidenceBadge(confidence)}>{confidence}%</div>
        {modelStatus === "ready" && (
          <div style={styles.handStatus}>
            {handVisible ? "Hand landmarks detected" : "Show your hand in view"}
          </div>
        )}

      </div>

      <div style={styles.transcription}>
        {sentence.length > 0 || previewWord ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#6b7280" }}>
              Sentence buffer {sentence.length > 0 ? `(${sentence.length} signs)` : ""}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
              {sentence.map((word, index) => (
                <span key={`${index}-${word}`} style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: "rgba(111,192,158,0.2)",
                  border: "1px solid #6fc09e",
                  fontSize: 14,
                  fontWeight: 800,
                  color: "#1f7a5c",
                }}>
                  {word}
                </span>
              ))}
              {previewWord && (
                <span style={styles.previewWord}>{previewWord}…</span>
              )}
              {sentence.length === 0 && !previewWord && (
                <span style={{ color: "#9ca3af" }}>Your signs will appear here</span>
              )}
            </div>
            <div style={{ fontSize: "clamp(20px, 5.5vw, 28px)", fontWeight: 800, color: "#1f2937", lineHeight: 1.2 }}>
              💬 {sentence.length > 0 ? buildSmartSentence(sentence) : ""}
            </div>
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={speakSentence} disabled={sentence.length === 0} style={styles.sentenceButton}>
                Speak Sentence
              </button>
              <button type="button" onClick={undoLastWord} disabled={sentence.length === 0} style={styles.sentenceButton}>
                Backspace / Undo
              </button>
              <button type="button" onClick={clearSentence} disabled={sentence.length === 0} style={styles.sentenceButton}>
                Clear
              </button>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#4b5563" }}>
                <input
                  type="checkbox"
                  checked={autoSpeak}
                  onChange={(event) => setAutoSpeak(event.target.checked)}
                />
                Auto-speak after hands leave for 2.5 seconds
              </label>
            </div>
          </div>
        ) : isUnknown ? (
          // Phase 6 UNKNOWN path: distinct from the idle "—" below — this
          // means the model looked at several frames of real signing and
          // confidently has no match, not just "nothing happening yet".
          <span
            style={{
              color: "var(--pastel-coral-deep, #c2665f)",
              opacity: 0.85,
              fontStyle: "italic",
            }}
          >
            ❓ Sign not recognized
          </span>
        ) : (
          <span
            style={{
              color: "var(--pearl-text-muted, #6b7280)",
              opacity: 0.6,
            }}
          >
            —
          </span>
        )}
      </div>
    </div>
  );
};
const styles = {
  container: {
    width: "100%",
    maxWidth: "680px",
    margin: "0 auto",
  } as React.CSSProperties,
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 16,
  } as React.CSSProperties,
  title: {
    margin: 0,
    color: "var(--pearl-text, #1f2937)",
    fontSize: 22,
    fontWeight: 600,
  },
  cameraCard: {
    position: "relative",
    width: "100%",
    aspectRatio: "4 / 3",
    maxHeight: "500px",
    // Kept dark deliberately — a camera viewfinder reads better as a dark
    // "lens" frame even inside a light-themed page (same reason camera
    // apps stay dark regardless of system theme).
    background: "#111827",
    borderRadius: 20,
    overflow: "hidden",
    border: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
    boxShadow: "0 10px 30px rgba(15,23,42,0.12)",
  } as React.CSSProperties,
  video: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: "scaleX(-1)",
    background: "#000",
  } as React.CSSProperties,
  canvas: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    pointerEvents: "none",
    zIndex: 2,
    transform: "scaleX(-1)",
  } as React.CSSProperties,
  handStatus: {
    position: "absolute",
    left: 16,
    top: 16,
    padding: "6px 11px",
    borderRadius: 999,
    color: "#f8fafc",
    background: "rgba(15, 23, 42, 0.72)",
    border: "1px solid rgba(255,255,255,0.28)",
    fontSize: 12,
    fontWeight: 700,
    zIndex: 10,
    pointerEvents: "none",
  } as React.CSSProperties,
  confidenceBadge: (value: number) =>
    ({
      position: "absolute",
      top: 16,
      right: 16,
      padding: "6px 12px",
      borderRadius: 999,
      fontSize: 13,
      fontWeight: 700,
      color: "var(--pastel-text-on-pastel, #1f2937)",
      background:
        value >= RECOGNITION_UI_CONFIG.CONFIDENCE_THRESHOLD * 100
          ? "var(--pastel-mint, #9bd8bd)"
          : "var(--pastel-coral, #f3b3ae)",
      zIndex: 10,
      transition: "background 0.2s ease",
    }) as React.CSSProperties,
  modelStatusOverlay: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    padding: "10px 18px",
    borderRadius: 14,
    fontSize: 13.5,
    fontWeight: 600,
    color: "#f9fafb",
    background: "rgba(17,24,39,0.82)",
    zIndex: 10,
    textAlign: "center",
    display: "flex",
    alignItems: "center",
    gap: 10,
  } as React.CSSProperties,
  retryButton: {
    padding: "4px 12px",
    borderRadius: 999,
    border: "none",
    fontSize: 12.5,
    fontWeight: 700,
    cursor: "pointer",
    color: "#1f2937",
    background: "var(--pastel-mint, #9bd8bd)",
  } as React.CSSProperties,
  captureWarningBanner: {
    position: "absolute",
    top: 58,
    left: 12,
    right: 12,
    margin: "0 auto",
    width: "fit-content",
    maxWidth: "calc(100% - 24px)",
    padding: "7px 14px",
    borderRadius: 14,
    fontSize: 12.5,
    fontWeight: 600,
    color: "#1a1200",
    background: "rgba(255,204,0,0.92)",
    zIndex: 10,
    whiteSpace: "normal",
    textAlign: "center",
    lineHeight: 1.3,
    boxSizing: "border-box",
  } as React.CSSProperties,
  transcription: {
    marginTop: 16,
    width: "100%",
    boxSizing: "border-box",
    background: "var(--pearl-surface, #fff)",
    border: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
    boxShadow: "0 6px 18px rgba(15,23,42,0.06)",
    padding: "16px 24px",
    borderRadius: 16,
    fontSize: "clamp(18px, 5vw, 28px)",
    fontWeight: 700,
    color: "var(--pearl-text, #1f2937)",
    textAlign: "center",
    minHeight: 24,
  } as React.CSSProperties,
  previewWord: {
    color: "var(--pastel-mint-deep, #6fc09e)",
    fontStyle: "italic",
  } as React.CSSProperties,
  sentenceButton: {
    border: "1px solid rgba(31,122,92,0.22)",
    borderRadius: 14,
    padding: "10px 15px",
    color: "#174b3a",
    background: "linear-gradient(180deg, #f3fbf7, #e8f5ee)",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    minHeight: 42,
    boxShadow: "0 3px 10px rgba(31,122,92,0.08)",
  } as React.CSSProperties,
};
export default VideoViewport;