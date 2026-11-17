import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

type AppButtonVariant = "primary" | "danger" | "ghost" | "google" | "outline";

interface AppButtonProps {
  onPress: () => void;
  children: ReactNode;
  variant?: AppButtonVariant;
  disabled?: boolean;
  type?: "button" | "submit";
  style?: CSSProperties;
  title?: string;
  fullWidth?: boolean;
}

/**
 * A button whose click is wired up with addEventListener (rather than the
 * React onClick prop) via a ref, per the request to make buttons use
 * addEventListener explicitly. Styling comes from the `app-btn` classes in
 * css/theme.css, which also gives every button in the app its hover/focus
 * highlight.
 */
export default function AppButton({
  onPress,
  children,
  variant = "primary",
  disabled = false,
  type = "button",
  style,
  title,
  fullWidth = false,
}: AppButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleClick = () => {
      if (!disabled) onPressRef.current();
    };
    el.addEventListener("click", handleClick);
    return () => el.removeEventListener("click", handleClick);
  }, [disabled]);

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      title={title}
      className={`app-btn app-btn--${variant}`}
      style={{ width: fullWidth ? "100%" : undefined, ...style }}
    >
      {children}
    </button>
  );
}
