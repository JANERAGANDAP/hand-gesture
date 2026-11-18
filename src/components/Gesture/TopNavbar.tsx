import React from "react";
type Mode = "gesture" | "speech";
interface TopNavbarProps {
  activeLang: string;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  isCapturing: boolean;
  onToggleCapture: () => void;
  onShowHistory: () => void;
  onShowLibrary: () => void;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  userName?: string;
  userRole?: string;
  onManageSigns?: () => void;
  onLogout: () => void;
}
const TopNavbar: React.FC<TopNavbarProps> = ({
  activeLang,
  sidebarOpen,
  toggleSidebar,
  isCapturing,
  onToggleCapture,
  onShowHistory,
  onShowLibrary,
  mode,
  onModeChange,
  userName,
  userRole,
  onManageSigns,
  onLogout,
}) => {
  return (
    <header className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center mb-4 gap-3">
      {}
      <div className="d-flex align-items-center justify-content-between justify-content-md-start">
        <div className="d-flex align-items-center">
          <button
            type="button"
            aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
            className="btn me-3"
            onClick={toggleSidebar}
            style={{
              background: "var(--pearl-surface, #fff)",
              color: "var(--pearl-text, #1f2937)",
              border: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
              boxShadow: "0 2px 6px rgba(15,23,42,0.06)",
              width: 46,
              height: 46,
              borderRadius: 14,
              fontSize: 20,
            }}
          >
            {sidebarOpen ? "✕" : "☰"}
          </button>

          <div>
            <h2
              className="h5 h-md-4 fw-bold m-0"
              style={{ color: "var(--pearl-text, #1f2937)" }}
            >
              Live Recognition
            </h2>

            <p
              className="small m-0 d-flex flex-wrap align-items-center gap-2"
              style={{ color: "var(--pearl-text-muted, #6b7280)" }}
            >
              <span>
                Optimized for{" "}
                <span
                  className="fw-bold"
                  style={{ color: "var(--pastel-periwinkle-deep, #7fa0e8)" }}
                >
                  {activeLang}
                </span>
              </span>

              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  background: "rgba(169,193,242,0.35)",
                  border: "1px solid rgba(127,160,232,0.5)",
                  color: "#3f5a94",
                  padding: "1px 8px",
                  borderRadius: "20px",
                  whiteSpace: "nowrap",
                }}
              >
                🤖 AI
              </span>
            </p>
          </div>
        </div>
      </div>

      {}
      <div
        className="d-flex align-items-center"
        style={{
          gap: 8,
          flexWrap: "wrap",
          justifyContent: "flex-end",
          maxWidth: "100%",
        }}
      >
        {}
        <div
          className="d-flex"
          style={{
            background: "var(--pearl-surface, #fff)",
            borderRadius: "999px",
            padding: "5px",
            border: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
            width: "min(100%, 300px)",
            minHeight: 54,
            justifyContent: "space-between",
            boxShadow: "0 2px 6px rgba(15,23,42,0.05)",
          }}
        >
          <button
            onClick={() => onModeChange("gesture")}
            style={{
              flex: 1,
              padding: "10px 18px",
              borderRadius: "999px",
              border: "none",
              fontSize: "14px",
              fontWeight: 700,
              cursor: "pointer",
              background:
                mode === "gesture" ? "var(--pastel-periwinkle, #a9c1f2)" : "transparent",
              color:
                mode === "gesture"
                  ? "var(--pastel-text-on-pastel, #1f2937)"
                  : "var(--pearl-text-muted, #6b7280)",
              transition: "all 0.2s ease",
              minHeight: 44,
            }}
          >
            ✋ Gesture
          </button>

          <button
            onClick={() => onModeChange("speech")}
            style={{
              flex: 1,
              padding: "10px 18px",
              borderRadius: "999px",
              border: "none",
              fontSize: "14px",
              fontWeight: 700,
              cursor: "pointer",
              background:
                mode === "speech" ? "var(--pastel-lavender, #d3c2f7)" : "transparent",
              color:
                mode === "speech"
                  ? "var(--pastel-text-on-pastel, #1f2937)"
                  : "var(--pearl-text-muted, #6b7280)",
              transition: "all 0.2s ease",
              minHeight: 44,
            }}
          >
            🎤 Speech
          </button>
        </div>

        {mode === "speech" && (
          <button
            className="btn"
            onClick={onShowLibrary}
            style={{
              background: "var(--pearl-surface-muted, #fbf9f5)",
              color: "var(--pearl-text, #1f2937)",
              border: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
              borderRadius: 14,
              minHeight: 46,
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            📚 LIBRARY
          </button>
        )}

        {}
        <button
          className="btn"
          onClick={onShowHistory}
          style={{
            background: "var(--pearl-surface-muted, #fbf9f5)",
            color: "var(--pearl-text, #1f2937)",
            border: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
            borderRadius: 14,
            minHeight: 46,
            padding: "10px 18px",
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          HISTORY
        </button>

        {}
        {userRole && userRole !== "STUDENT" && onManageSigns && (
          <button
            className="btn"
            onClick={onManageSigns}
            style={{
              background: "linear-gradient(135deg, #8b5cf6, #7c3aed)",
              color: "#fff",
              border: "none",
              boxShadow: "0 2px 8px rgba(124, 58, 237, 0.3)",
              whiteSpace: "nowrap",
              borderRadius: 14,
              minHeight: 46,
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            📹 Manage & Record Signs
          </button>
        )}

        <button
          className="btn"
          onClick={onLogout}
          title={userName ? `Signed in as ${userName}` : undefined}
          style={{
            background: "var(--pastel-coral, #f3b3ae)",
            color: "#8a2f2a",
            border: "none",
            borderRadius: 14,
            minHeight: 46,
            padding: "10px 18px",
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          LOGOUT
        </button>

        {}
        {mode === "gesture" && (
          <button
            onClick={onToggleCapture}
            className="btn"
            style={{
              minWidth: "170px",
              minHeight: 50,
              transition: "all 0.2s ease",
              border: "none",
              borderRadius: 14,
              padding: "12px 20px",
              fontSize: 14,
              fontWeight: 700,
              color: "var(--pastel-text-on-pastel, #1f2937)",
              background: isCapturing
                ? "var(--pastel-coral, #f3b3ae)"
                : "var(--pastel-mint, #9bd8bd)",
              boxShadow: isCapturing
                ? "0 6px 16px rgba(234,143,136,0.35)"
                : "0 6px 16px rgba(111,192,158,0.35)",
            }}
          >
            {isCapturing ? (
              <>
                <span
                  style={{
                    display: "inline-block",
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: "#8a2f2a",
                    marginRight: "8px",
                    animation: "blink 1s infinite",
                  }}
                />
                Close Camera
              </>
            ) : (
              "Open Camera"
            )}
          </button>
        )}
      </div>

      <style>{`
        @keyframes blink {
          0%,100% { opacity: 1 }
          50% { opacity: 0 }
        }
      `}</style>
    </header>
  );
};
export default TopNavbar;
