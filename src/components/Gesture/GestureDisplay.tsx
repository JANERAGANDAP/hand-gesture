// src/components/Gesture/GestureDisplay.tsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { API_ROOT } from "../../config";
import { authHeaders } from "../../services/api";
import Sidebar from "./Sidebar";
import TopNavbar from "./TopNavbar";
import VideoViewport from "./VideoViewport";
import TranscriptionCard from "./TranscriptionCard";
import HistoryModal from "./HistoryModal";
import SignLibraryModal from "./SignLibraryModal";
import SpeechGesture from "./SpeechGesture";
import SignGuidePanel from "./SignGuidePanel";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { translateText } from "../../services/api";
import { warmRecognition } from "../../services/recognitionApi";
import { RECOGNITION_UI_CONFIG } from "../../config/recognitionConfig";
import { shouldSpeakGesture } from "../../utils/gestureStability";
import { HAND_LANDMARKER_RESTART_KEY } from "../../utils/holisticLoader";
import type { HistoryEntry } from "./types";
type Language = "English" | "Cebuano" | "Tagalog" | "Ilocano" | "Bikolano";
type Mode = "gesture" | "speech";
const GestureDisplay: React.FC = () => {
  const [activeLang, setActiveLang] = useState<Language>("English");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCapturing, setIsCapturing] = useState(() => {
    try {
      const shouldResume =
        sessionStorage.getItem(HAND_LANDMARKER_RESTART_KEY) === "true";
      if (shouldResume) sessionStorage.removeItem(HAND_LANDMARKER_RESTART_KEY);
      return shouldResume;
    } catch (error) {
      console.error("Could not restore live recognition after reload:", error);
      return false;
    }
  });
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [signLibraryVersion, setSignLibraryVersion] = useState(0);
  const [mode, setMode] = useState<Mode>("gesture");
  const [gestureText, setGestureText] = useState("");
  const [speechText, setSpeechText] = useState("");
  const [translationInput, setTranslationInput] = useState<{
    text: string;
    sourceLanguage: string;
    speak: boolean;
  } | null>(null);
  const [translatedText, setTranslatedText] = useState("");
  const [speechTranslationVersion, setSpeechTranslationVersion] = useState(0);
  const [guideOpen, setGuideOpen] = useState(true);
  const { showToast } = useToast();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const translationRequestIdRef = useRef(0);
  const lastGestureSpeechRef = useRef<{
    text: string;
    targetLanguage: string;
    spokenAt: number;
  }>({ text: "", targetLanguage: "", spokenAt: 0 });
  const isLoggedIn = Boolean(user);
  // Warm the backend (server, database, gesture cache) once the user is
  // signed in, so the first recognition does not pay the cold-start cost.
  useEffect(() => {
    if (!isLoggedIn) return;
    void warmRecognition();
  }, [isLoggedIn]);
  const languages = [
    {
      id: "English",
      color: "#3b82f6",
    },
    {
      id: "Cebuano",
      color: "#f59e0b",
    },
    {
      id: "Tagalog",
      color: "#ef4444",
    },
    {
      id: "Ilocano",
      color: "#10b981",
    },
    {
      id: "Bikolano",
      color: "#8b5cf6",
    },
  ];
  const addHistory = (
    text: string,
    language: string,
    source: "gesture" | "speech",
  ) => {
    const now = new Date();
    const time = now.toLocaleTimeString("en-PH", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setHistory((prev) => [
      {
        id: Date.now(),
        gesture: text,
        language,
        time,
        source,
      },
      ...prev,
    ]);
  };
  const loadHistory = async () => {
    try {
      const res = await fetch(`${API_ROOT}/api/ai-history/get-history`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      const entries: HistoryEntry[] = data.map((entry: any) => ({
        id: entry.id,
        gesture: entry.rawGestureInput,
        language: entry.language,
        time: new Date(entry.createdAt).toLocaleTimeString("en-PH", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        source: "gesture",
      }));
      setHistory(entries);
    } catch (err) {
      console.error("Failed to load history:", err);
      showToast("Failed to load history", "error");
    }
  };
  useEffect(() => {
    loadHistory();
  }, []);
  useEffect(() => {
    if (!translationInput?.text.trim()) {
      translationRequestIdRef.current += 1;
      return;
    }
    const requestId = ++translationRequestIdRef.current;
    let cancelled = false;
    void translateText(
      translationInput.text,
      translationInput.sourceLanguage,
      activeLang,
    )
      .then((result) => {
        if (cancelled || requestId !== translationRequestIdRef.current) return;
        const output = result.translatedText || translationInput.text;
        setTranslatedText(output);
        if (
          !translationInput.speak ||
          mode !== "gesture" ||
          !("speechSynthesis" in window)
        ) return;
        const previousSpeech = lastGestureSpeechRef.current;
        const spokenAt = Date.now();
        if (
          !shouldSpeakGesture(
            output,
            activeLang,
            spokenAt,
            previousSpeech,
            RECOGNITION_UI_CONFIG.SPEECH_COOLDOWN_MS,
          )
        ) {
          return;
        }
        lastGestureSpeechRef.current = {
          text: output,
          targetLanguage: activeLang,
          spokenAt,
        };
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(output);
        const languageCodes: Record<string, string> = {
          English: "en-US",
          Tagalog: "fil-PH",
          Cebuano: "ceb-PH",
          Ilocano: "fil-PH",
          Bikolano: "fil-PH",
        };
        utterance.lang = languageCodes[activeLang] ?? "en-US";
        window.speechSynthesis.speak(utterance);
      })
      .catch((error) => {
        console.error("Translation failed:", error);
        if (cancelled || requestId !== translationRequestIdRef.current) return;
        setTranslatedText(translationInput.text);
      });
    return () => {
      cancelled = true;
    };
  }, [activeLang, mode, translationInput]);
  const handleModeSwitch = (newMode: Mode) => {
    if (newMode === "speech" && isCapturing) {
      setIsCapturing(false);
    }
    // Library is only ever opened from the Speech side (see TopNavbar) —
    // if it's open and the user switches to Gesture underneath it, close
    // it rather than leaving it open in a mode it's no longer meant for.
    if (newMode === "gesture" && showLibrary) {
      setShowLibrary(false);
    }
    if (newMode === "gesture") {
      setSpeechText("");
    } else {
      setGestureText("");
    }
    setTranslationInput(null);
    setTranslatedText("");
    setSpeechTranslationVersion(0);
    setMode(newMode);
  };
  const handleGestureDetected = useCallback(
    async (sentence: string, lang: string) => {
      const rawSentence = sentence.trim();
      if (!rawSentence) return;
      setGestureText(rawSentence);
      setTranslatedText("");
      setTranslationInput({
        text: rawSentence,
        sourceLanguage: "English",
        speak: true,
      });
      addHistory(rawSentence, lang, "gesture");
    },
    [],
  );
  const handleGestureWordDetected = useCallback((word: string) => {
    const recognizedWord = word.trim();
    if (!recognizedWord) return;
    setGestureText(recognizedWord);
    setTranslatedText("");
    setTranslationInput({
      text: recognizedWord,
      sourceLanguage: "English",
      speak: false,
    });
  }, []);
  const handleSpeechDetected = async (text: string) => {
    setSpeechText(text);
    setTranslatedText("");
    setSpeechTranslationVersion((version) => version + 1);
    setTranslationInput({ text, sourceLanguage: "English", speak: false });
    addHistory(text, activeLang, "speech");
  };
  return (
    <div style={styles.page}>
      <div style={styles.mainContainer}>
        <Sidebar
          languages={languages}
          activeLang={activeLang}
          setActiveLang={(lang) => {
            setActiveLang(lang as Language);
            setTranslatedText("");
          }}
          sidebarOpen={sidebarOpen}
          toggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />

        <main style={styles.mainContent}>
          <TopNavbar
            activeLang={activeLang}
            sidebarOpen={sidebarOpen}
            toggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            isCapturing={isCapturing}
            onToggleCapture={() => setIsCapturing((p) => !p)}
            onShowHistory={() => setShowHistory(true)}
            onShowLibrary={() => setShowLibrary(true)}
            mode={mode}
            onModeChange={handleModeSwitch}
            userName={user?.name}
            userRole={user?.role}
            onManageSigns={() => navigate("/admin-signs")}
            onLogout={() => {
              logout();
              navigate("/login", { replace: true });
            }}
          />

          <div style={styles.contentArea}>
            {mode === "gesture" ? (
              <>
                <VideoViewport
                  language={activeLang}
                  isCapturing={isCapturing}
                  onGestureDetected={handleGestureDetected}
                  onWordDetected={handleGestureWordDetected}
                />

                <TranscriptionCard
                  text={gestureText}
                  translatedText={translatedText}
                  targetLanguage={activeLang}
                  mode="gesture"
                />
              </>
            ) : (
              <>
                <SpeechGesture
                  language={activeLang}
                  onSpeechDetected={handleSpeechDetected}
                  refreshSignsVersion={signLibraryVersion}
                  translatedText={translatedText}
                  translationVersion={speechTranslationVersion}
                />

                <TranscriptionCard
                  text={speechText}
                  translatedText={translatedText}
                  targetLanguage={activeLang}
                  mode="speech"
                />
              </>
            )}
          </div>
        </main>

        {/* Sign Guide Panel — right side */}
        <SignGuidePanel
          isOpen={guideOpen}
          onToggle={() => setGuideOpen((o) => !o)}
        />
      </div>

      {showHistory && (
        <HistoryModal
          history={history}
          onClose={() => setShowHistory(false)}
          onClear={() => setHistory([])}
        />
      )}

      {showLibrary && (
        <SignLibraryModal
          onClose={() => setShowLibrary(false)}
          mode={mode}
          language={activeLang}
          canEditImages={user?.role === "ADMIN" || user?.role === "TEACHER"}
          onSignAdded={() => setSignLibraryVersion((v) => v + 1)}
        />
      )}
    </div>
  );
};
const styles = {
  page: {
    minHeight: "100vh",
    background: "var(--pearl-bg, #f6f3ee)",
    color: "var(--pearl-text, #1f2937)",
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  } as React.CSSProperties,
  mainContainer: {
    display: "flex",
    flexDirection: "row" as const,
    minHeight: "100vh",
  } as React.CSSProperties,
  mainContent: {
    flex: 1,
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    minWidth: 0, // prevent flex overflow
  } as React.CSSProperties,
  contentArea: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "24px",
  } as React.CSSProperties,
};
export default GestureDisplay;