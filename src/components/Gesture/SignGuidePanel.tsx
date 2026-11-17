// src/components/Gesture/SignGuidePanel.tsx
// Right-side sign reference panel.
// Shows ONLY the 15 signs that heuristicGestureDetector.ts can actually detect,
// plus Sign1 + Sign2 → Sentence combos that mirror buildSmartSentence output exactly.

import React, { useState } from "react";

// ─── The 15 real heuristic signs ───────────────────────────────────────────
interface SignDef {
  word: string;          // exact token the recognizer returns
  label: string;         // display name (English / Bisaya)
  emoji: string;         // visual hint
  howTo: string;         // how to perform the sign
}

const SIGNS: SignDef[] = [
  {
    word: "I",
    label: "I / Ako",
    emoji: "☝️",
    howTo: "Point your index finger at your own chest.",
  },
  {
    word: "you",
    label: "You / Ikaw",
    emoji: "👉",
    howTo: "Point your index finger directly at the other person.",
  },
  {
    word: "hungry",
    label: "Hungry / Gigutom",
    emoji: "🤰",
    howTo: "Place a curved hand on your chest/stomach and slide it downward once.",
  },
  {
    word: "eat",
    label: "Eat / Kaon",
    emoji: "🤌",
    howTo: "Bunch fingertips together (like holding food) and bring them to your mouth. Repeat.",
  },
  {
    word: "water",
    label: "Water / Tubig",
    emoji: "💧",
    howTo: "Make a 'W' shape (3 fingers: index, middle, ring) and touch your chin twice.",
  },
  {
    word: "help",
    label: "Help / Tabang",
    emoji: "🤝",
    howTo: "Put both hands close together at chest level. OR: thumbs-up fist supported by the other flat hand.",
  },
  {
    word: "hello",
    label: "Hello / Kumusta",
    emoji: "👋",
    howTo: "Raise an open flat hand near your temple, palm facing out. Wave slightly.",
  },
  {
    word: "thank you",
    label: "Thank You / Salamat",
    emoji: "🤲",
    howTo: "Flat open hand starts at your lips, then moves forward — like blowing a kiss.",
  },
  {
    word: "sorry",
    label: "Sorry / Pasensya",
    emoji: "✊",
    howTo: "Make a fist and rub it in a slow circle over the center of your chest.",
  },
  {
    word: "please",
    label: "Please / Palihug",
    emoji: "🙏",
    howTo: "Flat open palm pressed flat against the center of your chest. Hold still.",
  },
  {
    word: "good",
    label: "Good / Maayo",
    emoji: "👍",
    howTo: "Thumbs-up gesture with your dominant hand near chest height.",
  },
  {
    word: "yes",
    label: "Yes / Oo",
    emoji: "✅",
    howTo: "Make a fist and nod it up and down (like a head nodding yes).",
  },
  {
    word: "no",
    label: "No / Dili",
    emoji: "🚫",
    howTo: "Pinch thumb and index finger together, then snap them open and closed quickly.",
  },
  {
    word: "black",
    label: "Black / Itom",
    emoji: "✏️",
    howTo: "Index finger extended, draw it across your forehead from one side to the other.",
  },
  {
    word: "stop",
    label: "Stop / Hunong",
    emoji: "✋",
    howTo: "Extend your flat open hand forward, palm facing away from you — like a traffic stop.",
  },
];

// ─── Combination examples (Sign1 + Sign2 → Sentence) ────────────────────────
// These MUST exactly match what buildSmartSentence() produces for those tokens.
interface ComboExample {
  sign1: string;   // word token (must match SIGNS[].word)
  sign2: string;   // word token (must match SIGNS[].word)
  output: string;  // exact buildSmartSentence([sign1, sign2]) result
}

