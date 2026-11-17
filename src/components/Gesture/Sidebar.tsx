interface Language {
  id: string;
  color: string;
}
interface SidebarProps {
  languages: Language[];
  activeLang: string;
  setActiveLang: (lang: string) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}
const Sidebar: React.FC<SidebarProps> = ({
  languages,
  activeLang,
  setActiveLang,
  sidebarOpen,
  toggleSidebar,
}) => {
  return (
    <>
      {}
      <div
        className={`sidebar-backdrop ${sidebarOpen ? "show" : ""}`}
        onClick={toggleSidebar}
      />

      <aside
        className={`sidebar-pro p-4 d-flex flex-column ${sidebarOpen ? "active" : ""}`}
        style={{
          backgroundColor: "var(--pearl-surface, #fff)",
          borderRight: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
          zIndex: 1050,
        }}
      >
        {}
        <div className="d-flex align-items-center justify-content-between mb-4">
          <div className="d-flex align-items-center gap-3">
            <div
              className="rounded-3 d-flex align-items-center justify-content-center fw-bold shadow-sm"
              style={{
                width: 40,
                height: 40,
                background:
                  "linear-gradient(135deg, var(--pastel-periwinkle, #a9c1f2), var(--pastel-lavender, #d3c2f7))",
                color: "var(--pastel-text-on-pastel, #1f2937)",
              }}
            >
              FSL
            </div>

            <h5
              className="m-0 fw-bold"
              style={{ color: "var(--pearl-text, #1f2937)" }}
            >
              FILIPINO{" "}
              <span
                style={{
                  color: "var(--pastel-periwinkle-deep, #7fa0e8)",
                }}
              >
                SIGN LANGUAGE
              </span>
            </h5>
          </div>

          {}
          <button
            className="btn"
            onClick={toggleSidebar}
            style={{
              background: "var(--pearl-surface-muted, #fbf9f5)",
              color: "var(--pearl-text, #1f2937)",
              border: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
            }}
          >
            ✕
          </button>
        </div>

        {}
        <div className="flex-grow-1 mt-2">
          <small
            className="d-block mb-3 fw-bold tracking-widest"
            style={{
              fontSize: "0.65rem",
              color: "var(--pearl-text-muted, #6b7280)",
              opacity: 0.8,
            }}
          >
            SELECT ENGINE
          </small>

          {}
          {languages.map((lang) => {
            const isActive = activeLang === lang.id;
            return (
              <div
                key={lang.id}
                onClick={() => setActiveLang(lang.id)}
                className="p-3 mb-3 rounded-4 border d-flex align-items-center justify-content-between"
                style={{
                  backgroundColor: isActive
                    ? `${lang.color}14`
                    : "var(--pearl-surface-muted, #fbf9f5)",
                  borderColor: isActive
                    ? lang.color
                    : "var(--pearl-border, rgba(15,23,42,0.09))",
                  boxShadow: isActive
                    ? `0 8px 20px -12px ${lang.color}77`
                    : "none",
                  cursor: "pointer",
                  transition: "all 0.3s ease",
                }}
              >
                <span
                  style={{
                    fontSize: "0.85rem",
                    fontWeight: 700,
                    color: isActive ? lang.color : "var(--pearl-text-muted, #6b7280)",
                    letterSpacing: "1px",
                  }}
                >
                  {lang.id.toUpperCase()}
                </span>

                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    backgroundColor: lang.color,
                    boxShadow: isActive ? `0 0 10px ${lang.color}` : "none",
                    opacity: isActive ? 1 : 0.3,
                  }}
                />
              </div>
            );
          })}
        </div>

        {}
        <div
          style={{
            padding: "12px",
            borderRadius: "12px",
            background: "rgba(169,193,242,0.25)",
            border: "1px solid rgba(127,160,232,0.4)",
            marginBottom: "12px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--pastel-periwinkle-deep, #7fa0e8)",
              display: "inline-block",
              animation: "aipulse 2s infinite",
            }}
          />
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#3f5a94",
            }}
          >
            🤖 LLAMA3.2:3b AI READY
          </span>
        </div>

        {}
        <div
          className="p-3 rounded-4 text-center"
          style={{
            background: "var(--pearl-surface-muted, #fbf9f5)",
            border: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
          }}
        >
          <div
            className="d-flex align-items-center justify-content-center gap-2 small fw-bold"
            style={{ color: "var(--pearl-text-muted, #6b7280)" }}
          >
            <div
              className="bg-success rounded-circle"
              style={{
                width: 8,
                height: 8,
                boxShadow: "0 0 8px #198754",
              }}
            />
            SYSTEM ONLINE
          </div>
        </div>

        <style>{`
        @keyframes aipulse {
          0%,100% {
            opacity: 1;
            box-shadow: 0 0 0 0 rgba(59,130,246,0.4);
          }
          50% {
            opacity: 0.6;
            box-shadow: 0 0 0 6px rgba(59,130,246,0);
          }
        }

        
        .sidebar-pro {
          width: 280px;
          min-width: 400px;
          height: 100vh;
          position: fixed;
          top: 0;
          left: 0;
          transform: translateX(-100%);
          transition: transform 0.3s ease;
        }

        .sidebar-pro.active {
          transform: translateX(0);
        }

       
        .sidebar-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          opacity: 0;
          visibility: hidden;
          transition: 0.3s ease;
          z-index: 1040;
        }

        .sidebar-backdrop.show {
          opacity: 1;
          visibility: visible;
        }

        @media (min-width: 992px) {
          .sidebar-backdrop {
            display: none;
          }
        }

        /* MOBILE WIDTH */
        @media (max-width: 576px) {
          .sidebar-pro {
            width: 85%;
            min-width: unset;
          }
        }
      `}</style>
      </aside>
    </>
  );
};
export default Sidebar;
