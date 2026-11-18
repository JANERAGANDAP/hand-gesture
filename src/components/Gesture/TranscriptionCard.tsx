import React from "react";
interface Props {
  text: string;
  translatedText?: string;
  targetLanguage?: string;
  mode?: "gesture" | "speech";
  isActive?: boolean;
}
const TranscriptionCard: React.FC<Props> = ({
  text,
  translatedText,
  targetLanguage = "English",
  mode = "gesture",
}) => {
  const isGestureMode = mode === "gesture";
  const hasContent = !!text && text.trim().length > 0;
  return (
    <div
      className="w-75 mx-auto mt-3 mb-3 p-4 rounded-4 text-center"
      style={{
        background: "var(--pearl-surface, #fff)",
        border: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
        boxShadow: "0 6px 18px rgba(15,23,42,0.06)",
        color: "var(--pearl-text, #1f2937)",
      }}
    >
      {hasContent && (
        <>
          <div
            style={{
              fontSize: "20px",
              fontWeight: 700,
              color: "var(--pearl-text, #1f2937)",
              lineHeight: 1.4,
            }}
          >
            {text}
          </div>
          <div
            style={{
              marginTop: "8px",
              fontSize: "12px",
              color: "var(--pearl-text-muted, #6b7280)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
            }}
          >
            <span>{isGestureMode ? "✋ Composed from Signs" : "🎤 Speech Recognized"}</span>
            <button
              type="button"
              onClick={() => {
                if ("speechSynthesis" in window) {
                  window.speechSynthesis.cancel();
                  const utterance = new SpeechSynthesisUtterance(translatedText || text);
                  const languageCodes: Record<string, string> = {
                    English: "en-US",
                    Tagalog: "fil-PH",
                    Cebuano: "ceb-PH",
                    Ilocano: "fil-PH",
                    Bikolano: "fil-PH",
                  };
                  utterance.lang = languageCodes[targetLanguage] ?? "en-US";
                  window.speechSynthesis.speak(utterance);
                }
              }}
              title="Speak sentence"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "2px 6px",
                borderRadius: "6px",
                fontSize: "14px",
              }}
            >
              🔊
            </button>
          </div>
        </>
      )}

      {translatedText && translatedText.trim().length > 0 && (
        <div
          style={{
            marginTop: "12px",
            paddingTop: "10px",
            borderTop: "1px dashed rgba(15,23,42,0.1)",
            fontSize: "16px",
            color: "var(--pastel-periwinkle-deep, #3b82f6)",
            fontWeight: 600,
          }}
        >
          {translatedText}
        </div>
      )}
    </div>
  );
};
export default TranscriptionCard;