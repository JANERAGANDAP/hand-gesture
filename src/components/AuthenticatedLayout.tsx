import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { SUPPORTED_LANGUAGES, type Language } from "../types/language";
import "./AuthenticatedLayout.css";

interface AuthenticatedLayoutProps {
  children: ReactNode;
  activeLanguage: Language;
  onLanguageChange: (language: Language) => void;
}

const AuthenticatedLayout = ({
  children,
  activeLanguage,
  onLanguageChange,
}: AuthenticatedLayoutProps) => {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const canManageSigns = user?.role === "ADMIN" || user?.role === "TEACHER";
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    if (!sidebarOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sidebarOpen]);

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="authenticated-layout">
      <header className="authenticated-layout__mobile-header">
        <button
          type="button"
          className="authenticated-layout__menu-button"
          aria-label={sidebarOpen ? "Close app menu" : "Open app menu"}
          aria-expanded={sidebarOpen}
          aria-controls="app-navigation"
          onClick={() => setSidebarOpen((open) => !open)}
        >
          {sidebarOpen ? "×" : "☰"}
        </button>
        <div className="authenticated-layout__mobile-brand">
          <span className="authenticated-layout__logo">FSL</span>
          <span>Hand Gesture</span>
        </div>
        <span className="authenticated-layout__mobile-role">
          {user?.role}
        </span>
      </header>

      <button
        type="button"
        className={`authenticated-layout__backdrop${sidebarOpen ? " is-open" : ""}`}
        aria-label="Close app menu"
        aria-hidden={!sidebarOpen}
        tabIndex={sidebarOpen ? 0 : -1}
        disabled={!sidebarOpen}
        onClick={() => setSidebarOpen(false)}
      />

      <aside
        id="app-navigation"
        className={`authenticated-layout__sidebar${sidebarOpen ? " is-open" : ""}`}
        aria-label="App navigation"
      >
        <div className="authenticated-layout__brand">
          <span className="authenticated-layout__logo">FSL</span>
          <span>
            <strong>Hand Gesture</strong>
            <small>Sign language tools</small>
          </span>
        </div>

        <div className="authenticated-layout__section-label">WORKSPACE</div>
        <nav className="authenticated-layout__nav">
          <NavLink
            to="/"
            end
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `authenticated-layout__link${isActive ? " is-active" : ""}`
            }
          >
            <span aria-hidden="true">⌂</span>
            <span>Gesture workspace</span>
          </NavLink>
          {canManageSigns && (
            <NavLink
              to="/admin-signs"
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `authenticated-layout__link${isActive ? " is-active" : ""}`
              }
            >
              <span aria-hidden="true">▤</span>
              <span>Sign management</span>
            </NavLink>
          )}
          {isAdmin && (
            <NavLink
              to="/users"
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `authenticated-layout__link${isActive ? " is-active" : ""}`
              }
            >
              <span aria-hidden="true">♙</span>
              <span>Users</span>
            </NavLink>
          )}
        </nav>

        <div className="authenticated-layout__footer">
          <label className="authenticated-layout__language">
            <span>Translation language</span>
            <select
              value={activeLanguage}
              onChange={(event) => {
                const language = SUPPORTED_LANGUAGES.find(
                  (candidate) => candidate === event.currentTarget.value,
                );
                if (language) onLanguageChange(language);
              }}
            >
              {SUPPORTED_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </select>
          </label>

          <div className="authenticated-layout__account">
            <div className="authenticated-layout__avatar" aria-hidden="true">
              {user?.name.trim().charAt(0).toUpperCase() || "U"}
            </div>
            <div className="authenticated-layout__user">
              <strong>{user?.name}</strong>
              <span>{user?.role}</span>
            </div>
            <button
              type="button"
              className="authenticated-layout__logout"
              onClick={handleLogout}
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="authenticated-layout__content">{children}</main>
    </div>
  );
};

export default AuthenticatedLayout;
