import { useEffect, useState } from "react";
import AppButton from "../ui/AppButton";
import { API_ROOT } from "../../config";
import { useAuth } from "../../contexts/AuthContext";

interface TeacherInvite {
  id: number;
  email: string;
  invitedBy: string | null;
  usedAt: string | null;
  createdAt: string;
}

// Admin-only panel: this is the ONLY place a person is granted the TEACHER
// role. Anyone can sign up (password or Google) without appearing here —
// they land as STUDENT until their email is added to this list, at which
// point the backend promotes them on their next login/registration (or
// immediately, if they already have an account).
const TeacherInvites = () => {
  const { token } = useAuth();
  const [invites, setInvites] = useState<TeacherInvite[]>([]);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;

  const loadInvites = () => {
    fetch(`${API_ROOT}/api/auth/teacher-invites`, { headers: authHeaders })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setInvites(data.invites);
      })
      .catch(console.error);
  };

  useEffect(() => {
    loadInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAdd = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_ROOT}/api/auth/teacher-invites`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || "Failed to add invite");
        return;
      }
      setEmail("");
      loadInvites();
    } catch (err) {
      console.error(err);
      setError("Failed to add invite");
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (inviteEmail: string) => {
    try {
      const res = await fetch(
        `${API_ROOT}/api/auth/teacher-invites/${encodeURIComponent(inviteEmail)}`,
        { method: "DELETE", headers: authHeaders },
      );
      if (!res.ok) {
        alert("Failed to remove invite");
        return;
      }
      setInvites((prev) => prev.filter((i) => i.email !== inviteEmail));
    } catch (err) {
      console.error(err);
      alert("Failed to remove invite");
    }
  };

  return (
    <div
      className="pearl-card"
      style={{
        padding: "28px",
        marginBottom: "30px",
      }}
    >
      <h5 style={{ marginBottom: "6px", fontWeight: 600 }}>
        Teacher Access
      </h5>
      <p
        style={{
          margin: "0 0 16px",
          fontSize: "13px",
          color: "var(--pearl-text-muted)",
        }}
      >
        Add teacher emails here to allow them to sign up for a teacher account. Teachers can sign up with any email, but they won't be granted the TEACHER role until their email is added here.
      </p>

      <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
        <input
          type="email"
          placeholder="teacher@school.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          className="pearl-input"
          style={{ flex: 1 }}
        />
        <AppButton onPress={handleAdd} disabled={loading || !email.trim()}>
          {loading ? "Adding…" : "Add Teacher"}
        </AppButton>
      </div>

      {error && (
        <p style={{ color: "var(--pearl-danger, #c0392b)", fontSize: "13px" }}>
          {error}
        </p>
      )}

      {invites.length === 0 ? (
        <p style={{ fontSize: "13px", color: "var(--pearl-text-muted)" }}>
          No teacher invites yet.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {invites.map((invite) => (
            <div
              key={invite.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                padding: "10px 12px",
                borderRadius: "8px",
                background: "var(--pearl-surface-muted)",
              }}
            >
              <div>
                <div style={{ fontSize: "14px", fontWeight: 500 }}>
                  {invite.email}
                </div>
                <div
                  style={{ fontSize: "12px", color: "var(--pearl-text-muted)" }}
                >
                  {invite.usedAt ? "Active teacher" : "Invited — not yet signed in"}
                </div>
              </div>
              <AppButton variant="danger" onPress={() => handleRemove(invite.email)}>
                Remove
              </AppButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TeacherInvites;
