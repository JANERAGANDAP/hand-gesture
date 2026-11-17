import React, { useState } from "react";
import type { HistoryEntry } from "./types";
interface HistoryModalProps {
  history: HistoryEntry[];
  onClose: () => void;
  onClear: () => void;
}
const langBadgeColor: Record<string, string> = {
  English: "#3b82f6",
  Cebuano: "#f59e0b",
  Tagalog: "#ef4444",
  Ilocano: "#10b981",
  Bikolano: "#8b5cf6",
};
type Tab = "all" | "gesture" | "speech";
const HistoryModal: React.FC<HistoryModalProps> = ({
  history,
  onClose,
  onClear,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const filtered = history.filter((e) => {
    if (activeTab === "all") return true;
    return e.source === activeTab;
  });
  const tabStyle = (tab: Tab) =>
    ({
      padding: "6px 16px",
      borderRadius: "999px",
      border: "none",
      fontSize: "12px",
      fontWeight: 700,
      cursor: "pointer",
      transition: "all 0.2s ease",
      background:
        activeTab === tab
          ? tab === "gesture"
            ? "var(--pastel-periwinkle, #a9c1f2)"
            : tab === "speech"
              ? "var(--pastel-lavender, #d3c2f7)"
              : "rgba(15,23,42,0.08)"
          : "transparent",
      color:
        activeTab === tab
          ? "var(--pastel-text-on-pastel, #1f2937)"
          : "#6b7280",
    }) as React.CSSProperties;
  return (
    <>
      {}
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

      {}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(560px, 90vw)",
          maxHeight: "75vh",
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
        {}
        <div
          style={{
            padding: "1.25rem 1.5rem 0.75rem",
            borderBottom: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
            }}
          >
            <div>
              <h5
                style={{
                  margin: 0,
                  color: "var(--pearl-text, #1f2937)",
                  fontWeight: 700,
                }}
              >
                Gesture History
              </h5>
              <p
                style={{
                  margin: 0,
                  fontSize: "12px",
                  color: "#6b7280",
                }}
              >
                {filtered.length}{" "}
                {activeTab === "all"
                  ? "total"
                  : activeTab === "gesture"
                    ? "gesture-to-text"
                    : "speech-to-gesture"}{" "}
                entries
              </p>
            </div>
            <div
              style={{
                display: "flex",
                gap: "8px",
              }}
            >
              {filtered.length > 0 && (
                <button
                  onClick={onClear}
                  style={{
                    background: "rgba(239,68,68,0.15)",
                    color: "#ef4444",
                    border: "1px solid rgba(239,68,68,0.3)",
                    padding: "6px 14px",
                    borderRadius: "20px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Clear All
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
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {}
          <div
            style={{
              display: "flex",
              gap: "4px",
              background: "var(--pearl-surface-muted, #fbf9f5)",
              borderRadius: "999px",
              padding: "4px",
              width: "fit-content",
            }}
          >
            <button style={tabStyle("all")} onClick={() => setActiveTab("all")}>
              All ({history.length})
            </button>
            <button
              style={tabStyle("gesture")}
              onClick={() => setActiveTab("gesture")}
            >
              ✋ Gesture ({history.filter((e) => e.source === "gesture").length}
              )
            </button>
            <button
              style={tabStyle("speech")}
              onClick={() => setActiveTab("speech")}
            >
              🎤 Speech ({history.filter((e) => e.source === "speech").length})
            </button>
          </div>
        </div>

        {}
        <div
          style={{
            overflowY: "auto",
            flex: 1,
            padding: "1rem 1.5rem",
          }}
        >
          {filtered.length === 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "3rem 0",
                color: "var(--pearl-text-muted, #6b7280)",
                gap: "12px",
              }}
            >
              <div
                style={{
                  fontSize: "40px",
                }}
              >
                {activeTab === "speech" ? "🎤" : "🤲"}
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: "14px",
                }}
              >
                {activeTab === "all"
                  ? "No entries yet."
                  : activeTab === "gesture"
                    ? "No gesture detections yet."
                    : "No speech detections yet."}
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: "12px",
                  color: "var(--pearl-text-muted, #9ca3af)",
                }}
              >
                {activeTab === "speech"
                  ? "Switch to Speech mode and say a word!"
                  : "Start capture and show a hand gesture!"}
              </p>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              {filtered.map((entry, index) => (
                <div
                  key={entry.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 14px",
                    background:
                      index === 0
                        ? "rgba(169,193,242,0.18)"
                        : "var(--pearl-surface-muted, #fbf9f5)",
                    border: `1px solid ${index === 0 ? "rgba(127,160,232,0.4)" : "var(--pearl-border, rgba(15,23,42,0.09))"}`,
                    borderRadius: "10px",
                  }}
                >
                  {}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
                    {}
                    <span
                      style={{
                        fontSize: "14px",
                      }}
                    >
                      {entry.source === "gesture" ? "✋" : "🎤"}
                    </span>
                    {}
                    <div
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: langBadgeColor[entry.language] ?? "#6b7280",
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        color: "var(--pearl-text, #1f2937)",
                        fontWeight: 600,
                        fontSize: "15px",
                      }}
                    >
                      {entry.gesture}
                    </span>
                  </div>

                  {}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: "20px",
                        background: `${langBadgeColor[entry.language] ?? "#6b7280"}22`,
                        color: langBadgeColor[entry.language] ?? "#6b7280",
                        border: `1px solid ${langBadgeColor[entry.language] ?? "#6b7280"}44`,
                      }}
                    >
                      {entry.language}
                    </span>
                    <span
                      style={{
                        fontSize: "11px",
                        color: "var(--pearl-text-muted, #6b7280)",
                      }}
                    >
                      {entry.time}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};
export default HistoryModal;
