import React, { useEffect, useRef, useState, useCallback } from "react";
import { detectPoseGesture } from "../../hooks/useGestureAI";
import { extractFeatures } from "../../utils/featureExtractor";
import { drawSkeleton } from "../../utils/drawSkeleton";
import {
  saveGesture,
  checkGestureConsistency,
  uploadHandCrop,
  attachHandCropUrl,
} from "../../services/gestureApi";
import { recognize } from "../../services/recognitionApi";
import { RECOGNITION_UI_CONFIG } from "../../config/recognitionConfig";
import {
  type WristSnapshot,
  wristSnapshot,
  isTrackingGlitch,
  getCaptureWarning,
} from "../../utils/captureQuality";
import { captureHandCropBlob, computeHandBoundingBox } from "../../utils/handCrop";
import {
  loadImageFile,
  extractFeaturesFromImage,
  cropImageToBlob,
  pickDominantHandLandmarks,
} from "../../utils/imageSampleExtractor";
import {
  resolveHandBox,
  preloadYoloHandDetector,
} from "../../utils/yoloHandDetector";
declare const Holistic: any;
declare const Camera: any;
const RECORD_FRAMES = 30;
const RECOGNITION_INTERVAL = 1500;
export const RECOMMENDED_RECORDINGS = 10;
const CONSECUTIVE_MATCH_THRESHOLD =
  RECOGNITION_UI_CONFIG.CONSECUTIVE_MATCH_THRESHOLD;
const SWITCH_CONFIDENCE_MARGIN = 10;
const MAX_JITTER_EVENTS_PER_TAKE = 6;
interface RecordedFrame {
  timestamp: number;
  features: any;
}
function averageFeatureFrames(frames: any[]): any {
  if (!frames.length) return {};
  const result: any = {
    ...frames[0],
  };
  const keys = Object.keys(frames[0]);
  for (const key of keys) {
    const vals = frames.map((f) => f[key]);
    if (typeof vals[0] === "number") {
      result[key] =
        vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
    } else if (typeof vals[0] === "boolean") {
      const trueCount = vals.filter(Boolean).length;
      result[key] = trueCount > vals.length / 2;
    } else if (Array.isArray(vals[0])) {
      result[key] = vals[0].map((_: any, i: number) => {
        const elements = vals.map((v) => v[i]);
        if (typeof elements[0] === "boolean") {
          return elements.filter(Boolean).length > vals.length / 2;
        }
        return (
          elements.reduce((a: number, b: number) => a + b, 0) / vals.length
        );
      });
    }
  }
  return result;
}
// Runs after the gesture record is already saved — see saveRecordedGesture.
// Upload can be slow/stalled (that's the whole reason this was pulled out
// of the save path), so it's fired without blocking the UI. On failure the
// gesture stays saved (word/sequence/DTW data intact), but we surface an
// error rather than silently dropping the CNN training image like before.
async function uploadAndAttachHandCrop(
  gestureId: number,
  blob: Blob,
): Promise<void> {
  const uploadStart = performance.now();
  const uploadResult = await uploadHandCrop(blob);
  console.log(
    `[gesture-save-timing] hand-crop upload (background): ${Math.round(performance.now() - uploadStart)}ms`,
  );
  if (!uploadResult.success || !uploadResult.url) {
    alert(
      `Gesture saved, but the hand-shape image failed to upload: ${uploadResult.error ?? "unknown error"}. ` +
        `This recording won't be used for CNN training until it's re-captured.`,
    );
    return;
  }
  const attachStart = performance.now();
  const attachResult = await attachHandCropUrl(gestureId, uploadResult.url);
  console.log(
    `[gesture-save-timing] attach hand-crop (background): ${Math.round(performance.now() - attachStart)}ms`,
  );
  if (!attachResult.success) {
    alert(
      `Hand-shape image uploaded, but couldn't be attached to the gesture: ${attachResult.error ?? "unknown error"}.`,
    );
  }
}
// Uploaded-video path: lets an admin/teacher pick an existing clip of the
// sign instead of recording live. Seeks a hidden <video> element frame by
// frame across the clip (skipping the first/last 8%, which are usually
// hand-raising/lowering rather than the sign itself), runs each sampled
// frame through its own Holistic instance (modelComplexity 1 — this path
// isn't real-time, so accuracy matters more than speed here), and samples
// down to RECORD_FRAMES evenly-spaced frames — the same frame count and
// shape saveRecordedGesture/finishRecording already expect from a live
// take, so nothing downstream needs to know the frames came from a file.
const UPLOAD_TRIM_START = 0.08;
const UPLOAD_TRIM_END = 0.92;
// A clip that mostly doesn't show a hand (wrong file, hands out of frame
// for most of it) isn't worth training on — reject rather than silently
// save a mostly-empty gesture.
const MIN_HAND_FRAME_FRACTION = 0.6;
// How many sampled frames on either side of the temporal midpoint to try
// for a hand-shape crop before giving up on this take's crop entirely —
// see the retry loop in processUploadedVideo(). Wide enough to survive one
// or two bad frames, narrow enough to stay near the fully-formed sign
// rather than drifting into transition frames at the clip's edges.
const HAND_CROP_RETRY_WINDOW = 4;

function seekVideoTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      reject(new Error("Video seek failed"));
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = time;
  });
}

function loadVideoFile(file: File): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = URL.createObjectURL(file);
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error("Couldn't read this video file"));
  });
}

interface AdminSignRecorderProps {
  onGestureSaved?: () => void;
}
const AdminSignRecorder: React.FC<AdminSignRecorderProps> = ({
  onGestureSaved,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<RecordedFrame[]>([]);
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // Paired with isSaving above but checked/set synchronously — the state
  // flag drives the disabled button, but disabling only takes effect after
  // React re-renders. A fast double-click can fire the handler twice before
  // that paint happens, which would send two save requests for the same
  // recording. This ref closes that gap independent of render timing.
  const isSavingRef = useRef(false);
  const [gestureName, setGestureName] = useState("");
  // Phase 2 of the CNN plan: gestureType is a per-word decision. Defaults to
  // "dynamic" for a brand-new word; locked to the word's existing value
  // (via existingGestureTypeRef, set from the consistency-check response)
  // once that word already has recordings, so a word can't end up with a
  // mix of static and dynamic takes.
  const [gestureType, setGestureType] = useState<"static" | "dynamic">(
    "dynamic",
  );
  const existingGestureTypeRef = useRef<"static" | "dynamic" | null>(null);
  const [recordedFeatures, setRecordedFeatures] = useState<any[]>([]);
  const [recordingsForCurrentWord, setRecordingsForCurrentWord] = useState(0);
  // Captured once per take, at the temporal midpoint of the recording — see
  // Phase 1 CNN plan. Null until capture succeeds; upload happens lazily in
  // saveRecordedGesture so a failed/skipped capture never blocks saving the
  // gesture itself (DTW training data is still the priority).
  const handCropBlobRef = useRef<Blob | null>(null);
  const handCropCapturedForTakeRef = useRef(false);
  // Guards against overlapping resolveHandBox() calls when consecutive
  // frames both see handCropCapturedForTakeRef still false — only one
  // capture attempt should ever be in flight at a time.
  const handCropAttemptInFlightRef = useRef(false);
  const recognitionFramesRef = useRef<RecordedFrame[]>([]);
  const holisticClosedRef = useRef(false);
  const recognitionLockRef = useRef(false);
  const streakWordRef = useRef<string | null>(null);
  const streakCountRef = useRef(0);
  const lockedWordRef = useRef<string | null>(null);
  const lockedConfidenceRef = useRef(0);
  const recognitionCooldownRef = useRef(0);
  const isRecordingRef = useRef(false);
  const jitterEventsRef = useRef(0);
  const wristHistoryRef = useRef<WristSnapshot[]>([]);
  const [captureWarning, setCaptureWarning] = useState<string | null>(null);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessingUpload, setIsProcessingUpload] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentLabel, setCurrentLabel] = useState("Waiting...");
  const currentLabelRef = useRef("Waiting...");
  const [recordProgress, setRecordProgress] = useState(0);
  const updateLabel = useCallback((label: string) => {
    currentLabelRef.current = label;
    setCurrentLabel(label);
  }, []);
  useEffect(() => {
    setIsCameraOn(true);
  }, []);
  const startRecording = useCallback(async () => {
    if (isRecording) return;
    updateLabel("Get Ready...");
    setRecordProgress(0);
    framesRef.current = [];
    recognitionFramesRef.current = [];
    streakWordRef.current = null;
    streakCountRef.current = 0;
    lockedWordRef.current = null;
    lockedConfidenceRef.current = 0;
    jitterEventsRef.current = 0;
    wristHistoryRef.current = [];
    handCropBlobRef.current = null;
    handCropCapturedForTakeRef.current = false;
    handCropAttemptInFlightRef.current = false;
    let count = 3;
    setCountdown(count);
    const timer = setInterval(() => {
      count--;
      if (count > 0) {
        setCountdown(count);
      } else {
        clearInterval(timer);
        setCountdown(null);
        setIsRecording(true);
        isRecordingRef.current = true;
        updateLabel("Recording...");
      }
    }, 1000);
  }, [isRecording, updateLabel]);
  const finishRecording = useCallback(
    async (frames: RecordedFrame[]) => {
      isRecordingRef.current = false;
      setIsRecording(false);
      setRecordProgress(RECORD_FRAMES);
      setRecordedFeatures(frames.map((f) => f.features));
      recognitionFramesRef.current = [];
      setShowNameDialog(true);
      updateLabel("Recording Complete");
    },
    [updateLabel],
  );
  const processUploadedVideo = useCallback(
    async (file: File) => {
      if (isProcessingUpload || isRecording) return;
      setIsProcessingUpload(true);
      setUploadProgress(0);
      updateLabel("Reading video...");
      let objectUrl: string | null = null;
      let holistic: any = null;
      try {
        const video = await loadVideoFile(file);
        objectUrl = video.src;
        const duration = video.duration;
        if (!duration || !isFinite(duration) || duration < 0.3) {
          alert("Couldn't read this video, or it's too short.");
          return;
        }
        holistic = new Holistic({
          locateFile: (f: string) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${f}`,
        });
        holistic.setOptions({
          modelComplexity: 1,
          smoothLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        let latestResults: any = null;
        holistic.onResults((results: any) => {
          latestResults = results;
        });
        const startTime = duration * UPLOAD_TRIM_START;
        const endTime = duration * UPLOAD_TRIM_END;
        const sampledFrames: RecordedFrame[] = [];
        let framesWithHands = 0;
        let midpointCropBlob: Blob | null = null;
        const midpointIndex = Math.floor(RECORD_FRAMES / 2);
        updateLabel("Processing video...");
        for (let i = 0; i < RECORD_FRAMES; i++) {
          const t =
            startTime + ((endTime - startTime) * i) / (RECORD_FRAMES - 1);
          await seekVideoTo(video, t);
          latestResults = null;
          await holistic.send({ image: video });
          // holistic.send() resolves once processing for this frame is
          // done, but onResults can fire a tick after that in some
          // builds — a couple of rAF ticks of slack keeps this robust
          // without a fixed arbitrary timeout.
          for (let wait = 0; wait < 5 && !latestResults; wait++) {
            await new Promise((r) => requestAnimationFrame(r));
          }
          setUploadProgress(i + 1);
          if (!latestResults) continue;
          const results = latestResults;
          const hasHands =
            (results.leftHandLandmarks && results.leftHandLandmarks.length > 0) ||
            (results.rightHandLandmarks && results.rightHandLandmarks.length > 0);
          const features = extractFeatures(
            results.poseLandmarks,
            results.leftHandLandmarks,
            results.rightHandLandmarks,
            results.faceLandmarks || [],
          );
          if (!features) continue;
          if (hasHands) framesWithHands++;
          sampledFrames.push({ timestamp: Date.now(), features });
          if (
            !midpointCropBlob &&
            hasHands &&
            Math.abs(i - midpointIndex) <= HAND_CROP_RETRY_WINDOW
          ) {
            // A single exact-midpoint attempt could land on one bad frame
            // (motion blur, hand mid-transition) and silently end up with
            // no crop for the whole take. Retrying across a small window
            // of frames around the midpoint — stopping as soon as one
            // succeeds — makes that failure mode far less likely without
            // scanning the entire (potentially long) uploaded clip.
            const handLandmarks =
              results.rightHandLandmarks?.length >=
              (results.leftHandLandmarks?.length ?? 0)
                ? results.rightHandLandmarks
                : results.leftHandLandmarks;
            const box = await resolveHandBox(video, handLandmarks);
            if (box) {
              try {
                midpointCropBlob = await captureHandCropBlob(video, box);
              } catch (err) {
                console.warn("Hand-crop capture from video failed:", err);
              }
            }
          }
        }
        if (
          sampledFrames.length < RECORD_FRAMES * 0.5 ||
          framesWithHands < sampledFrames.length * MIN_HAND_FRAME_FRACTION
        ) {
          alert(
            "Couldn't find a hand clearly visible through most of this video. " +
              "Try a clip where the hand stays in frame for the whole sign, or record live instead.",
          );
          updateLabel("Waiting...");
          return;
        }
        handCropBlobRef.current = midpointCropBlob;
        handCropCapturedForTakeRef.current = true;
        await finishRecording(sampledFrames);
      } catch (err) {
        console.error("Video upload processing failed:", err);
        alert("Couldn't process this video. Try a different file or record live.");
        updateLabel("Waiting...");
      } finally {
        holistic?.close?.();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        setIsProcessingUpload(false);
        setUploadProgress(0);
      }
    },
    [isProcessingUpload, isRecording, finishRecording, updateLabel],
  );
  // Image-import path: lets an admin/teacher save a still photo of a hand
  // shape as a reference sample. A photo has no motion, so it can only be a
  // "static" take (one frame). Same downstream flow as a video or live take.
  const processUploadedImage = useCallback(
    async (file: File) => {
      if (isProcessingUpload || isRecording) return;
      setIsProcessingUpload(true);
      updateLabel("Reading image...");
      let objectUrl: string | null = null;
      try {
        const image = await loadImageFile(file);
        objectUrl = image.src;
        updateLabel("Detecting hand...");
        const extraction = await extractFeaturesFromImage(image);
        if (!extraction) {
          alert(
            "Couldn't find a hand clearly visible in this image. " +
              "Use a clear, upright photo with the whole hand in frame, or record live instead.",
          );
          updateLabel("Waiting...");
          return;
        }
        // Optional reference thumbnail; a failed crop never blocks the take.
        const box = computeHandBoundingBox(
          pickDominantHandLandmarks(extraction.leftHand, extraction.rightHand),
          image.naturalWidth,
          image.naturalHeight,
        );
        handCropBlobRef.current = box ? await cropImageToBlob(image, box) : null;
        handCropCapturedForTakeRef.current = true;
        setGestureType("static");
        await finishRecording([
          { timestamp: Date.now(), features: extraction.features },
        ]);
      } catch (err) {
        console.error("Image upload processing failed:", err);
        alert("Couldn't process this image. Try a different file or record live.");
        updateLabel("Waiting...");
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        setIsProcessingUpload(false);
      }
    },
    [isProcessingUpload, isRecording, finishRecording, updateLabel],
  );
  const saveRecordedGesture = useCallback(async () => {
    // Synchronous guard — see isSavingRef above. Must be the very first
    // thing in the function, before validation or any state read, so a
    // second overlapping click can never reach the network calls below.
    if (isSavingRef.current) return;
    if (!gestureName.trim()) {
      alert("Enter gesture name");
      return;
    }
    if (recordedFeatures.length === 0) {
      alert("No recorded gesture data");
      return;
    }
    // Set before anything async so the button visibly reacts the instant
    // it's clicked — the network calls below (consistency-check especially)
    // are what were making the button feel unresponsive, not the save
    // itself. This doesn't make the calls faster; it makes the click feel
    // instant regardless of how long they take.
    isSavingRef.current = true;
    setIsSaving(true);
    try {
      // Timing instrumentation — see gesture-save latency investigation.
      // Logs to the browser console so the two calls' real durations are
      // visible once this runs against the actual Render backend (can't be
      // measured from this sandbox — no network path to it).
      const consistencyStart = performance.now();
      const consistency = await checkGestureConsistency(
        gestureName,
        recordedFeatures,
      );
      console.log(
        `[gesture-save-timing] consistency-check: ${Math.round(performance.now() - consistencyStart)}ms`,
      );
      const existingType = consistency.existingGestureType ?? null;
      existingGestureTypeRef.current = existingType;
      if (existingType && existingType !== gestureType) {
        alert(
          `"${gestureName.trim()}" already has recordings saved as "${existingType}". ` +
            `Switch the toggle to "${existingType}" to add to this word, or use a different word.`,
        );
        setGestureType(existingType);
        return;
      }
      if (consistency.isOutlier) {
        const proceed = window.confirm(
          `This recording looks noticeably different from your other "${gestureName.trim()}" recordings ` +
            `(distance ${consistency.distance} vs. usual spread ${consistency.existingSpread}). ` +
            `Save it anyway, or cancel and retake?`,
        );
        if (!proceed) return;
      }
      // Save immediately once consistency-check has cleared — the hand-crop
      // upload no longer blocks this. It has no timeout of its own (unlike
      // every other call here) and stalling on it was the actual source of
      // the ~1 minute "gesture save" delay, since it used to run before
      // this call rather than after it.
      const saveStart = performance.now();
      const saveResult = await saveGesture({
        word: gestureName.trim(),
        language: "FSL",
        gestureType,
        features: averageFeatureFrames(recordedFeatures),
        sequence: recordedFeatures,
        frameCount: recordedFeatures.length,
      });
      console.log(
        `[gesture-save-timing] save gesture: ${Math.round(performance.now() - saveStart)}ms`,
      );
      if (!saveResult.success || !saveResult.gesture?.id) {
        alert(`Failed to save gesture: ${saveResult.error ?? "unknown error"}`);
        return;
      }
      // Fire-and-forget: upload the hand-shape crop and attach it to the
      // gesture we just created, in the background. See
      // uploadAndAttachHandCrop above for failure handling.
      const hadHandCrop = Boolean(handCropBlobRef.current);
      if (handCropBlobRef.current) {
        void uploadAndAttachHandCrop(
          saveResult.gesture.id,
          handCropBlobRef.current,
        );
      }
      const newCount = recordingsForCurrentWord + 1;
      setRecordingsForCurrentWord(newCount);
      onGestureSaved?.();
      // Only static (handshape) takes need a hand crop — it's shown to
      // admins/teachers as a reference thumbnail (see AdminSigns.tsx). A
      // missing crop on a dynamic (DTW) take is expected and fine, since
      // dynamic signs are matched on the landmark sequence alone. Without
      // this warning, a take with a failed/skipped crop capture (see
      // resolveHandBox()'s retry logic above) would save successfully with
      // zero visible indication that no reference image exists for it.
      const cropWarning =
        gestureType === "static" && !hadHandCrop
          ? "\n\n⚠️ No hand-shape image was captured for this take — there won't be a reference thumbnail for it. Consider re-recording with the hand more centered and steady."
          : "";
      if (newCount < RECOMMENDED_RECORDINGS) {
        alert(
          `Gesture saved! (${newCount}/${RECOMMENDED_RECORDINGS} recordings for "${gestureName.trim()}") — record ${RECOMMENDED_RECORDINGS - newCount} more from slightly different angles/distances.${cropWarning}`,
        );
      } else {
        alert(
          `Gesture saved! "${gestureName.trim()}" now has ${newCount} recordings — should be stable.${cropWarning}`,
        );
      }
      setShowNameDialog(false);
      setRecordedFeatures([]);
      setGestureType("dynamic");
      existingGestureTypeRef.current = null;
      framesRef.current = [];
      recognitionFramesRef.current = [];
      updateLabel("Waiting...");
    } catch (err) {
      console.error(err);
      alert("Failed to save gesture");
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [
    gestureName,
    gestureType,
    recordedFeatures,
    recordingsForCurrentWord,
    updateLabel,
  ]);
  useEffect(() => {
    if (!isCameraOn || !videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let stopped = false;
    let camera: any = null;
    // Kick off the YOLO model fetch in parallel with Holistic init (no-op
    // if YOLO_HAND_DETECTOR_CONFIG.ENABLED is false).
    preloadYoloHandDetector();
    const holistic = new Holistic({
      locateFile: (file: string) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`,
    });
    holistic.setOptions({
      modelComplexity: 0,
      smoothLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    holistic.onResults(async (results: any) => {
      if (stopped) return;
      try {
        if (ctx) {
          const w = video.videoWidth || 640;
          const h = video.videoHeight || 480;
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          drawSkeleton(ctx, results);
        }
        const features = extractFeatures(
          results.poseLandmarks,
          results.leftHandLandmarks,
          results.rightHandLandmarks,
          results.faceLandmarks || [],
        );
        if (features) {
          recognitionFramesRef.current.push({
            timestamp: Date.now(),
            features,
          });
          if (recognitionFramesRef.current.length > RECORD_FRAMES) {
            recognitionFramesRef.current.shift();
          }
        }
        const previewHasHands =
          (results.leftHandLandmarks &&
            results.leftHandLandmarks.length > 0) ||
          (results.rightHandLandmarks &&
            results.rightHandLandmarks.length > 0);
        {
          setCaptureWarning(
            getCaptureWarning(
              results.poseLandmarks,
              previewHasHands,
              wristHistoryRef.current,
              isRecordingRef.current,
              (results.faceLandmarks?.length ?? 0) > 0,
            ),
          );
        }
        if (features && isRecordingRef.current) {
          const hasHands =
            features.left_hand_open !== undefined &&
            ((results.leftHandLandmarks &&
              results.leftHandLandmarks.length > 0) ||
              (results.rightHandLandmarks &&
                results.rightHandLandmarks.length > 0));
          if (hasHands) {
            wristHistoryRef.current.push(wristSnapshot(features));
            if (wristHistoryRef.current.length > 3) {
              wristHistoryRef.current.shift();
            }
            const isGlitch = isTrackingGlitch(wristHistoryRef.current);
            if (isGlitch) {
              jitterEventsRef.current += 1;
              if (jitterEventsRef.current > MAX_JITTER_EVENTS_PER_TAKE) {
                isRecordingRef.current = false;
                setIsRecording(false);
                framesRef.current = [];
                setRecordProgress(0);
                jitterEventsRef.current = 0;
                updateLabel(
                  "Recording unstable — hold your hand steady and try again",
                );
                return;
              }
            } else {
              framesRef.current.push({
                timestamp: Date.now(),
                features,
              });
              setRecordProgress(framesRef.current.length);
              // Capture the hand-shape crop once per take, retried on every
              // incoming frame from the temporal midpoint onward (not just
              // a single attempt) until one succeeds or the take ends —
              // resolveHandBox() can legitimately come back empty on any
              // one frame (hand mid-blink of motion blur, landmarks not
              // detected that exact instant), and a single-shot attempt
              // was silently leaving handCropBlobRef null for the whole
              // take whenever that one frame didn't cooperate. Guarded by
              // handCropAttemptInFlightRef so overlapping frames don't
              // kick off concurrent resolveHandBox() calls.
              if (
                !handCropCapturedForTakeRef.current &&
                !handCropAttemptInFlightRef.current &&
                framesRef.current.length >= Math.floor(RECORD_FRAMES / 2)
              ) {
                handCropAttemptInFlightRef.current = true;
                const handLandmarks =
                  results.rightHandLandmarks?.length >=
                  (results.leftHandLandmarks?.length ?? 0)
                    ? results.rightHandLandmarks
                    : results.leftHandLandmarks;
                resolveHandBox(video, handLandmarks)
                  .then((box) => {
                    if (!box) return null;
                    return captureHandCropBlob(video, box);
                  })
                  .then((blob) => {
                    if (blob) {
                      handCropBlobRef.current = blob;
                      handCropCapturedForTakeRef.current = true;
                    }
                    // No blob this frame — leave the "captured" flag false
                    // so the next frame retries automatically.
                  })
                  .catch((err) =>
                    console.warn("Hand-crop capture failed:", err),
                  )
                  .finally(() => {
                    handCropAttemptInFlightRef.current = false;
                  });
              }
              if (framesRef.current.length >= RECORD_FRAMES) {
                await finishRecording([...framesRef.current]);
              }
            }
          }
        }
        if (
          features &&
          previewHasHands &&
          !isRecordingRef.current &&
          !recognitionLockRef.current
        ) {
          const now = Date.now();
          if (now - recognitionCooldownRef.current > RECOGNITION_INTERVAL) {
            recognitionCooldownRef.current = now;
            recognitionLockRef.current = true;
            try {
              const result = await recognize({
                features,
                sequence: recognitionFramesRef.current,
                gestureType: "dynamic",
              });
              if (result?.recognized && result.word) {
                const confidence = result.confidence ?? 0;
                if (streakWordRef.current === result.word) {
                  streakCountRef.current += 1;
                } else {
                  streakWordRef.current = result.word;
                  streakCountRef.current = 1;
                }
                if (streakCountRef.current >= CONSECUTIVE_MATCH_THRESHOLD) {
                  const isSameAsLocked = lockedWordRef.current === result.word;
                  const noWordLocked = lockedWordRef.current === null;
                  const clearlyBetter =
                    confidence >=
                    lockedConfidenceRef.current + SWITCH_CONFIDENCE_MARGIN;
                  if (isSameAsLocked || noWordLocked || clearlyBetter) {
                    lockedWordRef.current = result.word;
                    lockedConfidenceRef.current = confidence;
                    updateLabel(`${result.word} (${confidence}%)`);
                  }
                }
              } else {
                streakWordRef.current = null;
                streakCountRef.current = 0;
              }
            } catch (err) {
              console.error("Recognition error:", err);
            } finally {
              recognitionLockRef.current = false;
            }
          }
        }
        if (
          !isRecordingRef.current &&
          currentLabelRef.current === "Waiting..." &&
          results.poseLandmarks
        ) {
          const pose = detectPoseGesture(results.poseLandmarks);
          if (pose && pose !== "detecting") {
            updateLabel(pose);
          }
        }
      } catch (err) {
        console.error("Error in holistic results:", err);
      }
    });
    camera = new Camera(video, {
      onFrame: async () => {
        if (stopped || holisticClosedRef.current) return;
        try {
          await holistic.send({
            image: video,
          });
        } catch (err) {
          console.warn("Holistic send failed", err);
        }
      },
      width: 640,
      height: 480,
      selfieMode: true,
    });
    camera.start();
    return () => {
      stopped = true;
      camera?.stop();
      holisticClosedRef.current = true;
      holistic.close();
    };
  }, [isCameraOn, finishRecording, updateLabel]);
  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <div style={styles.headerLeft}>
          <span style={styles.liveDot(isCameraOn)} />
          <h2 style={styles.headerTitle}>{currentLabel}</h2>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.type.startsWith("image/")) void processUploadedImage(file);
              else void processUploadedVideo(file);
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessingUpload || isRecording}
            style={styles.toggleBtn(false)}
          >
            {isProcessingUpload
              ? `Processing ${uploadProgress}/${RECORD_FRAMES}...`
              : "Upload Video / Image"}
          </button>
          <button
            onClick={() => setIsCameraOn((v) => !v)}
            disabled={isProcessingUpload}
            style={styles.toggleBtn(isCameraOn)}
          >
            {isCameraOn ? "Close Camera" : "Open Camera"}
          </button>
        </div>
      </div>

      <p style={styles.recordingForText}>
        You can upload a video (any sign) or an image (static hand shapes only) as a reference sample.
      </p>

      {gestureName && (
        <p style={styles.recordingForText}>
          Recording for:{" "}
          <strong
            style={{
              color: "#fff",
            }}
          >
            {gestureName}
          </strong>{" "}
          <span style={styles.badge}>
            {recordingsForCurrentWord}/{RECOMMENDED_RECORDINGS}
          </span>
        </p>
      )}

      {isCameraOn ? (
        <div style={styles.cameraCard}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={styles.video}
          />
          <canvas ref={canvasRef} style={styles.canvas} />

          <div style={styles.topScrim} />
          <div style={styles.bottomScrim} />

          {captureWarning && (
            <div style={styles.captureWarningBanner}>⚠ {captureWarning}</div>
          )}

          <button
            onClick={startRecording}
            disabled={isRecording}
            style={styles.recordBtn(isRecording)}
          >
            <span style={styles.recordDot(isRecording)} />
            {isRecording
              ? `Recording ${recordProgress}/${RECORD_FRAMES}`
              : "Record Gesture"}
          </button>

          {isRecording && (
            <div style={styles.progressTrack}>
              <div
                style={{
                  ...styles.progressFill,
                  width: `${(recordProgress / RECORD_FRAMES) * 100}%`,
                }}
              />
            </div>
          )}

          {countdown !== null && (
            <div style={styles.countdownOverlay}>
              <span style={styles.countdownNumber}>{countdown}</span>
            </div>
          )}
        </div>
      ) : (
        <div style={styles.cameraOffCard}>
          <div style={styles.cameraOffIcon}>📷</div>
          <p style={styles.cameraOffText}>Camera is off</p>
          <p style={styles.cameraOffSubtext}>
            Click "Open Camera" to begin recording signs.
          </p>
        </div>
      )}

      {showNameDialog && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <h3 style={styles.modalTitle}>Save Gesture</h3>
            <p style={styles.modalTip}>
              Tip: record the same sign 3+ times from slightly different angles
              for best accuracy.
            </p>

            <input
              autoFocus
              type="text"
              value={gestureName}
              onChange={(e) => {
                const newName = e.target.value;
                if (newName.trim() !== gestureName.trim()) {
                  setRecordingsForCurrentWord(0);
                }
                setGestureName(newName);
              }}
              placeholder="e.g. HELLO"
              style={styles.modalInput}
            />

            <div style={styles.gestureTypeRow}>
              {(["dynamic", "static"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setGestureType(type)}
                  style={{
                    ...styles.gestureTypeBtn,
                    ...(gestureType === type
                      ? styles.gestureTypeBtnActive
                      : {}),
                  }}
                >
                  {type === "dynamic" ? "Dynamic (motion)" : "Static (handshape)"}
                </button>
              ))}
            </div>
            <p style={styles.modalTip}>
              A word is always one or the other — pick "Static" only for
              signs that are a single held handshape with no movement.
            </p>

            <div style={styles.modalActions}>
              <button
                onClick={saveRecordedGesture}
                disabled={isSaving}
                style={{
                  ...styles.modalSaveBtn,
                  ...(isSaving ? styles.modalSaveBtnDisabled : {}),
                }}
              >
                {isSaving ? "Saving..." : "Save Gesture"}
              </button>
              <button
                onClick={() => {
                  setShowNameDialog(false);
                  setGestureName("");
                  setRecordedFeatures([]);
                  setRecordingsForCurrentWord(0);
                  setGestureType("dynamic");
                  existingGestureTypeRef.current = null;
                  framesRef.current = [];
                  recognitionFramesRef.current = [];
                  handCropBlobRef.current = null;
                  handCropCapturedForTakeRef.current = false;
                  handCropAttemptInFlightRef.current = false;
                }}
                disabled={isSaving}
                style={styles.modalCancelBtn}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
const styles = {
  page: {
    width: "100%",
    margin: "0 auto",
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  } as React.CSSProperties,
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  } as React.CSSProperties,
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } as React.CSSProperties,
  liveDot: (active: boolean): React.CSSProperties => ({
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: active ? "#00e676" : "#555",
    boxShadow: active ? "0 0 8px #00e676" : "none",
    transition: "all 0.3s ease",
  }),
  headerTitle: {
    margin: 0,
    color: "#fff",
    fontSize: 19,
    fontWeight: 600,
    letterSpacing: 0.2,
  } as React.CSSProperties,
  toggleBtn: (active: boolean): React.CSSProperties => ({
    padding: "9px 18px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: active ? "rgba(255,68,68,0.12)" : "rgba(0,204,102,0.12)",
    color: active ? "#ff6b6b" : "#00cc66",
    fontWeight: 600,
    fontSize: 13.5,
    cursor: "pointer",
    transition: "all 0.2s ease",
  }),
  recordingForText: {
    fontSize: 13,
    color: "#999",
    marginBottom: 12,
  } as React.CSSProperties,
  badge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    background: "rgba(0,204,102,0.15)",
    color: "#00cc66",
    fontSize: 11.5,
    fontWeight: 700,
    marginLeft: 6,
  } as React.CSSProperties,
  cameraCard: {
    position: "relative",
    width: "100%",
    height: "490px",
    background: "#0b0b14",
    borderRadius: 20,
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow:
      "0 10px 40px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.03)",
  } as React.CSSProperties,
  video: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: "scaleX(-1)",
    display: "block",
  } as React.CSSProperties,
  canvas: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: 2,
    transform: "scaleX(-1)",
  } as React.CSSProperties,
  topScrim: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: 90,
    background: "linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0))",
    zIndex: 3,
    pointerEvents: "none",
  } as React.CSSProperties,
  bottomScrim: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: "100%",
    height: 110,
    background: "linear-gradient(0deg, rgba(0,0,0,0.6), rgba(0,0,0,0))",
    zIndex: 3,
    pointerEvents: "none",
  } as React.CSSProperties,
  captureWarningBanner: {
    position: "absolute",
    top: 66,
    left: 12,
    right: 12,
    zIndex: 10,
    margin: "0 auto",
    width: "fit-content",
    maxWidth: "calc(100% - 24px)",
    padding: "7px 14px",
    fontSize: 12.5,
    fontWeight: 600,
    color: "#1a1200",
    background: "rgba(255,204,0,0.95)",
    borderRadius: 14,
    whiteSpace: "normal",
    textAlign: "center",
    lineHeight: 1.3,
    boxSizing: "border-box",
    boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
  } as React.CSSProperties,
  recordBtn: (recording: boolean): React.CSSProperties => ({
    position: "absolute",
    top: 18,
    left: 18,
    zIndex: 10,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 18px",
    fontSize: 14.5,
    fontWeight: 600,
    background: recording ? "rgba(255,68,68,0.92)" : "rgba(0,204,102,0.92)",
    color: "white",
    border: "none",
    borderRadius: 999,
    cursor: recording ? "default" : "pointer",
    backdropFilter: "blur(6px)",
    boxShadow: recording
      ? "0 0 16px rgba(255,68,68,0.5)"
      : "0 0 16px rgba(0,204,102,0.4)",
  }),
  recordDot: (recording: boolean): React.CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: recording ? 2 : "50%",
    background: "#fff",
  }),
  progressTrack: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: "100%",
    height: 4,
    background: "rgba(255,255,255,0.08)",
    zIndex: 10,
  } as React.CSSProperties,
  progressFill: {
    height: "100%",
    background: "linear-gradient(90deg, #00cc66, #00ffcc)",
    transition: "width 0.15s linear",
  } as React.CSSProperties,
  countdownOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "rgba(0,0,0,0.65)",
    backdropFilter: "blur(2px)",
    zIndex: 20,
  } as React.CSSProperties,
  countdownNumber: {
    fontSize: 130,
    fontWeight: 800,
    color: "#fff",
    textShadow: "0 0 30px rgba(0,255,204,0.6)",
  } as React.CSSProperties,
  cameraOffCard: {
    width: "100%",
    height: "490px",
    background: "#13131f",
    borderRadius: 20,
    border: "1px dashed rgba(255,255,255,0.12)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  } as React.CSSProperties,
  cameraOffIcon: {
    fontSize: 40,
    opacity: 0.5,
    marginBottom: 6,
  } as React.CSSProperties,
  cameraOffText: {
    color: "#bbb",
    fontSize: 17,
    fontWeight: 600,
    margin: 0,
  } as React.CSSProperties,
  cameraOffSubtext: {
    color: "#666",
    fontSize: 13,
    margin: 0,
  } as React.CSSProperties,
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.85)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
    backdropFilter: "blur(4px)",
  } as React.CSSProperties,
  modalCard: {
    background: "#16161f",
    padding: 32,
    borderRadius: 16,
    minWidth: 380,
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
  } as React.CSSProperties,
  modalTitle: {
    margin: "0 0 6px",
    fontSize: 19,
  } as React.CSSProperties,
  modalTip: {
    fontSize: 13,
    color: "#999",
    marginBottom: 16,
    lineHeight: 1.4,
  } as React.CSSProperties,
  modalInput: {
    width: "100%",
    padding: 12,
    marginBottom: 16,
    background: "#222230",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    color: "#fff",
    fontSize: 15,
    boxSizing: "border-box",
  } as React.CSSProperties,
  gestureTypeRow: {
    display: "flex",
    gap: 8,
    marginBottom: 8,
  } as React.CSSProperties,
  gestureTypeBtn: {
    flex: 1,
    padding: "10px 8px",
    background: "#222230",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    color: "#aaa",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  } as React.CSSProperties,
  gestureTypeBtnActive: {
    background: "#3a3aff22",
    border: "1px solid #6c6cff",
    color: "#fff",
  } as React.CSSProperties,
  modalActions: {
    display: "flex",
    gap: 12,
  } as React.CSSProperties,
  modalSaveBtn: {
    flex: 1,
    padding: "12px",
    background: "#00cc66",
    color: "white",
    border: "none",
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  } as React.CSSProperties,
  modalSaveBtnDisabled: {
    background: "#0a8a49",
    cursor: "not-allowed",
    opacity: 0.75,
  } as React.CSSProperties,
  modalCancelBtn: {
    flex: 1,
    padding: "12px",
    background: "rgba(255,255,255,0.08)",
    color: "white",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    fontSize: 15,
    cursor: "pointer",
  } as React.CSSProperties,
};
export default AdminSignRecorder;