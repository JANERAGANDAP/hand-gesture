// src/components/Gesture/VideoViewport.tsx
import React, { useEffect, useRef, useState } from "react";
import { extractFeatures } from "../../utils/featureExtractor";
import { useToast } from "../../contexts/ToastContext";
import { FrameBuffer, buildSmartSentence } from "../../utils/sentenceBuilder";
import { detectHeuristicSign } from "../../utils/heuristicGestureDetector";
import { FeatureSmoother } from "../../utils/featureSmoothing";
import { recognize } from "../../services/recognitionApi";
import { RECOGNITION_UI_CONFIG } from "../../config/recognitionConfig";
import { GestureStabilityTracker } from "../../utils/gestureStability";
import { matchLandmarkTemplate } from "../../utils/landmarkMatcher.js";
import { API_ROOT } from "../../config";
import { authHeaders } from "../../services/api";
import {
  type WristSnapshot,
  wristSnapshot,
  getCaptureWarning,
} from "../../utils/captureQuality";
import {
} from "../../utils/handCrop";
import {
  preloadYoloHandDetector,
} from "../../utils/yoloHandDetector";
import { loadHolistic } from "../../utils/holisticLoader";
// TEMPORARY DIAGNOSTIC — logs the movement signal that gates live
// recognition, to check whether real signing speed actually clears
// RECOGNITION_UI_CONFIG.MOVEMENT_THRESHOLD after EMA smoothing, or
// whether it's being smoothed below the threshold and never triggering
// recognize() during active motion. Throttled to every 5th call so the
// console stays readable. Remove once the threshold/smoothing is tuned.
let movementLogCounter = 0;
function hasSignificantMovement(history: any[]): boolean {
  if (history.length < 3) return false;
  const keys = [
    "left_wrist_x",
    "left_wrist_y",
    "right_wrist_x",
    "right_wrist_y",
    "left_hand_to_nose",
    "right_hand_to_nose",
    "hands_distance",
  ];
  let totalMovement = 0;
  for (let i = 1; i < history.length; i++) {
    let frameDelta = 0;
    for (const key of keys) {
      const a = Number(history[i]?.[key] ?? 0);
      const b = Number(history[i - 1]?.[key] ?? 0);
      frameDelta += Math.abs(a - b);
    }
    totalMovement += frameDelta / keys.length;
  }
  const avgMovement = totalMovement / (history.length - 1);
  const isSignificant = avgMovement > RECOGNITION_UI_CONFIG.MOVEMENT_THRESHOLD;
  movementLogCounter += 1;
  if (movementLogCounter % 5 === 0) {
    console.log(
      `[movement] avg=${avgMovement.toFixed(4)} threshold=${RECOGNITION_UI_CONFIG.MOVEMENT_THRESHOLD} significant=${isSignificant}`,
    );
  }
  return isSignificant;
}
declare const Holistic: any;
declare const Camera: any;
declare const drawConnectors: any;
declare const drawLandmarks: any;
declare const HAND_CONNECTIONS: any;
declare const POSE_CONNECTIONS: any;
const RECOGNITION_FRAME_INTERVAL = 1;
const AUTO_SPEAK_IDLE_MS = 2500;
const LANDMARK_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm";
const HAND_LANDMARKER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const LANDMARK_CACHE_KEY = "gesture-landmark-templates-v1";
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
}
const VideoViewport: React.FC<VideoViewportProps> = ({
  language,
  isCapturing,
  onGestureDetected,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sequenceBufferRef = useRef(new FrameBuffer(30));
  const smootherRef = useRef(
    new FeatureSmoother(RECOGNITION_UI_CONFIG.FEATURE_SMOOTHING_ALPHA),
  );
  const lastWordRef = useRef("");
  const gestureLockedRef = useRef(false);
  const lastWordTimeRef = useRef(0);
  const lastDetectionTimeRef = useRef(0);
  const isActiveRef = useRef(false);
  const sentenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentenceBufferRef = useRef<string[]>([]);
  const autoSpeakRef = useRef(true);
  const movementHistoryRef = useRef<any[]>([]);
  const movingStreakRef = useRef(0);
  const lastMovementAtRef = useRef(0);
  const stableMotionRef = useRef(false);
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
  const isRecognizingRef = useRef(false);
  const frameSkipCounterRef = useRef(0);
  const lastRecognizeCallTimeRef = useRef(0);
  const wristHistoryRef = useRef<WristSnapshot[]>([]);
  const [captureWarning, setCaptureWarning] = useState<string | null>(null);
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
  // Start downloading/compiling the hand-tracking model as soon as this
  // component mounts (before the user presses start), so the first
  // detection is not delayed by a cold model load.
  useEffect(() => {
    let cancelled = false;
    setModelStatus("loading");
    loadHolistic()
      .then(() => {
        if (!cancelled) setModelStatus("ready");
      })
      .catch((error) => {
        console.error("Hand-tracking model failed to load:", error);
        if (!cancelled) setModelStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [modelRetryKey]);
  const [sentence, setSentence] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<number>(0);
  const [previewWord, setPreviewWord] = useState<string | null>(null);
  const { showToast } = useToast();
  const onGestureDetectedRef = useRef(onGestureDetected);
  const showToastRef = useRef(showToast);
  useEffect(() => {
    onGestureDetectedRef.current = onGestureDetected;
  }, [onGestureDetected]);
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
      setSentence([]);
      sentenceBufferRef.current = [];
      setConfidence(0);
      setPreviewWord(null);
      movementHistoryRef.current = [];
      movingStreakRef.current = 0;
      lastMovementAtRef.current = 0;
      stableMotionRef.current = false;
      stabilityTrackerRef.current.reset();
      isRecognizingRef.current = false;
      frameSkipCounterRef.current = 0;
      lastRecognizeCallTimeRef.current = 0;
      unknownStreakRef.current = 0;
      setIsUnknown(false);
      smootherRef.current.reset();
      if (sentenceTimerRef.current) {
        clearTimeout(sentenceTimerRef.current);
        sentenceTimerRef.current = null;
      }
      sequenceBufferRef.current.clear?.();
      lastWordRef.current = "";
      lastWordTimeRef.current = 0;
      lastDetectionTimeRef.current = 0;
      isActiveRef.current = false;
    }
  }, [isCapturing]);
  useEffect(() => {
    if (!isCapturing || !videoRef.current) return;
    let holistic: any = null;
    let handLandmarker: import("@mediapipe/tasks-vision").HandLandmarker | null =
      null;
    let cam: any = null;
    let stopped = false;
    // Kick off the YOLO model fetch in parallel with Holistic init (no-op
    // if YOLO_HAND_DETECTOR_CONFIG.ENABLED is false) so the first live
    // hand-crop capture isn't stalled behind a cold model load.
    preloadYoloHandDetector();
    const start = async () => {
      // Reuses the shared, already-initialized model (see holisticLoader).
      try {
        holistic = await loadHolistic();
        const { FilesetResolver, HandLandmarker } = await import(
          "@mediapipe/tasks-vision"
        );
        const vision = await FilesetResolver.forVisionTasks(LANDMARK_WASM_URL);
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: HAND_LANDMARKER_MODEL_URL },
          runningMode: "VIDEO",
          numHands: 2,
        });
      } catch (error) {
        console.error("Hand-tracking model failed to load:", error);
        if (!stopped) {
          setModelStatus("error");
          showToastRef.current(
            "MediaPipe Hands could not load; using the existing recognition fallback.",
            "error",
          );
        }
        if (!holistic) return;
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
          sequenceBufferRef.current.clear?.();
          movementHistoryRef.current = [];
          movingStreakRef.current = 0;
          lastMovementAtRef.current = 0;
          stableMotionRef.current = false;
          lastWordRef.current = word;
          lastWordTimeRef.current = now2;
          lastDetectionTimeRef.current = now2;
          isActiveRef.current = true;
          setPreviewWord(null);
          if (sentenceBufferRef.current[sentenceBufferRef.current.length - 1] !== word) {
            const updated = [...sentenceBufferRef.current, word];
            sentenceBufferRef.current = updated;
            setSentence(updated);
          }
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
      holistic.onResults((results: any) => {
        if (stopped) return;
        const pose = results.poseLandmarks || [];
        const left = results.leftHandLandmarks || [];
        const right = results.rightHandLandmarks || [];
        const handsVisible = left.length > 0 || right.length > 0;
        if (!handsVisible) {
          gestureLockedRef.current = false;
          setConfidence(0);
          sequenceBufferRef.current.clear?.();
          movementHistoryRef.current = [];
          movingStreakRef.current = 0;
          lastMovementAtRef.current = 0;
          stableMotionRef.current = false;
          stabilityTrackerRef.current.reset();
          unknownStreakRef.current = 0;
          setIsUnknown(false);
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
        } else if (sentenceTimerRef.current) {
          clearTimeout(sentenceTimerRef.current);
          sentenceTimerRef.current = null;
        }
        setCaptureWarning(
          getCaptureWarning(
            pose,
            handsVisible,
            wristHistoryRef.current,
            true,
            results.faceLandmarks?.length > 0,
          ),
        );
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (ctx && canvas) {
          if (canvas.width !== 640) {
            canvas.width = 640;
            canvas.height = 480;
          }
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const active =
            isActiveRef.current &&
            Date.now() - lastDetectionTimeRef.current <= 2800;
          ctx.globalAlpha = active ? 1 : 0.25;
          if (pose.length) {
            drawConnectors(ctx, pose, POSE_CONNECTIONS, {
              color: "#4ade80",
              lineWidth: 3,
            });
            drawLandmarks(ctx, pose, {
              color: "#facc15",
              radius: 3,
            });
          }
          if (left.length) {
            drawConnectors(ctx, left, HAND_CONNECTIONS, {
              color: "#60a5fa",
              lineWidth: 3,
            });
            drawLandmarks(ctx, left, {
              color: "#f87171",
              radius: 2.5,
            });
          }
          if (right.length) {
            drawConnectors(ctx, right, HAND_CONNECTIONS, {
              color: "#60a5fa",
              lineWidth: 3,
            });
            drawLandmarks(ctx, right, {
              color: "#f87171",
              radius: 2.5,
            });
          }
          ctx.globalAlpha = 1;
        }
        const rawFeatures = extractFeatures(
          pose,
          left,
          right,
          results.faceLandmarks || [],
        );
        if (handLandmarker && landmarkTemplatesRef.current.length > 0) {
          try {
            const handResults = handLandmarker.detectForVideo(
              results.image,
              performance.now(),
            );
            const localMatches = (handResults.landmarks ?? [])
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
            const localMatch = localMatches[0];
            if (localMatch) {
              handleRecognitionResult(
                {
                  recognized: true,
                  word: localMatch.word,
                  confidence: localMatch.confidence,
                },
              );
              return;
            }
          } catch (error) {
            console.error("Local landmark matching failed:", error);
          }
        }
        if (!rawFeatures) return;
        const features = smootherRef.current.smooth(rawFeatures);
        wristHistoryRef.current.push(wristSnapshot(features));
        if (wristHistoryRef.current.length > 3) {
          wristHistoryRef.current.shift();
        }
        movementHistoryRef.current.push(features);
        if (movementHistoryRef.current.length > 3) {
          movementHistoryRef.current.shift();
        }

        // Instant geometric / landmark sign detector for core gestures (I, you, hungry, black, water, eat, etc.)
        if (handsVisible) {
          const heuristicMatch = detectHeuristicSign(
            features,
            pose,
            left,
            right,
            movementHistoryRef.current,
          );
          if (heuristicMatch) {
            handleRecognitionResult(
              {
                recognized: true,
                word: heuristicMatch.word,
                confidence: heuristicMatch.confidence,
              },
            );
          }
        }
        const rawMoving = hasSignificantMovement(movementHistoryRef.current);
        const nowTick = Date.now();
        if (rawMoving) {
          movingStreakRef.current++;
          lastMovementAtRef.current = nowTick;
        } else {
          movingStreakRef.current = 0;
        }
        if (
          movingStreakRef.current >= RECOGNITION_UI_CONFIG.MOVEMENT_ENTRY_STREAK
        )
          stableMotionRef.current = true;
        // Exit on a decay window, not an instant still-frame count: a held
        // static handshape has near-zero movement by definition, so an
        // exit-on-stillness gate here would turn recognition OFF right as
        // the sign becomes fully formed and most readable. Instead stay
        // "active" for MOTION_HOLD_MS after the last real movement, giving
        // a hold time to actually get scored before the window closes.
        if (
          stableMotionRef.current &&
          lastMovementAtRef.current > 0 &&
          nowTick - lastMovementAtRef.current > RECOGNITION_UI_CONFIG.MOTION_HOLD_MS
        )
          stableMotionRef.current = false;
        sequenceBufferRef.current.push(features);
        if (!stableMotionRef.current) {
          return;
        }
        frameSkipCounterRef.current += 1;
        if (frameSkipCounterRef.current < RECOGNITION_FRAME_INTERVAL) {
          return;
        }
        frameSkipCounterRef.current = 0;
        if (isRecognizingRef.current) {
          return;
        }
        const nowMs = Date.now();
        if (
          nowMs - lastRecognizeCallTimeRef.current <
          RECOGNITION_UI_CONFIG.MIN_RECOGNIZE_INTERVAL_MS
        ) {
          return;
        }
        lastRecognizeCallTimeRef.current = nowMs;
        isRecognizingRef.current = true;
        // No hand-crop capture here: the backend no longer reads it, so
        // cropping + base64-encoding on every frame only cost CPU and
        // upload time. (async () => ...)() keeps a sync throw from
        // leaving isRecognizingRef stuck at true.
        (async () =>
          recognize({
            gestureType: "dynamic",
            features,
            sequence: sequenceBufferRef.current.snapshot(),
            language: languageRef.current,
          }))()
          .then((result) => {
            handleRecognitionResult(result);
          })
          .catch((e) => {
            console.error(e);
          })
          .finally(() => {
            isRecognizingRef.current = false;
          });
      });
      cam = new Camera(videoRef.current, {
        onFrame: async () => {
          if (!stopped && holistic) {
            await holistic.send({
              image: videoRef.current,
            });
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
      if (sentenceTimerRef.current) {
        clearTimeout(sentenceTimerRef.current);
        sentenceTimerRef.current = null;
      }
      cam?.stop();
      handLandmarker?.close();
      // The model is shared and kept alive for the next start; only detach
      // this run's result handler instead of closing the model.
      holistic?.onResults(() => {});
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

        {captureWarning && (
          <div style={styles.captureWarningBanner}>⚠ {captureWarning}</div>
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
    pointerEvents: "none",
    zIndex: 2,
    transform: "scaleX(-1)",
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
    border: "1px solid var(--pearl-border, rgba(15,23,42,0.12))",
    borderRadius: 999,
    padding: "7px 12px",
    color: "#1f2937",
    background: "#f8fafc",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  } as React.CSSProperties,
};
export default VideoViewport;