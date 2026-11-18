import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AdminSignRecorder, { RECOMMENDED_RECORDINGS } from "./AdminSignRecorder";
import TeacherInvites from "./TeacherInvites";
import AppButton from "../ui/AppButton";
import { API_ROOT, resolveApiUrl } from "../../config";
import {
  authHeaders,
  invalidateSignLibraryCache,
  uploadSignAsset,
} from "../../services/api";
import { useAuth } from "../../contexts/AuthContext";
import {
  getGestureSummary,
  type RecordedGestureSummary,
} from "../../services/gestureApi";
import { deleteWord } from "../../services/gestureApi";

interface SignAsset {
  id: number;
  word: string;
  type: string;
  file: string;
  isPublished: boolean;
}

const LANGUAGES = ["English", "Cebuano", "Tagalog", "Ilocano", "Bikolano"];

const ALLOWED_UPLOAD_TYPES = [
  "video/mp4",
  "image/jpeg",
  "image/png",
  "image/webp",
];

const AdminSigns = () => {
  const navigate = useNavigate();
  const { user, token, logout } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const [word, setWord] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [assets, setAssets] = useState<SignAsset[]>([]);
  const [translationsInput, setTranslationsInput] = useState("{}");
  const [aliasesInput, setAliasesInput] = useState("");
  const [language, setLanguage] = useState("English");
  const [publishNow, setPublishNow] = useState(true);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [recordedWords, setRecordedWords] = useState<RecordedGestureSummary[]>(
    [],
  );
  const [recordedLoading, setRecordedLoading] = useState(true);
  const [healthCheck, setHealthCheck] = useState<{
    loading: boolean;
    flagged: { id: number; word: string; cleaned: string }[] | null;
    error: string | null;
  }>({ loading: false, flagged: null, error: null });
  // Single active tab instead of two independent toggles: clicking
  // "Record Sign" shows the recorder form together with the Recorded
  // Signs grid, clicking "Upload Sign" shows the upload form together
  // with the Uploaded Signs grid. Neither selected = clean dashboard
  // with just the two buttons.
  const [activeTab, setActiveTab] = useState<"record" | "upload" | null>(
    null,
  );

  const loadRecordedSigns = () => {
    setRecordedLoading(true);
    getGestureSummary()
      .then((res) => {
        if (res.success) setRecordedWords(res.words);
      })
      .finally(() => setRecordedLoading(false));
  };

  // Runs the backend's whitespace health-check (see signs.routes.ts) so a
  // teacher/admin can proactively spot library entries that look fine in
  // this UI but would silently never match anything a student says — a
  // double space, a leading/trailing space, or a copy-pasted non-breaking
  // space, all invisible to the eye. New uploads can't end up this way
  // anymore (sanitized on save), but this catches anything recorded
  // before that fix existed.
  const runHealthCheck = () => {
    setHealthCheck({ loading: true, flagged: null, error: null });
    fetch(`${API_ROOT}/api/signs/health-check`, { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) throw new Error(data.error || "Health check failed");
        setHealthCheck({ loading: false, flagged: data.flagged, error: null });
      })
      .catch((err) =>
        setHealthCheck({
          loading: false,
          flagged: null,
          error: err instanceof Error ? err.message : "Health check failed",
        }),
      );
  };

  const [fixingIds, setFixingIds] = useState<Set<number>>(new Set());
  const fixFlaggedWord = (id: number) => {
    setFixingIds((prev) => new Set(prev).add(id));
    fetch(`${API_ROOT}/api/upload/${id}/word`, {
      method: "PATCH",
      headers: authHeaders(),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) throw new Error(data.error || "Fix failed");
        setAssets((prev) =>
          prev.map((a) => (a.id === id ? { ...a, word: data.word } : a)),
        );
        setHealthCheck((prev) => ({
          ...prev,
          flagged: prev.flagged ? prev.flagged.filter((f) => f.id !== id) : prev.flagged,
        }));
      })
      .catch((err) => {
        window.alert(err instanceof Error ? err.message : "Fix failed");
      })
      .finally(() => {
        setFixingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      });
  };

  useEffect(() => {
    fetch(`${API_ROOT}/api/signs`, { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => {
        type Sign = {
          id: number;
          word: string;
          file: string;
          type: string;
          isPublished: boolean;
        };
        const updatedData: Sign[] = data.map((item: Sign) => ({
          ...item,
          file: resolveApiUrl(item.file),
        }));
        setAssets(updatedData);
      })
      .catch(console.error);
    loadRecordedSigns();
  }, []);

  const saveAssets = (updated: SignAsset[]) => {
    setAssets(updated);
    localStorage.setItem("sign-assets", JSON.stringify(updated));
  };

  const handleUpload = async () => {
    if (!word || !file || !language) {
      alert("Complete all fields");
      return;
    }
    // Unpublished uploads stay hidden from student listings until a
    // teacher or admin reviews and publishes them.
    try {
      const translations: unknown = JSON.parse(translationsInput);
      if (
        !translations ||
        typeof translations !== "object" ||
        Array.isArray(translations) ||
        Object.values(translations).some(
          (translation) =>
            typeof translation !== "string" || !translation.trim(),
        )
      ) {
        throw new Error("Translations must be a JSON object of language and text pairs.");
      }
      const data = await uploadSignAsset(file, {
        word,
        language,
        publish: publishNow,
        translations: translations as Record<string, string>,
        aliases: aliasesInput
          .split(",")
          .map((alias) => alias.trim())
          .filter(Boolean),
      });
      const newAsset = {
        id: data.id,
        word: data.word,
        type: data.type,
        file: resolveApiUrl(data.file),
        isPublished: data.isPublished,
      };

      const updated = [...assets, newAsset];
      saveAssets(updated);
      setWord("");
      setTranslationsInput("{}");
      setAliasesInput("");
      setFile(null);
      setPreview(null);
      setPublishNow(true);
      alert("Upload successful!");
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Upload failed");
    }
  };

  const handleBulkImport = async () => {
    if (!bulkFile) {
      alert("Choose a .json or .csv dataset file first.");
      return;
    }
    const formData = new FormData();
    formData.append("file", bulkFile);
    setBulkImporting(true);
    try {
      const response = await fetch(`${API_ROOT}/api/gestures/bulk`, {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Bulk import failed");
      }
      invalidateSignLibraryCache();
      setBulkFile(null);
      alert(
        `Imported ${result.imported} gesture entries and registered ${result.assets} image assets.`,
      );
    } catch (error) {
      console.error("Bulk gesture import failed:", error);
      alert(error instanceof Error ? error.message : "Bulk import failed");
    } finally {
      setBulkImporting(false);
    }
  };

  // Returns whether the backend delete actually succeeded — the caller
  // uses this to decide whether the item should disappear from the UI.
  // Previously this fired-and-forgot while the UI removed the row
  // unconditionally beforehand, so a failed backend delete (or, for
  // freshly-uploaded items, a stale client-generated id) left the row
  // and its Supabase storage file behind with no visible sign of it.
  const handleDelete = async (id: string, word: string): Promise<boolean> => {
    if (!id || !word) {
      alert("No ID to the item");
      return false;
    }
    const formData = new FormData();
    formData.append("id", id);
    formData.append("word", word);
    try {
      const res = await fetch(`${API_ROOT}/api/upload/delete`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || "Deletion failed");
        return false;
      }
      await res.json();
      alert("Deletion successful!");
      return true;
    } catch (err) {
      console.error(err);
      alert("Deletion failed");
      return false;
    }
  };

  // Flips an already-uploaded asset's staging state (TEACHER/ADMIN only,
  // enforced server-side too). Updates local state on success so the
  // badge/button reflect the new state without a full refetch.
  const handleTogglePublish = async (id: number, nextPublished: boolean) => {
    try {
      const res = await fetch(`${API_ROOT}/api/upload/${id}/publish`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ isPublished: nextPublished }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || "Failed to update publish state");
        return;
      }
      saveAssets(
        assets.map((a) =>
          a.id === id ? { ...a, isPublished: nextPublished } : a,
        ),
      );
    } catch (err) {
      console.error(err);
      alert("Failed to update publish state");
    }
  };

  const deleteAsset = (id: number) => {
    const updated = assets.filter((asset) => asset.id !== id);
    saveAssets(updated);
  };

  // Ascending (A-Z) order — computed at render time so it always reflects
  // the latest fetch/delete without needing a separate sort-on-write step.
  const sortedRecordedWords = [...recordedWords].sort((a, b) =>
    a.word.localeCompare(b.word),
  );
  const sortedAssets = [...assets].sort((a, b) =>
    a.word.localeCompare(b.word),
  );

  return (
    <div
      className="pearl-page"
      style={{
        padding: "clamp(16px, 5vw, 40px)",
      }}
    >
      {}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "12px",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "30px",
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: "clamp(20px, 5vw, 26px)",
              fontWeight: 700,
            }}
          >
            Sign Asset Manager
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: "14px",
              color: "var(--pearl-text-muted)",
            }}
          >
            Signed in as {user?.name} (
            {isAdmin ? "Admin" : user?.role === "STUDENT" ? "Student" : "Teacher"}
            )
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <AppButton
            variant="outline"
            onPress={() => navigate("/")}
          >
            ← Live Recognition
          </AppButton>
          <AppButton
            variant="danger"
            onPress={() => {
              logout();
              navigate("/login", { replace: true });
            }}
          >
            Logout
          </AppButton>
        </div>
      </div>

      {isAdmin && <TeacherInvites />}

      {}
      <div
        style={{
          display: "flex",
          gap: "12px",
          marginBottom: "24px",
          flexWrap: "wrap",
        }}
      >
        <AppButton
          variant={activeTab === "record" ? "primary" : "outline"}
          onPress={() =>
            setActiveTab((v) => (v === "record" ? null : "record"))
          }
        >
          {activeTab === "record" ? "Close" : "Record Sign"}
        </AppButton>
        <AppButton
          variant={activeTab === "upload" ? "primary" : "outline"}
          onPress={() =>
            setActiveTab((v) => (v === "upload" ? null : "upload"))
          }
        >
          {activeTab === "upload" ? "Close" : "Upload Sign"}
        </AppButton>
      </div>

      {(user?.role === "ADMIN" || user?.role === "TEACHER") && <section
        className="pearl-card"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          padding: 18,
          marginBottom: 24,
        }}
      >
        <div style={{ flex: "1 1 260px" }}>
          <strong>Bulk gesture dataset import</strong>
          <div style={{ color: "var(--pearl-text-muted)", fontSize: 13 }}>
            Import up to 1,000 entries from JSON or CSV, including exactly 21
            x/y/z landmarks per gesture.
          </div>
        </div>
        <input
          type="file"
          accept=".json,.csv,application/json,text/csv"
          aria-label="Select gesture dataset JSON or CSV"
          onChange={(event) => {
            const selected = event.target.files?.[0] ?? null;
            if (
              selected &&
              (!/\.(json|csv)$/i.test(selected.name) ||
                selected.size > 5 * 1024 * 1024)
            ) {
              alert("Choose a .json or .csv file no larger than 5 MB.");
              event.target.value = "";
              setBulkFile(null);
              return;
            }
            setBulkFile(selected);
          }}
        />
        <AppButton
          variant="primary"
          onPress={() => void handleBulkImport()}
          disabled={!bulkFile || bulkImporting}
        >
          {bulkImporting ? "Importing…" : "Import dataset"}
        </AppButton>
      </section>}

      <div className="row">
        <div className="col-lg-3">
          {}
          <div
            className="pearl-card"
            style={{
              padding: "28px",
              marginBottom: "30px",
            }}
          >
            <h5
              style={{
                marginBottom: "16px",
                fontWeight: 600,
              }}
            >
              Upload New Sign
            </h5>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "14px",
              }}
            >
              <input
                type="text"
                placeholder="Enter word"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                className="pearl-input"
              />

              <input
                type="text"
                placeholder='Translations JSON, e.g. {"Tagalog":"pula","Cebuano":"pula"}'
                value={translationsInput}
                onChange={(e) => setTranslationsInput(e.target.value)}
                className="pearl-input"
                aria-label="Translations by language in JSON format"
              />

              <input
                type="text"
                placeholder="Alternate spoken words (comma-separated)"
                value={aliasesInput}
                onChange={(e) => setAliasesInput(e.target.value)}
                className="pearl-input"
                aria-label="Alternate spoken words"
              />

              <input
                type="file"
                accept="video/mp4,image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    const file = e.target.files[0];
                    if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
                      alert(
                        "Unsupported file type. Please upload an MP4 video or a JPG/PNG/WEBP image — other formats may not play reliably in every browser.",
                      );
                      e.target.value = "";
                      setFile(null);
                      setPreview(null);
                      return;
                    }
                    setFile(file);
                    setPreview(URL.createObjectURL(file));
                  }
                }}
                className="pearl-input"
                style={{ cursor: "pointer" }}
              />

              {}
              {preview && (
                <div
                  style={{
                    borderRadius: "12px",
                    overflow: "hidden",
                    border: "1px solid var(--pearl-border)",
                    background: "var(--pearl-surface-muted)",
                    padding: "10px",
                  }}
                >
                  {file?.type.startsWith("video") ? (
                    <video
                      src={preview}
                      controls
                      muted
                      style={{
                        width: "100%",
                        borderRadius: "10px",
                      }}
                    />
                  ) : (
                    <img
                      src={preview}
                      alt="Preview"
                      style={{
                        width: "100%",
                        maxHeight: "220px",
                        objectFit: "contain",
                        borderRadius: "10px",
                      }}
                    />
                  )}
                </div>
              )}

              <div
                style={{
                  position: "relative",
                }}
              >
                <div
                  onClick={() => setOpen(!open)}
                  className="pearl-input"
                  style={{ cursor: "pointer" }}
                >
                  {language}
                </div>

                {open && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      width: "100%",
                      background: "var(--pearl-surface)",
                      border: "1px solid var(--pearl-border)",
                      borderRadius: "8px",
                      marginTop: "6px",
                      overflow: "hidden",
                      zIndex: 10,
                      boxShadow: "var(--pearl-shadow)",
                    }}
                  >
                    {LANGUAGES.map((lang) => (
                      <div
                        key={lang}
                        onClick={() => {
                          setLanguage(lang);
                          setOpen(false);
                        }}
                        style={{
                          padding: "10px 12px",
                          cursor: "pointer",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background =
                            "var(--pearl-surface-muted)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "transparent")
                        }
                      >
                        {lang}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                  color: "var(--pearl-text-muted)",
                  marginBottom: "14px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={publishNow}
                  onChange={(e) => setPublishNow(e.target.checked)}
                />
                Publish immediately (uncheck to stage for review — students
                won't see it until you publish it)
              </label>

              <AppButton onPress={handleUpload} fullWidth>
                Upload Sign
              </AppButton>
            </div>
          </div>
        </div>
        <div className="col-lg-9">
          <div
            className="pearl-card"
            style={{
              padding: "28px",
              marginBottom: "30px",
              width: "100%",
            }}
          >
            <h5
              style={{
                marginBottom: "16px",
                fontWeight: 600,
              }}
            >
              Record New Sign
            </h5>

            <AdminSignRecorder onGestureSaved={loadRecordedSigns} />
          </div>
        </div>
      </div>

      {}
      {activeTab === "record" && (
      <>
      <h5 style={{ marginBottom: "16px", fontWeight: 600 }}>Recorded Signs</h5>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(min(180px, 100%),1fr))",
          gap: "20px",
          marginBottom: "36px",
        }}
      >
        {recordedLoading ? (
          <p style={{ color: "var(--pearl-text-muted)" }}>Loading…</p>
        ) : recordedWords.length === 0 ? (
          <p style={{ color: "var(--pearl-text-muted)" }}>
            No signs recorded yet — use "Record New Sign" above to add one.
          </p>
        ) : (
          sortedRecordedWords.map((entry) => (
            <div
              key={`${entry.word}::${entry.language}`}
              className="pearl-card"
              style={{
                padding: "14px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              {entry.handCropUrl ? (
                <img
                  src={resolveApiUrl(entry.handCropUrl)}
                  alt={entry.word}
                  loading="lazy"
                  decoding="async"
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    maxHeight: "200px",
                    objectFit: "cover",
                    borderRadius: "10px",
                    background: "var(--pearl-surface-muted)",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    maxHeight: "200px",
                    borderRadius: "10px",
                    background: "var(--pearl-surface-muted)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "13px",
                    color: "var(--pearl-text-muted)",
                    textAlign: "center",
                    padding: "10px",
                  }}
                >
                  {entry.gestureType === "dynamic"
                    ? "Motion sign — no still preview"
                    : "No preview yet"}
                </div>
              )}
              <h3
                style={{
                  margin: 0,
                  fontSize: "16px",
                  fontWeight: 600,
                  textAlign: "center",
                  letterSpacing: "0.5px",
                }}
              >
                {entry.word}
              </h3>

              {isAdmin && (
                  <AppButton
                    variant="danger"
                    onPress={async () => {
                      const res = await deleteWord(entry.word, entry.language);
                      if (res.success) loadRecordedSigns();
                    }}
                  >
                    Delete
                  </AppButton>
                )}

              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: "8px",
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    padding: "2px 10px",
                    borderRadius: "999px",
                    background:
                      entry.gestureType === "dynamic"
                        ? "rgba(211,194,247,0.4)"
                        : "rgba(155,216,189,0.4)",
                    color: "var(--pearl-text)",
                  }}
                >
                  {entry.gestureType === "dynamic" ? "Dynamic" : "Static"}
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    padding: "2px 10px",
                    borderRadius: "999px",
                    background:
                      entry.count < RECOMMENDED_RECORDINGS
                        ? "rgba(243,179,174,0.4)"
                        : "rgba(155,216,189,0.4)",
                    color: "var(--pearl-text)",
                  }}
                >
                  {entry.count}/{RECOMMENDED_RECORDINGS} recordings
                </span>
              </div>
            </div>
          ))
        )}
      </div>
      </>
      )}

      {}
      {activeTab === "upload" && (
      <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "16px",
        }}
      >
        <h5 style={{ fontWeight: 600, margin: 0 }}>Uploaded Signs</h5>
        <AppButton
          variant="outline"
          onPress={runHealthCheck}
          disabled={healthCheck.loading}
        >
          {healthCheck.loading ? "Checking..." : "Check Library Health"}
        </AppButton>
      </div>
      {healthCheck.error && (
        <div
          className="pearl-card"
          style={{ padding: "12px 16px", marginBottom: "16px", color: "#b42318" }}
        >
          {healthCheck.error}
        </div>
      )}
      {healthCheck.flagged && (
        <div
          className="pearl-card"
          style={{ padding: "12px 16px", marginBottom: "16px" }}
        >
          {healthCheck.flagged.length === 0 ? (
            <p style={{ margin: 0 }}>
              ✅ All {assets.length} sign word(s) look clean — no stray
              whitespace found.
            </p>
          ) : (
            <>
              <p style={{ margin: "0 0 8px", fontWeight: 600 }}>
                ⚠️ {healthCheck.flagged.length} sign(s) have invisible
                whitespace issues that can prevent speech from ever
                matching them — rename each to the suggested clean version:
              </p>
              <ul style={{ margin: 0, paddingLeft: "20px" }}>
                {healthCheck.flagged.map((f) => (
                  <li
                    key={f.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      marginBottom: "4px",
                    }}
                  >
                    <span>
                      "{f.word}" → should be "{f.cleaned}"
                    </span>
                    <AppButton
                      variant="outline"
                      onPress={() => fixFlaggedWord(f.id)}
                      disabled={fixingIds.has(f.id)}
                    >
                      {fixingIds.has(f.id) ? "Fixing..." : "Fix Now"}
                    </AppButton>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(min(180px, 100%),1fr))",
          gap: "20px",
        }}
      >
        {sortedAssets.map((asset) => (
          <div
            key={asset.id}
            className="pearl-card"
            style={{
              padding: "14px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            {asset.type.startsWith("video") ? (
              <video
                src={asset.file}
                controls
                muted
                preload="none"
                style={{
                  width: "100%",
                  borderRadius: "10px",
                }}
              />
            ) : (
              <img
                src={asset.file}
                alt={asset.word}
                loading="lazy"
                decoding="async"
                style={{
                  width: "100%",
                  aspectRatio: "1 / 1",
                  maxHeight: "200px",
                  objectFit: "contain",
                  borderRadius: "10px",
                  background: "var(--pearl-surface-muted)",
                }}
              />
            )}

            <h3
              style={{
                margin: 0,
                fontSize: "16px",
                fontWeight: 600,
                textAlign: "center",
                letterSpacing: "0.5px",
              }}
            >
              {asset.word}
            </h3>

            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                padding: "2px 10px",
                borderRadius: "999px",
                alignSelf: "center",
                background: asset.isPublished
                  ? "rgba(155,216,189,0.4)"
                  : "rgba(243,179,174,0.4)",
                color: "var(--pearl-text)",
              }}
            >
              {asset.isPublished ? "Published" : "Draft — staged"}
            </span>

            {/* Publishing is a TEACHER/ADMIN action, same population the
                staging checkbox is aimed at — the server enforces this
                too, this just keeps the button from appearing for
                students who'd get a 403 anyway. */}
            {(user?.role === "TEACHER" || isAdmin) && (
              <AppButton
                variant="outline"
                onPress={() =>
                  handleTogglePublish(asset.id, !asset.isPublished)
                }
              >
                {asset.isPublished ? "Unpublish" : "Publish"}
              </AppButton>
            )}

            {/* Teachers can view records but not delete them — delete is Admin-only. */}
            {isAdmin && (
              <AppButton
                variant="danger"
                disabled={deletingIds.has(asset.id)}
                onPress={async () => {
                  // Click-guard: without this, a fast double-click fires
                  // two identical DELETE requests before the first
                  // response comes back — the first succeeds, the
                  // second 404s on an already-gone row. Track in-flight
                  // ids so a second click while one's pending is a
                  // no-op instead of a duplicate request.
                  if (deletingIds.has(asset.id)) return;
                  setDeletingIds((prev) => new Set(prev).add(asset.id));
                  try {
                    const deleted = await handleDelete(
                      asset.id.toString(),
                      asset.word,
                    );
                    if (deleted) deleteAsset(asset.id);
                  } finally {
                    setDeletingIds((prev) => {
                      const next = new Set(prev);
                      next.delete(asset.id);
                      return next;
                    });
                  }
                }}
              >
                {deletingIds.has(asset.id) ? "Deleting…" : "Delete"}
              </AppButton>
            )}
          </div>
        ))}
      </div>
      </>
      )}
    </div>
  );
};
export default AdminSigns;
