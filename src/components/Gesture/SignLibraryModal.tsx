import React, { useEffect, useRef, useState } from "react";
import {
  apiClient,
  deleteSignAsset,
  replaceSignAssetMedia,
  uploadSignAsset,
} from "../../services/api";
import {
  getGestureLibrary,
  type RegisteredGestureLibraryEntry,
} from "../../services/gestureApi";
import { resolveApiUrl } from "../../config";
import type { SignAsset } from "./types";

const ADD_LANGUAGES = ["English", "Cebuano", "Tagalog", "Ilocano", "Bikolano"];
const MIN_SIGN_VIDEO_MS = 2000;
const MAX_SIGN_VIDEO_MS = 5000;

// Candidates in preference order — MediaRecorder support varies by
// browser. Safari records video/mp4 directly; Chrome/Firefox only
// support webm variants. The backend's ALLOWED_MIME_TYPES accepts both.
const RECORDER_MIME_CANDIDATES = [
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

interface LibraryItem {
  key: string;
  kind: "uploaded" | "recorded";
  word: string;
  file: string | null;
  type: string;
  asset?: SignAsset;
  gestureType?: string;
  recordingCount?: number;
}

function pickRecorderMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const candidate of RECORDER_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return null;
}

function extensionForMimeType(mime: string): string {
  if (mime.startsWith("video/mp4")) return "mp4";
  if (mime.startsWith("video/webm")) return "webm";
  return "dat";
}

function readVideoDurationMs(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const durationMs = video.duration * 1000;
      video.onloadedmetadata = null;
      video.onerror = null;
      URL.revokeObjectURL(url);
      if (!Number.isFinite(durationMs)) {
        reject(new Error("Could not read the video duration."));
        return;
      }
      resolve(durationMs);
    };
    video.onerror = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      URL.revokeObjectURL(url);
      reject(new Error("Could not read the video duration."));
    };
    video.src = url;
  });
}

interface SignLibraryModalProps {
  onClose: () => void;
  mode: "gesture" | "speech";
  language?: string;
  canEditMedia: boolean;
  canDeleteAssets: boolean;
  initialEditAssetId?: number;
  // Called after a successful record/upload, media edit, or deletion, so the parent
  // can refresh SpeechGesture's word list without a page reload — see
  // refreshSignsVersion in SpeechGesture.tsx.
  onSignAdded?: () => void;
}

type RecordState = "idle" | "requesting" | "live" | "recording" | "recorded" | "error";
type EditCameraState =
  | "idle"
  | "requesting"
  | "live"
  | "recording"
  | "captured"
  | "error";