const COMBOS: ComboExample[] = [
  // Subject + Adjective → "<Subject> am/are <adj>."
  { sign1: "I",    sign2: "hungry",    output: "I am hungry." },
  { sign1: "I",    sign2: "good",      output: "I am good." },
  { sign1: "you",  sign2: "hungry",    output: "You are hungry." },
  { sign1: "you",  sign2: "good",      output: "You are good." },

  // Subject + Verb → natural verb phrase
  { sign1: "I",    sign2: "eat",       output: "I eat." },
  { sign1: "I",    sign2: "stop",      output: "I stop." },
  { sign1: "I",    sign2: "help",      output: "I help." },
  { sign1: "you",  sign2: "eat",       output: "You eat." },
  { sign1: "you",  sign2: "stop",      output: "You stop." },

  // Subject + Object → "<Subject> need/needs <object>."
  { sign1: "I",    sign2: "water",     output: "I need water." },
  { sign1: "you",  sign2: "water",     output: "You need water." },

  // Subject + Interjection
  { sign1: "I",    sign2: "sorry",     output: "I'm sorry." },

  // Greeting combos
  { sign1: "hello", sign2: "you",      output: "Hello, you!" },

  // Standalone sign used alone (shown as single-sign examples)
  { sign1: "thank you", sign2: "",     output: "Thank you." },
  { sign1: "yes",       sign2: "",     output: "Yes." },
  { sign1: "no",        sign2: "",     output: "No." },
  { sign1: "stop",      sign2: "",     output: "Stop." },
  { sign1: "help",      sign2: "",     output: "I need help." },
  { sign1: "hungry",    sign2: "",     output: "I am hungry." },
  { sign1: "eat",       sign2: "",     output: "I want to eat." },
  { sign1: "water",     sign2: "",     output: "I need water." },
  { sign1: "sorry",     sign2: "",     output: "I'm sorry." },
  { sign1: "please",    sign2: "",     output: "Please." },
  { sign1: "good",      sign2: "",     output: "I am good." },
  { sign1: "black",     sign2: "",     output: "I am black." },
  { sign1: "hello",     sign2: "",     output: "Hello!" },
];

// ─── Tab type ────────────────────────────────────────────────────────────────
type Tab = "signs" | "combos";

// ─── Component ───────────────────────────────────────────────────────────────
interface SignGuidePanelProps {
  isOpen: boolean;
  onToggle: () => void;
}

