import { useState } from "react";
import AdminSignRecorder from "./AdminSignRecorder";
import AppButton from "../ui/AppButton";
import SignLibraryModal from "../Gesture/SignLibraryModal";
import { API_ROOT } from "../../config";
import { authHeaders, invalidateSignLibraryCache } from "../../services/api";
import { useAuth } from "../../contexts/AuthContext";

interface FlaggedWord {
  id: number;
  word: string;
  cleaned: string;
  kind: "asset" | "recorded";
  language?: string;
  count?: number;
}

const AdminSigns = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [healthCheck, setHealthCheck] = useState<{
    loading: boolean;
    flagged: FlaggedWord[] | null;
    error: string | null;
    totalChecked: number;
  }>({ loading: false, flagged: null, error: null, totalChecked: 0 });

  const runHealthCheck = async () => {
    setHealthCheck({
      loading: true,
      flagged: null,
      error: null,
      totalChecked: 0,
    });
    try {
      const [assetResponse, gestureResponse] = await Promise.all([
        fetch(`${API_ROOT}/api/signs/health-check`, {
          headers: authHeaders(),
        }),
        fetch(`${API_ROOT}/api/gestures/health-check`, {
          headers: authHeaders(),
        }),
      ]);
      const [assetData, gestureData] = await Promise.all([
        assetResponse.json(),
        gestureResponse.json(),
      ]);
      if (!assetResponse.ok || !assetData.success) {
        throw new Error(assetData.error || "Sign library health check failed");
      }
      if (!gestureResponse.ok || !gestureData.success) {
        throw new Error(
          gestureData.error || "Recorded gesture health check failed",
        );
      }
      setHealthCheck({
        loading: false,
        flagged: [
          ...assetData.flagged.map((item: Omit<FlaggedWord, "kind">) => ({
            ...item,
            kind: "asset" as const,
          })),
          ...gestureData.flagged.map(
            (item: Omit<FlaggedWord, "kind">) => ({
              ...item,
              kind: "recorded" as const,
            }),
          ),
        ],
        error: null,
        totalChecked: assetData.totalChecked + gestureData.totalChecked,
      });
    } catch (error) {
      setHealthCheck({
        loading: false,
        flagged: null,
        error:
          error instanceof Error ? error.message : "Health check failed",
        totalChecked: 0,
      });
    }
  };

  const [fixingIds, setFixingIds] = useState<Set<string>>(new Set());
  const fixFlaggedWord = async (item: FlaggedWord) => {
    const key = `${item.kind}:${item.id}`;
    setFixingIds((prev) => new Set(prev).add(key));
    try {
      const url =
        item.kind === "asset"
          ? `${API_ROOT}/api/upload/${item.id}/word`
          : `${API_ROOT}/api/gestures/by-word/${encodeURIComponent(item.word)}/word?language=${encodeURIComponent(item.language ?? "")}`;
      const response = await fetch(url, {
        method: "PATCH",
        headers: authHeaders(),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Fix failed");
      }
      setHealthCheck((prev) => ({
        ...prev,
        flagged: prev.flagged
          ? prev.flagged.filter(
              (flagged) =>
                !(flagged.kind === item.kind && flagged.id === item.id),
            )
          : prev.flagged,
      }));
      invalidateSignLibraryCache();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Fix failed");
    } finally {
      setFixingIds((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
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
            Sign Management
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
            onPress={() => setShowLibrary(true)}
          >
            {isAdmin ? "Manage Sign Images & Videos" : "Open Sign Library"}
          </AppButton>
        </div>
      </div>

      {isAdmin && <section
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

      <div
        className="pearl-card"
        style={{ padding: "28px", marginBottom: "30px" }}
      >
        <h5 style={{ marginBottom: "16px", fontWeight: 600 }}>
          Record New Sign
        </h5>
        <AdminSignRecorder />
      </div>

      {isAdmin && (
        <section className="pearl-card" style={{ padding: "18px", marginBottom: "24px" }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div>
              <strong>Sign library health</strong>
              <div style={{ color: "var(--pearl-text-muted)", fontSize: 13 }}>
                Check uploaded signs and recorded gestures for words that may
                not match speech correctly.
              </div>
            </div>
            <AppButton
              variant="outline"
              onPress={() => void runHealthCheck()}
              disabled={healthCheck.loading}
            >
              {healthCheck.loading ? "Checking..." : "Check Library Health"}
            </AppButton>
          </div>
          {healthCheck.error && (
            <p
              role="alert"
              style={{ margin: "12px 0 0", color: "#b42318" }}
            >
              {healthCheck.error}
            </p>
          )}
          {healthCheck.flagged && (
            <div style={{ marginTop: 16 }}>
              {healthCheck.flagged.length === 0 ? (
                <p style={{ margin: 0 }}>
                  All {healthCheck.totalChecked} library entries look clean.
                </p>
              ) : (
                <>
                  <p style={{ margin: "0 0 8px", fontWeight: 600 }}>
                    {healthCheck.flagged.length} sign word(s) have whitespace
                    that may prevent speech matching:
                  </p>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {healthCheck.flagged.map((item) => {
                      const key = `${item.kind}:${item.id}`;
                      return (
                        <li
                          key={key}
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            alignItems: "center",
                            gap: 10,
                            marginBottom: 8,
                          }}
                        >
                          <span>
                            {item.kind === "recorded"
                              ? `Recorded (${item.count ?? 0} takes, ${item.language})`
                              : "Uploaded"}: “{item.word}” → “{item.cleaned}”
                          </span>
                          <AppButton
                            variant="outline"
                            onPress={() => void fixFlaggedWord(item)}
                            disabled={fixingIds.has(key)}
                          >
                            {fixingIds.has(key) ? "Fixing..." : "Fix Now"}
                          </AppButton>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          )}
        </section>
      )}
      {showLibrary && (
        <SignLibraryModal
          onClose={() => setShowLibrary(false)}
          mode="speech"
          canEditMedia={isAdmin}
          canDeleteAssets={isAdmin}
        />
      )}
    </div>
  );
};
export default AdminSigns;
