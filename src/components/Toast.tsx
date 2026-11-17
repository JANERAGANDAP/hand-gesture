// src/components/Toast.tsx
// Purpose: one self-contained notification bubble. Styled with inline styles
// because the project has no Tailwind. Position and stacking are handled by
// ToastProvider, which wraps every toast in a fixed bottom-right container.
import React, { useEffect, useRef } from "react";

export type ToastType = "success" | "error" | "warning" | "info";

interface ToastProps {
  message: string;
  type: ToastType;
  duration?: number;
  onClose: () => void;
}

const TOAST_COLORS: Record<ToastType, { background: string; border: string }> =
  {
    success: { background: "#16a34a", border: "#22c55e" },
    error: { background: "#dc2626", border: "#ef4444" },
    warning: { background: "#ca8a04", border: "#eab308" },
    info: { background: "#2563eb", border: "#3b82f6" },
  };

const Toast: React.FC<ToastProps> = ({
  message,
  type,
  duration = 4000,
  onClose,
}) => {
  // Keep the latest onClose in a ref so the timer below only restarts when
  // `duration` changes. Depending on onClose directly reset every toast's
  // timer each time a new toast was added, so older toasts lingered.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const timer = setTimeout(() => onCloseRef.current(), duration);
    return () => clearTimeout(timer);
  }, [duration]);

  const colors = TOAST_COLORS[type];

  return (
    <div
      role={type === "error" ? "alert" : "status"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderRadius: 16,
        border: `1px solid ${colors.border}`,
        background: colors.background,
        color: "#fff",
        boxShadow: "0 10px 25px rgba(0, 0, 0, 0.25)",
        fontSize: 14,
        fontWeight: 500,
        // The container ignores pointer events so it never blocks the page;
        // each toast opts back in so its close button stays clickable.
        pointerEvents: "auto",
      }}
    >
      <div style={{ flex: 1 }}>{message}</div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss notification"
        style={{
          background: "transparent",
          border: "none",
          color: "rgba(255, 255, 255, 0.8)",
          cursor: "pointer",
          fontSize: 16,
          lineHeight: 1,
          padding: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
};

export default Toast;