const SignGuidePanel: React.FC<SignGuidePanelProps> = ({ isOpen, onToggle }) => {
  const [tab, setTab] = useState<Tab>("signs");
  const [search, setSearch] = useState("");
  const [expandedWord, setExpandedWord] = useState<string | null>(null);

  const filteredSigns = SIGNS.filter((s) => {
    const q = search.toLowerCase();
    return !q || s.word.toLowerCase().includes(q) || s.label.toLowerCase().includes(q);
  });

  const filteredCombos = COMBOS.filter((c) => {
    const q = search.toLowerCase();
    return (
      !q ||
      c.sign1.toLowerCase().includes(q) ||
      c.sign2.toLowerCase().includes(q) ||
      c.output.toLowerCase().includes(q)
    );
  });

  const signMap = Object.fromEntries(SIGNS.map((s) => [s.word, s]));

  return (
    <>
      <style>{`
        .sgp-panel {
          width: 300px;
          min-width: 300px;
          height: 100vh;
          position: sticky;
          top: 0;
          display: flex;
          flex-direction: column;
          background: var(--pearl-surface, #fff);
          border-left: 1px solid var(--pearl-border, rgba(15,23,42,0.09));
          box-shadow: -4px 0 24px rgba(15,23,42,0.06);
          transition: width 0.3s ease, min-width 0.3s ease, opacity 0.3s ease;
          overflow: hidden;
          z-index: 10;
          flex-shrink: 0;
        }
        .sgp-panel.closed {
          width: 0;
          min-width: 0;
          opacity: 0;
          pointer-events: none;
        }
        .sgp-toggle {
          position: fixed;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          z-index: 50;
          width: 28px;
          height: 72px;
          border-radius: 10px 0 0 10px;
          border: 1px solid var(--pearl-border, rgba(15,23,42,0.1));
          border-right: none;
          background: var(--pearl-surface, #fff);
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          box-shadow: -3px 0 10px rgba(15,23,42,0.07);
          transition: right 0.3s ease, background 0.15s;
          color: var(--pearl-text-muted, #6b7280);
          font-size: 15px;
          gap: 3px;
        }
        .sgp-toggle:hover { background: var(--pearl-surface-muted, #fbf9f5); }
        .sgp-toggle-label {
          font-size: 8px;
          font-weight: 800;
          letter-spacing: 1.5px;
          writing-mode: vertical-rl;
          text-orientation: mixed;
          color: var(--pearl-text-muted, #6b7280);
        }
        .sgp-tab {
          flex: 1;
          padding: 8px 4px;
          border: none;
          background: transparent;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          transition: all 0.15s;
          color: var(--pearl-text-muted, #9ca3af);
          letter-spacing: 0.3px;
        }
        .sgp-tab.active {
          color: var(--pearl-text, #1f2937);
          border-bottom-color: #7fa0e8;
        }
        .sgp-sign-card {
          border-radius: 12px;
          padding: 11px 12px;
          margin-bottom: 8px;
          cursor: pointer;
          border: 1px solid var(--pearl-border, rgba(15,23,42,0.09));
          background: var(--pearl-surface-muted, #fbf9f5);
          transition: box-shadow 0.15s, transform 0.12s, border-color 0.15s;
        }
        .sgp-sign-card:hover {
          border-color: rgba(127,160,232,0.5);
          box-shadow: 0 4px 14px rgba(15,23,42,0.08);
          transform: translateY(-1px);
        }
        .sgp-sign-card.expanded {
          border-color: rgba(127,160,232,0.6);
          background: rgba(169,193,242,0.08);
          box-shadow: 0 6px 20px rgba(15,23,42,0.1);
        }
        .sgp-combo-card {
          border-radius: 12px;
          padding: 10px 12px;
          margin-bottom: 8px;
          border: 1px solid var(--pearl-border, rgba(15,23,42,0.09));
          background: var(--pearl-surface-muted, #fbf9f5);
        }
        .sgp-token {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 9px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          background: rgba(127,160,232,0.15);
          border: 1px solid rgba(127,160,232,0.4);
          color: #3f5a94;
          letter-spacing: 0.3px;
          white-space: nowrap;
        }
        .sgp-output {
          display: inline-block;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 12.5px;
          font-weight: 700;
          background: rgba(111,192,158,0.18);
          border: 1px solid rgba(111,192,158,0.5);
          color: #1a5a3f;
        }
        .sgp-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 10px 10px 24px;
          scrollbar-width: thin;
          scrollbar-color: rgba(127,160,232,0.3) transparent;
        }
      `}</style>

      {/* ── Toggle button ── */}
      <button
        className="sgp-toggle"
        style={{ right: isOpen ? "300px" : "0px" }}
        onClick={onToggle}
        title={isOpen ? "Close Sign Guide" : "Open Sign Guide (Basahon diri)"}
      >
        <span style={{ fontSize: 16 }}>✋</span>
        <span className="sgp-toggle-label">{isOpen ? "CLOSE" : "GUIDE"}</span>
      </button>

      {/* ── Panel ── */}
      <aside className={`sgp-panel${isOpen ? "" : " closed"}`}>

        {/* Header */}
        <div style={{
          padding: "14px 14px 0",
          borderBottom: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 22 }}>✋</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: "var(--pearl-text, #1f2937)", lineHeight: 1.1 }}>
                Sign Guide
              </div>
              <div style={{ fontSize: 10.5, color: "var(--pearl-text-muted, #6b7280)", marginTop: 1 }}>
                Basahon diri paunsa mag-sign
              </div>
            </div>
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Search… (e.g. hungry, eat, hello)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--pearl-border, rgba(15,23,42,0.12))",
              background: "var(--pearl-surface-muted, #fbf9f5)",
              fontSize: 12,
              color: "var(--pearl-text, #1f2937)",
              outline: "none",
              boxSizing: "border-box",
              marginBottom: 8,
            }}
          />

          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid var(--pearl-border, rgba(15,23,42,0.09))" }}>
            <button
              className={`sgp-tab${tab === "signs" ? " active" : ""}`}
              onClick={() => setTab("signs")}
            >
              ✋ SIGNS ({SIGNS.length})
            </button>
            <button
              className={`sgp-tab${tab === "combos" ? " active" : ""}`}
              onClick={() => setTab("combos")}
            >
              ➕ COMBOS ({COMBOS.length})
            </button>
          </div>
        </div>

        {/* ── SIGNS TAB ── */}
        {tab === "signs" && (
          <div className="sgp-scroll">
            {filteredSigns.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--pearl-text-muted,#6b7280)", fontSize: 12, marginTop: 28, opacity: 0.7 }}>
                Walay nakita. Try another word.
              </div>
            )}
            {filteredSigns.map((sign) => {
              const expanded = expandedWord === sign.word;
              return (
                <div
                  key={sign.word}
                  className={`sgp-sign-card${expanded ? " expanded" : ""}`}
                  onClick={() => setExpandedWord(expanded ? null : sign.word)}
                >
                  {/* Top row */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {/* Emoji */}
                    <span style={{
                      fontSize: 28,
                      lineHeight: 1,
                      flexShrink: 0,
                      filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.1))",
                    }}>
                      {sign.emoji}
                    </span>

                    {/* Text */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span className="sgp-token">{sign.word.toUpperCase()}</span>
                        <span style={{ fontSize: 11, color: "var(--pearl-text-muted,#6b7280)" }}>
                          {sign.label}
                        </span>
                      </div>

                      {/* How-to — collapsed: 1 line. Expanded: full */}
                      <div style={{
                        marginTop: 5,
                        fontSize: 11.5,
                        color: "#374151",
                        lineHeight: 1.5,
                        overflow: "hidden",
                        maxHeight: expanded ? "120px" : "18px",
                        transition: "max-height 0.22s ease",
                        opacity: 0.85,
                        whiteSpace: expanded ? "normal" : "nowrap",
                        textOverflow: expanded ? "clip" : "ellipsis",
                      }}>
                        💡 {sign.howTo}
                      </div>
                    </div>

                    {/* Chevron */}
                    <span style={{
                      fontSize: 10,
                      color: "var(--pearl-text-muted,#9ca3af)",
                      flexShrink: 0,
                      transition: "transform 0.2s",
                      transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                    }}>▼</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── COMBOS TAB ── */}
        {tab === "combos" && (
          <div className="sgp-scroll">
            {/* Legend */}
            <div style={{
              padding: "8px 10px",
              borderRadius: 10,
              background: "rgba(169,193,242,0.12)",
              border: "1px solid rgba(127,160,232,0.3)",
              marginBottom: 10,
              fontSize: 11,
              color: "#3f5a94",
              lineHeight: 1.5,
            }}>
              <strong>Paagi:</strong> Buhata ang <span className="sgp-token" style={{ fontSize: 10 }}>SIGN 1</span>{" "}
              {" "}➕{" "}
              <span className="sgp-token" style={{ fontSize: 10 }}>SIGN 2</span>{" "}
              → makuha ang 💬 sentence.
            </div>

            {filteredCombos.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--pearl-text-muted,#6b7280)", fontSize: 12, marginTop: 28, opacity: 0.7 }}>
                Walay nakita.
              </div>
            )}

            {filteredCombos.map((combo, idx) => {
              const s1 = signMap[combo.sign1];
              const s2 = combo.sign2 ? signMap[combo.sign2] : null;
              const isSingle = !combo.sign2;

              return (
                <div key={idx} className="sgp-combo-card">
                  {/* Sign tokens row */}
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flexWrap: "wrap",
                    marginBottom: 7,
                  }}>
                    {/* Sign 1 */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                      <span style={{ fontSize: 20 }}>{s1?.emoji ?? "✋"}</span>
                      <span className="sgp-token">{combo.sign1.toUpperCase()}</span>
                    </div>

                    {/* + operator or solo indicator */}
                    {!isSingle ? (
                      <>
                        <span style={{
                          fontSize: 16,
                          fontWeight: 900,
                          color: "var(--pearl-text-muted,#9ca3af)",
                        }}>➕</span>

                        {/* Sign 2 */}
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                          <span style={{ fontSize: 20 }}>{s2?.emoji ?? "✋"}</span>
                          <span className="sgp-token">{combo.sign2.toUpperCase()}</span>
                        </div>
                      </>
                    ) : (
                      <span style={{
                        fontSize: 11,
                        color: "var(--pearl-text-muted,#9ca3af)",
                        fontWeight: 600,
                        fontStyle: "italic",
                      }}>(alone)</span>
                    )}

                    {/* Arrow */}
                    <span style={{
                      fontSize: 14,
                      color: "var(--pearl-text-muted,#9ca3af)",
                      marginLeft: "auto",
                    }}>→</span>
                  </div>

                  {/* Output sentence */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 14 }}>💬</span>
                    <span className="sgp-output">{combo.output}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding: "8px 12px",
          borderTop: "1px solid var(--pearl-border, rgba(15,23,42,0.09))",
          fontSize: 10,
          color: "var(--pearl-text-muted, #9ca3af)",
          textAlign: "center",
          flexShrink: 0,
          lineHeight: 1.4,
        }}>
          {tab === "signs"
            ? `${filteredSigns.length} of ${SIGNS.length} signs • Tap to see how-to`
            : `${filteredCombos.length} combos • Sign1 ➕ Sign2 → Output`
          }
        </div>
      </aside>
    </>
  );
};

export default SignGuidePanel;
