// src/components/pages/LoginPage.tsx
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { GOOGLE_SIGN_IN_CONFIGURED } from "../../config";
import { useAuth, type Role } from "../../contexts/AuthContext";
import AppButton from "../ui/AppButton";
import "../../css/login.css";

type Mode = "login" | "register";

// Hero feature list kept as data so the copy is easy to change in one place.
const HERO_FEATURES = [
  "Real-time gesture-to-text recognition",
  "Speech to sign in Tagalog, Cebuano, Ilocano & Bikolano",
];

// Shared SVG wrapper so every icon uses the same size and stroke style.
const Icon = ({ children, size = 18 }: { children: ReactNode; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const HandIcon = () => (
  <Icon size={26}>
    <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
    <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" />
    <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </Icon>
);
const UserIcon = () => (
  <Icon>
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </Icon>
);
const MailIcon = () => (
  <Icon>
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </Icon>
);
const LockIcon = () => (
  <Icon>
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Icon>
);
const EyeIcon = () => (
  <Icon>
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
const EyeOffIcon = () => (
  <Icon>
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
    <line x1="2" x2="22" y1="2" y2="22" />
  </Icon>
);
const CheckIcon = () => (
  <Icon size={14}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);

// Style override for text-only buttons (links) built on AppButton, so they
// keep the addEventListener click wiring but look like plain links.
const linkButtonStyle = {
  background: "none",
  border: "none",
  boxShadow: "none",
  padding: 0,
  fontSize: "13px",
  fontWeight: 600,
  color: "#a78bfa",
} as const;

// Login / register screen. Auth logic is unchanged; this file only
// restyles the page into the dark split-screen layout.
const LoginPage = () => {
  const navigate = useNavigate();
  const { login, register, loginWithGoogle } = useAuth();

  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Neutral (non-error) message, used for the "Forgot password?" link.
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const goToDashboard = (role?: Role) =>
    navigate(role === "STUDENT" ? "/" : "/admin-signs", { replace: true });

  const switchMode = (nextMode: Mode) => {
    setMode(nextMode);
    setError(null);
    setNotice(null);
  };

  const handleSubmit = async () => {
    setError(null);
    setNotice(null);
    if (!email || !password || (mode === "register" && !name)) {
      setError("Please fill in all required fields");
      return;
    }

    if (mode === "register") {
      if (password.length < 6) {
        setError("Password must be at least 6 characters long");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }
    }

    setSubmitting(true);
    const result =
      mode === "login"
        ? await login(email, password)
        : await register(name, email, password, "STUDENT");
    setSubmitting(false);
    if (!result.success) {
      setError(result.error ?? "Something went wrong");
      return;
    }
    goToDashboard(result.role);
  };

  const handleGoogleSuccess = async (credential?: string) => {
    if (!credential) {
      setError("Google sign-in didn't return a credential");
      return;
    }
    setError(null);
    setNotice(null);
    setSubmitting(true);
    const result = await loginWithGoogle(credential);
    setSubmitting(false);
    if (!result.success) {
      setError(result.error ?? "Google sign-in failed");
      return;
    }
    goToDashboard(result.role);
  };

  // The backend has no password-reset flow yet, so be honest about it
  // instead of linking to a page that doesn't exist.
  const handleForgotPassword = () => {
    setError(null);
    setNotice(
      "Password reset isn't available yet. Please contact your teacher or admin.",
    );
  };

  const submitOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSubmit();
  };

  return (
    <div className="fsl-login">
      <div className="fsl-login__shell">
        {/* ---------- Hero ---------- */}
        <section className="fsl-login__hero">
          <span className="fsl-login__badge">
            <span className="fsl-login__dot" />
            Filipino Sign Language
          </span>
          <h1 className="fsl-login__title">
            AI-Powered
            <span>FSL Recognition</span>
          </h1>
          <p className="fsl-login__lead">
            Real-time Filipino Sign Language recognition and translation for
            students and teachers.
          </p>
          <ul className="fsl-login__features">
            {HERO_FEATURES.map((feature) => (
              <li key={feature}>
                <span className="fsl-login__feature-icon">
                  <CheckIcon />
                </span>
                {feature}
              </li>
            ))}
          </ul>
        </section>

        {/* ---------- Form card ---------- */}
        <section className="fsl-login__card">
          <div className="fsl-login__logo">
            <HandIcon />
          </div>
          <h2 className="fsl-login__heading">
            {mode === "login" ? "Welcome back" : "Create an account"}
          </h2>
          <p className="fsl-login__sub">
            {mode === "login"
              ? "Log in to continue to FSL"
              : "Register to start using FSL"}
          </p>

          <div className="fsl-login__form">
            {mode === "register" && (
              <div className="fsl-login__field">
                <UserIcon />
                <input
                  type="text"
                  placeholder="Full name"
                  aria-label="Full name"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={submitOnEnter}
                />
              </div>
            )}

            <div className="fsl-login__field">
              <MailIcon />
              <input
                type="email"
                placeholder="Email"
                aria-label="Email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={submitOnEnter}
              />
            </div>

            <div className="fsl-login__field">
              <LockIcon />
              <input
                type={showPassword ? "text" : "password"}
                placeholder={
                  mode === "register" ? "Password (6+ characters)" : "Password"
                }
                aria-label="Password"
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={submitOnEnter}
              />
              <AppButton
                variant="ghost"
                title={showPassword ? "Hide password" : "Show password"}
                onPress={() => setShowPassword((visible) => !visible)}
                style={{
                  background: "none",
                  border: "none",
                  boxShadow: "none",
                  padding: 0,
                  color: "inherit",
                }}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </AppButton>
            </div>

            {mode === "register" && (
              <>
                <div className="fsl-login__field">
                  <LockIcon />
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Confirm password"
                    aria-label="Confirm password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onKeyDown={submitOnEnter}
                  />
                </div>
              </>
            )}

            {mode === "login" && (
              <div className="fsl-login__row">
                <AppButton
                  variant="ghost"
                  onPress={handleForgotPassword}
                  style={{ ...linkButtonStyle, fontSize: "12.5px" }}
                >
                  Forgot password?
                </AppButton>
              </div>
            )}

            {error && (
              <p className="fsl-login__error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="fsl-login__notice" role="status">
                {notice}
              </p>
            )}

            <div className="fsl-login__submit">
              <AppButton
                onPress={handleSubmit}
                disabled={submitting}
                fullWidth
                style={{
                  padding: "13px 16px",
                  borderRadius: "12px",
                  background:
                    "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
                  boxShadow: "0 10px 24px rgba(124, 58, 237, 0.4)",
                }}
              >
                {submitting
                  ? "Please wait..."
                  : mode === "login"
                    ? "Log In"
                    : "Create Account"}
              </AppButton>
            </div>

            {GOOGLE_SIGN_IN_CONFIGURED ? (
              <>
                <div className="fsl-login__divider">OR</div>
                <div className="fsl-login__google">
                  <GoogleLogin
                    onSuccess={(res) => handleGoogleSuccess(res.credential)}
                    onError={() => setError("Google sign-in failed")}
                    text={mode === "login" ? "signin_with" : "signup_with"}
                    theme="filled_black"
                    shape="pill"
                  />
                </div>
              </>
            ) : (
              <p className="fsl-login__sub">
                Google sign-in isn&apos;t configured. Use your email and password.
              </p>
            )}
          </div>

          <div className="fsl-login__switch">
            {mode === "login" ? "New here?" : "Already have an account?"}
            <AppButton
              variant="ghost"
              onPress={() => switchMode(mode === "login" ? "register" : "login")}
              style={linkButtonStyle}
            >
              {mode === "login" ? "Create an account" : "Log in"}
            </AppButton>
          </div>
        </section>
      </div>
    </div>
  );
};

export default LoginPage;