const SignLibraryModal: React.FC<SignLibraryModalProps> = ({
  onClose,
  mode,
  language,
  canEditMedia,
  canDeleteAssets,
  initialEditAssetId,
  onSignAdded,
}) => {
  const [assets, setAssets] = useState<SignAsset[]>([]);
  const [recordedGestures, setRecordedGestures] = useState<
    RegisteredGestureLibraryEntry[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [showAddPanel, setShowAddPanel] = useState(false);
  const [newWord, setNewWord] = useState("");
  const [newLanguage, setNewLanguage] = useState(language || "English");
  const [translationsInput, setTranslationsInput] = useState("{}");
  const [aliasesInput, setAliasesInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingAssetId, setDeletingAssetId] = useState<number | null>(null);

  // Record-a-sign panel (mode === "gesture")
  const [recordState, setRecordState] = useState<RecordState>("idle");
  const [canStopRecording, setCanStopRecording] = useState(false);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordedMimeRef = useRef<string>("video/webm");
  const recordingStartedAtRef = useRef(0);
  const minimumDurationTimerRef = useRef<number | null>(null);
  const maximumDurationTimerRef = useRef<number | null>(null);
  const editMinimumDurationTimerRef = useRef<number | null>(null);
  const editMaximumDurationTimerRef = useRef<number | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [editingAsset, setEditingAsset] = useState<SignAsset | null>(null);
  const [editCanStopRecording, setEditCanStopRecording] = useState(false);
  const [editCameraState, setEditCameraState] =
    useState<EditCameraState>("idle");
  const [editMediaFile, setEditMediaFile] = useState<File | null>(null);
  const [editPreviewUrl, setEditPreviewUrl] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const editVideoRef = useRef<HTMLVideoElement | null>(null);
  const editRecordedChunksRef = useRef<Blob[]>([]);
  const editRecordedMimeRef = useRef("video/webm");
  const editRecordingStartedAtRef = useRef(0);
  const editRecordingCancelledRef = useRef(false);
  const editCameraRequestIdRef = useRef(0);

  // Upload-a-sign panel (mode === "speech")
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedPreviewUrl, setSelectedPreviewUrl] = useState<string | null>(null);

  const gestureTypeForWord = (word: string) =>
    recordedGestures.find(
      (gesture) =>
        gesture.word.trim().toLowerCase() === word.trim().toLowerCase(),
    )?.gestureType?.toLowerCase();
  const isDynamicGesture = (word: string) =>
    gestureTypeForWord(word) === "dynamic";

  const loadAssets = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      apiClient.get<SignAsset[]>("/signs"),
      getGestureLibrary(),
    ])
      .then(([assetData, gestureData]) => {
        if (!gestureData.success) {
          throw new Error(gestureData.error ?? "Failed to load registered gestures");
        }
        setAssets(Array.isArray(assetData) ? assetData : []);
        setRecordedGestures(gestureData.words);
      })
      .catch((err) => {
        console.error("Failed to load sign library:", err);
        setError("Couldn't load the sign library. Try again in a moment.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiClient.get<SignAsset[]>("/signs"),
      getGestureLibrary(),
    ])
      .then(([assetData, gestureData]) => {
        if (!gestureData.success) {
          throw new Error(gestureData.error ?? "Failed to load registered gestures");
        }
        if (!cancelled) {
          setAssets(Array.isArray(assetData) ? assetData : []);
          setRecordedGestures(gestureData.words);
          if (initialEditAssetId !== undefined && canEditMedia) {
            const initialAsset = assetData.find(
              (asset) => asset.id === initialEditAssetId,
            );
            if (initialAsset) {
              setEditingAsset(initialAsset);
            } else {
              setError("That sign is no longer available in the library.");
            }
          }
        }
      })
      .catch((err) => {
        console.error("Failed to load sign library:", err);
        if (!cancelled) setError("Couldn't load the sign library. Try again in a moment.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canEditMedia, initialEditAssetId]);

  // Always release the camera when the panel is closed/unmounted — never
  // leave the recording light on after the modal goes away.
  const stopCameraTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };
  const clearRecordingTimers = () => {
    if (minimumDurationTimerRef.current !== null) {
      window.clearTimeout(minimumDurationTimerRef.current);
      minimumDurationTimerRef.current = null;
    }
    if (maximumDurationTimerRef.current !== null) {
      window.clearTimeout(maximumDurationTimerRef.current);
      maximumDurationTimerRef.current = null;
    }
  };
  const clearEditRecordingTimers = () => {
    if (editMinimumDurationTimerRef.current !== null) {
      window.clearTimeout(editMinimumDurationTimerRef.current);
      editMinimumDurationTimerRef.current = null;
    }
    if (editMaximumDurationTimerRef.current !== null) {
      window.clearTimeout(editMaximumDurationTimerRef.current);
      editMaximumDurationTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      editCameraRequestIdRef.current += 1;
      clearRecordingTimers();
      clearEditRecordingTimers();
      if (mediaRecorderRef.current?.state === "recording") {
        editRecordingCancelledRef.current = true;
        mediaRecorderRef.current.stop();
      }
      stopCameraTracks();
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      if (selectedPreviewUrl) URL.revokeObjectURL(selectedPreviewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!editPreviewUrl) return;
    return () => URL.revokeObjectURL(editPreviewUrl);
  }, [editPreviewUrl]);

  useEffect(() => {
    if (
      (editCameraState !== "live" && editCameraState !== "recording") ||
      !streamRef.current ||
      !editVideoRef.current
    ) {
      return;
    }
    editVideoRef.current.srcObject = streamRef.current;
    void editVideoRef.current.play().catch((err: unknown) => {
      console.error("Could not start the media-edit camera preview:", err);
      setEditError("The camera preview could not start. Try again.");
    });
  }, [editCameraState]);

  const resetAddPanel = () => {
    stopCameraTracks();
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    if (selectedPreviewUrl) URL.revokeObjectURL(selectedPreviewUrl);
    setRecordState("idle");
    setRecordedUrl(null);
    setRecordedBlob(null);
    setSelectedFile(null);
    setSelectedPreviewUrl(null);
    setNewWord("");
    setTranslationsInput("{}");
    setAliasesInput("");
    setSubmitError(null);
  };

  const closeAddPanel = () => {
    resetAddPanel();
    setShowAddPanel(false);
  };

  const addMediaForWord = (word: string) => {
    resetAddPanel();
    setNewWord(word);
    setShowAddPanel(true);
  };

  const startCamera = async () => {
    setSubmitError(null);
    setRecordState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      streamRef.current = stream;
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        await videoPreviewRef.current.play().catch(() => {});
      }
      setRecordState("live");
    } catch (err) {
      console.error("Camera access failed:", err);
      setSubmitError(
        "Couldn't access your camera — check your browser's camera permission and try again.",
      );
      setRecordState("error");
    }
  };

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = pickRecorderMimeType();
    if (!mimeType) {
      setSubmitError("Video recording isn't supported in this browser.");
      setRecordState("error");
      return;
    }
    recordedMimeRef.current = mimeType;
    recordedChunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      clearRecordingTimers();
      const blob = new Blob(recordedChunksRef.current, { type: mimeType });
      setRecordedBlob(blob);
      setRecordedUrl(URL.createObjectURL(blob));
      stopCameraTracks();
      setRecordState("recorded");
      setCanStopRecording(false);
    };
    mediaRecorderRef.current = recorder;
    recorder.start(100);
    recordingStartedAtRef.current = Date.now();
    setCanStopRecording(false);
    minimumDurationTimerRef.current = window.setTimeout(
      () => setCanStopRecording(true),
      MIN_SIGN_VIDEO_MS,
    );
    maximumDurationTimerRef.current = window.setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, MAX_SIGN_VIDEO_MS);
    setRecordState("recording");
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    if (Date.now() - recordingStartedAtRef.current < MIN_SIGN_VIDEO_MS) return;
    clearRecordingTimers();
    recorder.stop();
  };

  const retakeRecording = () => {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedUrl(null);
    setRecordedBlob(null);
    void startCamera();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setSubmitError(null);
    if (selectedPreviewUrl) URL.revokeObjectURL(selectedPreviewUrl);
    if (!file) {
      setSelectedFile(null);
      setSelectedPreviewUrl(null);
      return;
    }
    const allowed = [
      "video/mp4",
      "video/webm",
      "image/jpeg",
      "image/png",
      "image/webp",
    ];
    if (!allowed.includes(file.type)) {
      setSubmitError("Only MP4/WEBM video or JPG/PNG/WEBP images are allowed.");
      setSelectedFile(null);
      setSelectedPreviewUrl(null);
      return;
    }
    if (isDynamicGesture(newWord) && !file.type.startsWith("video/")) {
      setSubmitError("Dynamic signs must use video media.");
      setSelectedFile(null);
      setSelectedPreviewUrl(null);
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setSubmitError("File is too large (25MB max).");
      setSelectedFile(null);
      setSelectedPreviewUrl(null);
      return;
    }
    setSelectedFile(file);
    setSelectedPreviewUrl(URL.createObjectURL(file));
  };

  const submitAsset = async (file: File) => {
    if (!newWord.trim()) {
      setSubmitError("Enter the word this sign is for first.");
      return;
    }
    if (isDynamicGesture(newWord) && !file.type.startsWith("video/")) {
      setSubmitError("Dynamic signs must use video media.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const translations: unknown = JSON.parse(translationsInput);
      if (
        !translations ||
        typeof translations !== "object" ||
        Array.isArray(translations) ||
        Object.values(translations).some(
          (translation) =>
            typeof translation !== "string" || !translation.trim(),
        )
      ) {
        throw new Error("Translations must be a JSON object of language and text pairs.");
      }
      await uploadSignAsset(file, {
        word: newWord.trim(),
        language: newLanguage,
        translations: translations as Record<string, string>,
        aliases: aliasesInput
          .split(",")
          .map((alias) => alias.trim())
          .filter(Boolean),
      });
      setSubmitSuccess(`"${newWord.trim()}" added to the library.`);
      closeAddPanel();
      setShowAddPanel(false);
      loadAssets();
      onSignAdded?.();
      setTimeout(() => setSubmitSuccess(null), 4000);
    } catch (err) {
      console.error("Sign upload failed:", err);
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Upload failed. Check your connection and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitRecording = () => {
    if (!recordedBlob) return;
    const ext = extensionForMimeType(recordedMimeRef.current);
    const file = new File([recordedBlob], `sign-${Date.now()}.${ext}`, {
      type: recordedMimeRef.current,
    });
    void submitAsset(file);
  };

  const handleSubmitUpload = () => {
    if (!selectedFile) {
      setSubmitError("Choose a file first.");
      return;
    }
    void submitAsset(selectedFile);
  };

  const captureNewImage = async () => {
    if (!newWord.trim()) {
      setSubmitError("Enter the word this sign is for first.");
      return;
    }
    if (isDynamicGesture(newWord)) {
      setSubmitError("Dynamic signs must use video media.");
      return;
    }
    const video = videoPreviewRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setSubmitError("The camera is not ready yet. Please wait and try again.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setSubmitError("This browser cannot capture an image from the camera.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (captured) =>
            captured
              ? resolve(captured)
              : reject(new Error("Could not capture the camera image.")),
          "image/jpeg",
          0.9,
        );
      });
      stopCameraTracks();
      setRecordState("idle");
      const file = new File([blob], `sign-image-${Date.now()}.jpg`, {
        type: "image/jpeg",
      });
      await submitAsset(file);
    } catch (err) {
      console.error("Could not capture the new sign photo:", err);
      setSubmitError(
        err instanceof Error ? err.message : "Could not capture the photo.",
      );
    }
  };

  const startEditCamera = async () => {
    const requestId = ++editCameraRequestIdRef.current;
    setEditError(null);
    setEditCanStopRecording(false);
    setEditCameraState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      if (requestId !== editCameraRequestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setEditCameraState("live");
    } catch (err) {
      if (requestId !== editCameraRequestIdRef.current) return;
      console.error("Camera access for sign image editing failed:", err);
      setEditError(
        "Couldn't access your camera — check the browser's camera permission and try again.",
      );
      setEditCameraState("error");
    }
  };

  const startEditRecording = () => {
    const stream = streamRef.current;
    if (!stream) {
      setEditError("Start the camera before recording a video.");
      return;
    }
    const mimeType = pickRecorderMimeType();
    if (!mimeType) {
      setEditError("Video recording isn't supported in this browser.");
      return;
    }

    editRecordingCancelledRef.current = false;
    editRecordedMimeRef.current = mimeType;
    editRecordedChunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) editRecordedChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      clearEditRecordingTimers();
      setEditCanStopRecording(false);
      if (editRecordingCancelledRef.current) {
        editRecordingCancelledRef.current = false;
        return;
      }

      const blob = new Blob(editRecordedChunksRef.current, { type: mimeType });
      if (blob.size === 0) {
        setEditError("The camera did not produce a video. Try recording again.");
        setEditCameraState("error");
        stopCameraTracks();
        return;
      }

      const file = new File(
        [blob],
        `sign-video-${Date.now()}.${extensionForMimeType(mimeType)}`,
        { type: mimeType },
      );
      setEditMediaFile(file);
      setEditPreviewUrl(URL.createObjectURL(file));
      setEditCameraState("captured");
      stopCameraTracks();
    };

    mediaRecorderRef.current = recorder;
    recorder.start(100);
    editRecordingStartedAtRef.current = Date.now();
    setEditCanStopRecording(false);
    editMinimumDurationTimerRef.current = window.setTimeout(
      () => setEditCanStopRecording(true),
      MIN_SIGN_VIDEO_MS,
    );
    editMaximumDurationTimerRef.current = window.setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, MAX_SIGN_VIDEO_MS);
    setEditError(null);
    setEditCameraState("recording");
  };

  const stopEditRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (
      !recorder ||
      recorder.state !== "recording" ||
      Date.now() - editRecordingStartedAtRef.current < MIN_SIGN_VIDEO_MS
    ) {
      return;
    }
    clearEditRecordingTimers();
    recorder.stop();
  };

  const captureEditImage = async () => {
    if (editingAsset && isDynamicGesture(editingAsset.word)) {
      setEditError("Dynamic signs must use video media.");
      return;
    }
    const video = editVideoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setEditError("The camera is not ready yet. Please wait and try again.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setEditError("This browser cannot capture an image from the camera.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (captured) =>
            captured
              ? resolve(captured)
              : reject(new Error("Could not capture the camera image.")),
          "image/jpeg",
          0.9,
        );
      });
      const file = new File([blob], `sign-image-${Date.now()}.jpg`, {
        type: "image/jpeg",
      });
      setEditMediaFile(file);
      setEditPreviewUrl(URL.createObjectURL(file));
      setEditError(null);
      stopCameraTracks();
      setEditCameraState("captured");
    } catch (err) {
      console.error("Could not capture the sign image:", err);
      setEditError(
        err instanceof Error ? err.message : "Could not capture the image.",
      );
    }
  };

  const handleEditFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    setEditError(null);
    if (!file) return;
    stopCameraTracks();
    setEditMediaFile(null);
    setEditPreviewUrl(null);
    setEditCameraState("idle");
    const allowed = [
      "video/mp4",
      "video/webm",
      "image/jpeg",
      "image/png",
      "image/webp",
    ];
    if (!allowed.includes(file.type)) {
      setEditError("Choose an MP4/WEBM video or a JPG/PNG/WEBP image.");
      return;
    }
    if (
      editingAsset &&
      isDynamicGesture(editingAsset.word) &&
      !file.type.startsWith("video/")
    ) {
      setEditError("Dynamic signs must use video media.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setEditError("File is too large (25MB max).");
      return;
    }
    if (file.type.startsWith("video/")) {
      try {
        const durationMs = await readVideoDurationMs(file);
        if (durationMs < MIN_SIGN_VIDEO_MS || durationMs > MAX_SIGN_VIDEO_MS) {
          setEditError("Choose a video that is between 2 and 5 seconds long.");
          return;
        }
      } catch (error) {
        console.error("Could not read the uploaded sign video duration:", error);
        setEditError("Could not read the video duration. Choose another video.");
        return;
      }
    }
    setEditMediaFile(file);
    setEditPreviewUrl(URL.createObjectURL(file));
    setEditCameraState("captured");
  };

  const cancelMediaEdit = () => {
    editCameraRequestIdRef.current += 1;
    clearEditRecordingTimers();
    if (editCameraState === "recording") {
      editRecordingCancelledRef.current = true;
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    }
    stopCameraTracks();
    setEditingAsset(null);
    setEditCanStopRecording(false);
    setEditCameraState("idle");
    setEditMediaFile(null);
    setEditPreviewUrl(null);
    setEditError(null);
  };

  const saveEditedMedia = async () => {
    if (!editingAsset || !editMediaFile) return;
    if (
      isDynamicGesture(editingAsset.word) &&
      !editMediaFile.type.startsWith("video/")
    ) {
      setEditError("Dynamic signs must use video media.");
      return;
    }
    setSubmitting(true);
    setEditError(null);
    try {
      const updated = await replaceSignAssetMedia(editingAsset.id, editMediaFile);
      setAssets((current) =>
        current.map((asset) =>
          asset.id === updated.id
            ? { ...asset, file: updated.file, type: updated.type }
            : asset,
        ),
      );
      setSubmitSuccess(`The sign media for "${updated.word}" was updated.`);
      cancelMediaEdit();
      onSignAdded?.();
      setTimeout(() => setSubmitSuccess(null), 4000);
    } catch (err) {
      console.error("Sign media update failed:", err);
      setEditError(
        err instanceof Error
          ? err.message
          : "Media update failed. Check your connection and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const deleteAsset = async (asset: SignAsset) => {
    if (!canDeleteAssets || deletingAssetId !== null) return;
    if (
      !window.confirm(
        `Delete "${asset.word}" and its uploaded media? This cannot be undone.`,
      )
    ) {
      return;
    }

    setDeleteError(null);
    setDeletingAssetId(asset.id);
    try {
      await deleteSignAsset(asset.id, asset.word);
      setAssets((current) => current.filter((entry) => entry.id !== asset.id));
      if (editingAsset?.id === asset.id) cancelMediaEdit();
      setSubmitSuccess(`"${asset.word}" was deleted.`);
      onSignAdded?.();
      setTimeout(() => setSubmitSuccess(null), 4000);
    } catch (err) {
      console.error("Sign deletion failed:", err);
      setDeleteError(
        err instanceof Error
          ? err.message
          : "Sign deletion failed. Check your connection and try again.",
      );
    } finally {
      setDeletingAssetId(null);
    }
  };

  const normalizedSearch = search.trim().toLowerCase();
  const matchingAssets = assets.filter((asset) =>
    asset.word.toLowerCase().includes(normalizedSearch),
  );
  const assetWords = new Set(
    assets.map((asset) => asset.word.trim().toLowerCase()),
  );
  const registeredGesturesByWord = new Map(
    recordedGestures.map((gesture) => [
      gesture.word.trim().toLowerCase(),
      gesture,
    ]),
  );
  const filtered: LibraryItem[] = [
    ...matchingAssets.map((asset) => {
      const registration = registeredGesturesByWord.get(
        asset.word.trim().toLowerCase(),
      );
      return {
        key: `asset-${asset.id}`,
        kind: "uploaded" as const,
        word: asset.word,
        file: asset.file,
        type: asset.type,
        asset,
        gestureType: registration?.gestureType,
        recordingCount: registration?.count,
      };
    }),
    ...recordedGestures
      .filter(
        (gesture) =>
          gesture.word.toLowerCase().includes(normalizedSearch) &&
          !assetWords.has(gesture.word.trim().toLowerCase()),
      )
      .map((gesture) => ({
        key: `recorded-${gesture.word}`,
        kind: "recorded" as const,
        word: gesture.word,
        file:
          gesture.gestureType.toLowerCase() === "dynamic"
            ? null
            : gesture.handCropUrl,
        type:
          gesture.gestureType.toLowerCase() === "dynamic"
            ? "video/"
            : "image/",
        gestureType: gesture.gestureType,
        recordingCount: gesture.count,
      })),
  ];

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(4px)",
          zIndex: 1400,
        }}
      />
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(760px, 92vw)",
          maxHeight: "86vh",
          background: "var(--pearl-surface, #fff)",
          border: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
          borderRadius: "16px",
          zIndex: 1401,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 25px 60px rgba(15,23,42,0.25)",
        }}
      >
        <div
          style={{
            padding: "1.25rem 1.5rem 1rem",
            borderBottom: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
              gap: 12,
            }}
          >
            <div>
              <h5
                style={{ margin: 0, color: "var(--pearl-text, #1f2937)", fontWeight: 700 }}
              >
                Sign Library
              </h5>
              <p style={{ margin: 0, fontSize: "12px", color: "#6b7280" }}>
                {loading ? "Loading…" : `${filtered.length} sign${filtered.length === 1 ? "" : "s"} in the library`}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {!showAddPanel && !editingAsset && (
                <button
                  type="button"
                  onClick={() => setShowAddPanel(true)}
                  style={primaryButtonStyle}
                >
                  Add sign
                </button>
              )}
              <button
                onClick={onClose}
                style={{
                  background: "var(--pearl-surface-muted, #fbf9f5)",
                  color: "var(--pearl-text, #1f2937)",
                  border: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  fontSize: "16px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {!showAddPanel && !editingAsset && (
            <>
              {canEditMedia && (
                <p
                  style={{
                    margin: "0 0 10px",
                    color: "var(--pearl-text-muted, #6b7280)",
                    fontSize: "12px",
                  }}
                >
                  Uploaded media cards have Edit and Delete actions.
                  Recorded-only cards are not clickable; use Add image/video
                  on a card to add media for that sign.
                </p>
              )}
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search a word…"
                style={{
                  width: "100%",
                  padding: "8px 14px",
                  borderRadius: "999px",
                  border: "1px solid var(--pearl-border, rgba(15, 23, 42, 0.09))",
                  background: "var(--pearl-surface-muted, #fbf9f5)",
                  color: "var(--pearl-text, #1f2937)",
                  fontSize: "13px",
                  outline: "none",
                }}
              />
              {deleteError && (
                <p
                  role="alert"
                  style={{
                    margin: "8px 0 0",
                    color: "var(--pearl-danger, #b42318)",
                    fontSize: "12px",
                  }}
                >
                  {deleteError}
                </p>
              )}
            </>
          )}

          {submitSuccess && !showAddPanel && !editingAsset && (
            <p
              style={{
                margin: "10px 0 0",
                fontSize: "12px",
                color: "var(--pearl-text, #1f2937)",
                background: "#e1f5ee",
                padding: "8px 12px",
                borderRadius: "8px",
              }}
            >
              {submitSuccess}
            </p>
          )}
        </div>

        {editingAsset ? (
          <div style={{ overflowY: "auto", flex: 1, padding: "1.25rem 1.5rem" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 12,
              }}
            >
              <h6 style={{ margin: 0, color: "var(--pearl-text, #1f2937)" }}>
                Replace media for “{editingAsset.word}”
              </h6>
              {canDeleteAssets && (
                <button
                  type="button"
                  onClick={() => void deleteAsset(editingAsset)}
                  disabled={
                    submitting || deletingAssetId === editingAsset.id
                  }
                  style={{
                    ...dangerButtonStyle,
                    opacity:
                      submitting || deletingAssetId === editingAsset.id
                        ? 0.65
                        : 1,
                    cursor:
                      submitting || deletingAssetId === editingAsset.id
                        ? "wait"
                        : "pointer",
                  }}
                >
                  {deletingAssetId === editingAsset.id ? "Deleting…" : "Delete"}
                </button>
              )}
            </div>
            <p style={{ color: "#6b7280", fontSize: 13 }}>
              {isDynamicGesture(editingAsset.word)
                ? "Dynamic signs must stay videos. Upload an MP4/WEBM video or record a 2–5-second video. The sign entry and translations will stay the same."
                : "Upload an image or a 2–5-second video, or use your camera to record a video or take a photo. The sign entry and translations will stay the same."}
            </p>
            <div style={{ marginBottom: 16 }}>
              {editingAsset.type.startsWith("video/") ? (
                <video
                  src={resolveApiUrl(editingAsset.file)}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={`Current video for ${editingAsset.word}`}
                  style={{
                    width: "100%",
                    maxWidth: 480,
                    maxHeight: 220,
                    objectFit: "contain",
                    borderRadius: 12,
                    background: "#0f172a",
                  }}
                />
              ) : (
                <img
                  src={resolveApiUrl(editingAsset.file)}
                  alt={`Current image for ${editingAsset.word}`}
                  style={{
                    width: "100%",
                    maxWidth: 480,
                    maxHeight: 220,
                    objectFit: "contain",
                    borderRadius: 12,
                    background: "var(--pearl-surface-muted)",
                  }}
                />
              )}
            </div>
            <input
              type="file"
              accept={
                isDynamicGesture(editingAsset.word)
                  ? "video/mp4,video/webm"
                  : "video/mp4,video/webm,image/jpeg,image/png,image/webp"
              }
              onChange={handleEditFileChange}
              aria-label="Upload an existing image or video"
              disabled={
                submitting ||
                editCameraState === "requesting" ||
                editCameraState === "recording"
              }
              style={{ marginBottom: 12 }}
            />
            {editCameraState === "requesting" && (
              <p style={{ fontSize: 13, color: "#6b7280" }}>Requesting camera access…</p>
            )}
            {(editCameraState === "live" || editCameraState === "recording") && (
              <div>
                <video
                  ref={editVideoRef}
                  muted
                  playsInline
                  style={{
                    width: "100%",
                    maxWidth: 640,
                    height: "clamp(320px, 58vh, 560px)",
                    objectFit: "cover",
                    borderRadius: 16,
                    background: "#000",
                    display: "block",
                    margin: "0 auto 12px",
                  }}
                />
                {editCameraState === "live" ? (
                  <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
                    <button onClick={startEditRecording} style={primaryButtonStyle}>
                      ● Record video (2–5 sec)
                    </button>
                    {!isDynamicGesture(editingAsset.word) && (
                      <button
                        onClick={captureEditImage}
                        style={secondaryButtonStyle}
                      >
                        Take photo
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={stopEditRecording}
                    disabled={!editCanStopRecording}
                    style={{
                      ...dangerButtonStyle,
                      display: "block",
                      margin: "0 auto",
                      opacity: editCanStopRecording ? 1 : 0.55,
                      cursor: editCanStopRecording ? "pointer" : "not-allowed",
                    }}
                  >
                    {editCanStopRecording
                      ? "■ Stop recording"
                      : "Recording — wait 2 seconds"}
                  </button>
                )}
              </div>
            )}
            {editCameraState === "captured" && editPreviewUrl && editMediaFile && (
              <div>
                {editMediaFile.type.startsWith("video/") ? (
                  <video
                    src={editPreviewUrl}
                    controls
                    playsInline
                    style={{
                      width: "100%",
                      maxWidth: 640,
                      height: "clamp(320px, 58vh, 560px)",
                      objectFit: "contain",
                      borderRadius: 12,
                      display: "block",
                      margin: "0 auto 12px",
                    }}
                  />
                ) : (
                  <img
                    src={editPreviewUrl}
                    alt={`New image for ${editingAsset.word}`}
                    style={{
                      width: "100%",
                      maxWidth: 640,
                      height: "clamp(320px, 58vh, 560px)",
                      objectFit: "contain",
                      borderRadius: 12,
                      display: "block",
                      margin: "0 auto 12px",
                    }}
                  />
                )}
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    onClick={() => {
                      setEditPreviewUrl(null);
                      setEditMediaFile(null);
                      void startEditCamera();
                    }}
                    style={secondaryButtonStyle}
                  >
                    {isDynamicGesture(editingAsset.word)
                      ? "Record another video"
                      : "Record again or take another photo"}
                  </button>
                  <button
                    onClick={() => void saveEditedMedia()}
                    disabled={submitting}
                    style={primaryButtonStyle}
                  >
                    {submitting ? "Saving…" : "Save media"}
                  </button>
                </div>
              </div>
            )}
            {(editCameraState === "idle" || editCameraState === "error") && (
              <button onClick={() => void startEditCamera()} style={primaryButtonStyle}>
                {editCameraState === "error"
                  ? "Try camera again"
                  : isDynamicGesture(editingAsset.word)
                    ? "Use camera to record a video"
                    : "Use camera to record video or take a photo"}
              </button>
            )}
            {editError && (
              <p role="alert" style={{ color: "#ef4444", fontSize: 13, marginTop: 12 }}>
                {editError}
              </p>
            )}
            <button
              onClick={cancelMediaEdit}
              style={{ ...secondaryButtonStyle, marginTop: 16, display: "block" }}
            >
              Cancel
            </button>
          </div>
        ) : showAddPanel ? (
          <div style={{ overflowY: "auto", flex: 1, padding: "1.25rem 1.5rem" }}>
            <div style={{ display: "flex", gap: "10px", marginBottom: "14px" }}>
              <input
                type="text"
                value={newWord}
                onChange={(e) => setNewWord(e.target.value)}
                placeholder="Word this sign is for"
                style={inputStyle}
              />
              <select
                value={newLanguage}
                onChange={(e) => setNewLanguage(e.target.value)}
                style={{ ...inputStyle, flex: "0 0 140px" }}
              >
                {ADD_LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </div>
            {isDynamicGesture(newWord) && (
              <p style={{ margin: "-6px 0 12px", color: "#6b7280", fontSize: 13 }}>
                This is a dynamic sign. Upload or record a video; images are not allowed.
              </p>
            )}
            <div style={{ display: "grid", gap: "10px", marginBottom: "14px" }}>
              <input
                type="text"
                value={translationsInput}
                onChange={(e) => setTranslationsInput(e.target.value)}
                placeholder='Translations JSON, e.g. {"Tagalog":"pula","Cebuano":"pula"}'
                aria-label="Translations by language in JSON format"
                style={inputStyle}
              />
              <input
                type="text"
                value={aliasesInput}
                onChange={(e) => setAliasesInput(e.target.value)}
                placeholder="Alternate spoken words (comma-separated)"
                aria-label="Alternate spoken words"
                style={inputStyle}
              />
            </div>

            {mode === "gesture" ? (
              <div>
                {recordState === "idle" && (
                  <button onClick={startCamera} style={primaryButtonStyle}>
                    Record a video or take a live photo
                  </button>
                )}
                {recordState === "requesting" && (
                  <p style={{ fontSize: 13, color: "#6b7280" }}>Requesting camera access…</p>
                )}
                {(recordState === "live" || recordState === "recording") && (
                  <div>
                    <video
                      ref={videoPreviewRef}
                      muted
                      playsInline
                      style={{
                        width: "100%",
                        maxWidth: 480,
                        borderRadius: 12,
                        background: "#000",
                        display: "block",
                        margin: "0 auto 12px",
                      }}
                    />
                    <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                      {recordState === "live" ? (
                        <>
                          <button
                            onClick={startRecording}
                            style={primaryButtonStyle}
                          >
                            ● Record video (2–5 sec)
                          </button>
                          {!isDynamicGesture(newWord) && (
                            <button
                              onClick={() => void captureNewImage()}
                              style={secondaryButtonStyle}
                            >
                              Take photo
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          onClick={stopRecording}
                          disabled={!canStopRecording}
                          style={{
                            ...dangerButtonStyle,
                            opacity: canStopRecording ? 1 : 0.55,
                            cursor: canStopRecording ? "pointer" : "not-allowed",
                          }}
                        >
                          {canStopRecording
                            ? "■ Stop recording"
                            : "Recording — wait 2 seconds"}
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {recordState === "recorded" && recordedUrl && (
                  <div>
                    <video
                      src={recordedUrl}
                      controls
                      playsInline
                      style={{
                        width: "100%",
                        maxWidth: 640,
                        height: "clamp(320px, 58vh, 560px)",
                        objectFit: "contain",
                        background: "#0f172a",
                        borderRadius: 16,
                        display: "block",
                        margin: "0 auto 12px",
                      }}
                    />
                    <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                      <button onClick={retakeRecording} style={secondaryButtonStyle}>
                        Retake
                      </button>
                      <button
                        onClick={handleSubmitRecording}
                        disabled={submitting}
                        style={primaryButtonStyle}
                      >
                        {submitting ? "Submitting…" : "Add to library"}
                      </button>
                    </div>
                  </div>
                )}
                {recordState === "error" && (
                  <button onClick={startCamera} style={primaryButtonStyle}>
                    Try again
                  </button>
                )}
              </div>
            ) : (
              <div>
                <input
                  type="file"
                  accept={
                    isDynamicGesture(newWord)
                      ? "video/mp4,video/webm"
                      : "video/mp4,video/webm,image/jpeg,image/png,image/webp"
                  }
                  onChange={handleFileChange}
                  style={{ marginBottom: 12 }}
                />
                {selectedPreviewUrl && selectedFile && (
                  <div style={{ marginBottom: 12 }}>
                    {selectedFile.type.startsWith("video/") ? (
                      <video
                        src={selectedPreviewUrl}
                        controls
                        playsInline
                        style={{
                          width: "100%",
                          maxWidth: 640,
                          height: "clamp(320px, 58vh, 560px)",
                          objectFit: "contain",
                          background: "#0f172a",
                          borderRadius: 16,
                        }}
                      />
                    ) : (
                      <img
                        src={selectedPreviewUrl}
                        alt="Preview"
                        style={{ width: "100%", maxWidth: 480, borderRadius: 12 }}
                      />
                    )}
                  </div>
                )}
                <button
                  onClick={handleSubmitUpload}
                  disabled={submitting || !selectedFile}
                  style={primaryButtonStyle}
                >
                  {submitting ? "Submitting…" : "Add to library"}
                </button>
              </div>
            )}

            {submitError && (
              <p style={{ color: "#ef4444", fontSize: 13, marginTop: 12 }}>{submitError}</p>
            )}

            <button
              onClick={closeAddPanel}
              style={{
                ...secondaryButtonStyle,
                marginTop: 16,
                display: "block",
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ overflowY: "auto", flex: 1, padding: "1rem 1.5rem" }}>
            {loading ? (
              <div style={emptyStateStyle}>
                <div style={{ fontSize: 40 }}>⏳</div>
                <p style={{ margin: 0, fontSize: 14 }}>Loading the sign library…</p>
              </div>
            ) : error ? (
              <div style={emptyStateStyle}>
                <div style={{ fontSize: 40 }}>⚠️</div>
                <p style={{ margin: 0, fontSize: 14 }}>{error}</p>
              </div>
            ) : filtered.length === 0 ? (
              <div style={emptyStateStyle}>
                <div style={{ fontSize: 40 }}>🤲</div>
                <p style={{ margin: 0, fontSize: 14 }}>
                  {assets.length === 0 && recordedGestures.length === 0
                    ? "No signs or gestures registered yet."
                    : `No signs or gestures match "${search}".`}
                </p>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                  gap: "14px",
                }}
              >
                {filtered.map((item) => (
                  <div
                    key={item.key}
                    style={{
                      border: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
                      borderRadius: "12px",
                      overflow: "hidden",
                      background: "var(--pearl-surface-muted, #fbf9f5)",
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        aspectRatio: "1 / 1",
                        background: "#0f172a0d",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {item.file && item.type?.startsWith("video/") ? (
                        <video
                          src={resolveApiUrl(item.file)}
                          controls
                          muted
                          playsInline
                          preload="none"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : item.file ? (
                        <img
                          src={resolveApiUrl(item.file)}
                          alt={item.word}
                          loading="lazy"
                          decoding="async"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <span style={{ color: "#6b7280", fontSize: 13 }}>
                          {item.gestureType?.toLowerCase() === "dynamic"
                            ? "No video uploaded"
                            : "No image captured"}
                        </span>
                      )}
                    </div>
                    <p
                      style={{
                        margin: 0,
                        padding: "8px 10px",
                        fontSize: "13px",
                        fontWeight: 600,
                        color: "var(--pearl-text, #1f2937)",
                        textAlign: "center",
                        textTransform: "capitalize",
                      }}
                    >
                      {item.word}
                    </p>
                    {item.kind === "recorded" && (
                      <p
                        style={{
                          margin: "0 10px 8px",
                          color: "var(--pearl-text-muted, #6b7280)",
                          fontSize: 11,
                          textAlign: "center",
                        }}
                      >
                        {item.gestureType?.toLowerCase() === "dynamic"
                          ? "Dynamic gesture — video media is required."
                          : "Recorded gesture only — no uploaded image/video yet."}
                      </p>
                    )}
                    {item.recordingCount !== undefined && (
                      <p
                        style={{
                          margin: "-4px 8px 8px",
                          fontSize: 11,
                          color: "var(--pearl-text-muted, #6b7280)",
                          textAlign: "center",
                        }}
                      >
                        Registered · {item.recordingCount} recording
                        {item.recordingCount === 1 ? "" : "s"}
                      </p>
                    )}
                    {item.kind === "recorded" && canEditMedia && (
                      <div style={{ padding: "0 10px 10px" }}>
                        <button
                          type="button"
                          onClick={() => addMediaForWord(item.word)}
                          style={{
                            ...primaryButtonStyle,
                            width: "100%",
                            padding: "7px 10px",
                          }}
                        >
                          {item.gestureType?.toLowerCase() === "dynamic"
                            ? "Add video"
                            : "Add image/video"}
                        </button>
                      </div>
                    )}
                    {item.asset && (canEditMedia || canDeleteAssets) && (
                      <div
                        style={{
                          display: "grid",
                          gap: "6px",
                          padding: "0 10px 10px",
                        }}
                      >
                        {canEditMedia && (
                          <button
                            type="button"
                            onClick={() => {
                              const asset = item.asset;
                              if (!asset) return;
                              setEditError(null);
                              setEditingAsset(asset);
                              setEditCameraState("idle");
                            }}
                            style={{
                              ...secondaryButtonStyle,
                              width: "100%",
                              padding: "7px 10px",
                            }}
                          >
                            {item.asset.type?.startsWith("video/")
                              ? "Edit video"
                              : "Edit image"}
                          </button>
                        )}
                        {canDeleteAssets && (
                          <button
                            type="button"
                            disabled={deletingAssetId === item.asset.id}
                            onClick={() => {
                              const asset = item.asset;
                              if (asset) void deleteAsset(asset);
                            }}
                            style={{
                              ...dangerButtonStyle,
                              width: "100%",
                              padding: "7px 10px",
                              opacity:
                                deletingAssetId === item.asset.id ? 0.65 : 1,
                              cursor:
                                deletingAssetId === item.asset.id
                                  ? "wait"
                                  : "pointer",
                            }}
                          >
                            {deletingAssetId === item.asset.id
                              ? "Deleting…"
                              : "Delete"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};

const emptyStateStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "3rem 0",
  color: "var(--pearl-text-muted, #6b7280)",
  gap: "12px",
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 14px",
  borderRadius: "10px",
  border: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
  background: "var(--pearl-surface-muted, #fbf9f5)",
  color: "var(--pearl-text, #1f2937)",
  fontSize: "13px",
  outline: "none",
};

const primaryButtonStyle: React.CSSProperties = {
  background: "var(--pearl-accent, #3b82f6)",
  color: "#fff",
  border: "none",
  borderRadius: "999px",
  padding: "9px 18px",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};

const dangerButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: "var(--pearl-danger, #ef4444)",
};

const secondaryButtonStyle: React.CSSProperties = {
  background: "var(--pearl-surface-muted, #fbf9f5)",
  color: "var(--pearl-text, #1f2937)",
  border: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
  borderRadius: "999px",
  padding: "9px 18px",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};

export default SignLibraryModal;
