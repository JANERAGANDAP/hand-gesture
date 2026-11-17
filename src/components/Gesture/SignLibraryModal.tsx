import React, { useEffect, useRef, useState } from "react";
import { apiClient, authHeaders } from "../../services/api";
import { API_ROOT } from "../../config";
import type { SignAsset } from "./types";

const ADD_LANGUAGES = ["English", "Cebuano", "Tagalog", "Ilocano", "Bikolano"];

// Candidates in preference order — MediaRecorder support varies by
// browser. Safari records video/mp4 directly; Chrome/Firefox only
// support webm variants. The backend's ALLOWED_MIME_TYPES accepts both.
const RECORDER_MIME_CANDIDATES = [
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

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

interface SignLibraryModalProps {
  onClose: () => void;
  mode: "gesture" | "speech";
  language?: string;
  // Called after a successful record/upload submit, so the parent can
  // refresh SpeechGesture's word list without a page reload — see
  // refreshSignsVersion in SpeechGesture.tsx.
  onSignAdded?: () => void;
}

type RecordState = "idle" | "requesting" | "live" | "recording" | "recorded" | "error";

const SignLibraryModal: React.FC<SignLibraryModalProps> = ({
  onClose,
  mode,
  language,
  onSignAdded,
}) => {
  const [assets, setAssets] = useState<SignAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [showAddPanel, setShowAddPanel] = useState(false);
  const [newWord, setNewWord] = useState("");
  const [newLanguage, setNewLanguage] = useState(language || "English");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  // Record-a-sign panel (mode === "gesture")
  const [recordState, setRecordState] = useState<RecordState>("idle");
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordedMimeRef = useRef<string>("video/webm");
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

  // Upload-a-sign panel (mode === "speech")
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedPreviewUrl, setSelectedPreviewUrl] = useState<string | null>(null);

  const loadAssets = () => {
    setLoading(true);
    setError(null);
    apiClient
      .get<SignAsset[]>("/signs")
      .then((data) => {
        setAssets(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        console.error("Failed to load sign library:", err);
        setError("Couldn't load the sign library. Try again in a moment.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .get<SignAsset[]>("/signs")
      .then((data) => {
        if (!cancelled) setAssets(Array.isArray(data) ? data : []);
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
  }, []);

  // Always release the camera when the panel is closed/unmounted — never
  // leave the recording light on after the modal goes away.
  const stopCameraTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    return () => {
      stopCameraTracks();
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      if (selectedPreviewUrl) URL.revokeObjectURL(selectedPreviewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setSubmitError(null);
  };

  const closeAddPanel = () => {
    resetAddPanel();
    setShowAddPanel(false);
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
      const blob = new Blob(recordedChunksRef.current, { type: mimeType });
      setRecordedBlob(blob);
      setRecordedUrl(URL.createObjectURL(blob));
      stopCameraTracks();
      setRecordState("recorded");
    };
    mediaRecorderRef.current = recorder;
    recorder.start();
    setRecordState("recording");
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
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
    const allowed = ["video/mp4", "image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      setSubmitError("Only MP4 video or JPG/PNG/WEBP images are allowed.");
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
    setSubmitting(true);
    setSubmitError(null);
    const formData = new FormData();
    formData.append("word", newWord.trim());
    formData.append("file", file);
    formData.append("language", newLanguage);
    try {
      const res = await fetch(`${API_ROOT}/api/upload`, {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSubmitError(body.error || "Upload failed. Try again.");
        return;
      }
      setSubmitSuccess(`"${newWord.trim()}" added to the library.`);
      closeAddPanel();
      setShowAddPanel(false);
      loadAssets();
      onSignAdded?.();
      setTimeout(() => setSubmitSuccess(null), 4000);
    } catch (err) {
      console.error("Sign upload failed:", err);
      setSubmitError("Upload failed. Check your connection and try again.");
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

  const filtered = assets.filter((a) =>
    a.word.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(4px)",
          zIndex: 1000,
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
          zIndex: 1001,
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

          {!showAddPanel && (
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search a word…"
              style={{
                width: "100%",
                padding: "8px 14px",
                borderRadius: "999px",
                border: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
                background: "var(--pearl-surface-muted, #fbf9f5)",
                color: "var(--pearl-text, #1f2937)",
                fontSize: "13px",
                outline: "none",
              }}
            />
          )}

          {submitSuccess && !showAddPanel && (
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

        {showAddPanel ? (
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

            {mode === "gesture" ? (
              <div>
                {recordState === "idle" && (
                  <button onClick={startCamera} style={primaryButtonStyle}>
                    Turn on camera
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
                        <button onClick={startRecording} style={primaryButtonStyle}>
                          ● Start recording
                        </button>
                      ) : (
                        <button onClick={stopRecording} style={dangerButtonStyle}>
                          ■ Stop recording
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
                        maxWidth: 480,
                        borderRadius: 12,
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
                  accept="video/mp4,image/jpeg,image/png,image/webp"
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
                        style={{ width: "100%", maxWidth: 480, borderRadius: 12 }}
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
                  {assets.length === 0
                    ? "No signs uploaded yet."
                    : `No signs match "${search}".`}
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
                {filtered.map((asset) => (
                  <div
                    key={asset.id}
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
                      {asset.type?.startsWith("video/") ? (
                        <video
                          src={asset.file}
                          controls
                          muted
                          playsInline
                          preload="none"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <img
                          src={asset.file}
                          alt={asset.word}
                          loading="lazy"
                          decoding="async"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
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
                      {asset.word}
                    </p>
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
