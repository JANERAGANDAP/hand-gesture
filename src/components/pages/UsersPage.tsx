import { useEffect, useMemo, useState } from "react";
import { API_ROOT } from "../../config";
import { useAuth } from "../../contexts/AuthContext";
import TeacherInvites from "./TeacherInvites";
import "./UsersPage.css";

type UserRole = "ADMIN" | "TEACHER" | "STUDENT";

interface DirectoryUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

function isDirectoryUser(value: unknown): value is DirectoryUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user.id === "number" &&
    typeof user.name === "string" &&
    typeof user.email === "string" &&
    (user.role === "ADMIN" || user.role === "TEACHER" || user.role === "STUDENT") &&
    typeof user.createdAt === "string"
  );
}

const UsersPage = () => {
  const { token } = useAuth();
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

    fetch(`${API_ROOT}/api/auth/users`, { headers })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok || !body || typeof body !== "object") {
          throw new Error("Could not load users.");
        }
        const result = body as { success?: unknown; error?: unknown; users?: unknown };
        if (result.success !== true || !Array.isArray(result.users)) {
          throw new Error(
            typeof result.error === "string" ? result.error : "Could not load users.",
          );
        }
        const records = result.users.filter(isDirectoryUser);
        if (records.length !== result.users.length) {
          throw new Error("The server returned an invalid user list.");
        }
        return records;
      })
      .then((records) => {
        if (cancelled) return;
        setUsers(records);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        console.error("Could not load users:", loadError);
        setError(
          loadError instanceof Error ? loadError.message : "Could not load users.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshVersion, token]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return users;
    return users.filter(
      (user) =>
        user.name.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query) ||
        user.role.toLowerCase().includes(query),
    );
  }, [search, users]);

  return (
    <div className="pearl-page users-page">
      <header className="users-page__header">
        <div>
          <p className="users-page__eyebrow">ADMINISTRATION</p>
          <h1>Users</h1>
          <p>View registered accounts and manage teacher access.</p>
        </div>
        <button
          type="button"
          className="users-page__refresh"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setRefreshVersion((version) => version + 1);
          }}
        >
          {loading ? "Loading…" : "Refresh users"}
        </button>
      </header>

      <section className="pearl-card users-page__directory" aria-labelledby="users-directory-title">
        <div className="users-page__section-header">
          <div>
            <h2 id="users-directory-title">Registered accounts</h2>
            <p>
              {loading
                ? "Loading accounts…"
                : `${filteredUsers.length} of ${users.length} user${users.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <input
            type="search"
            className="pearl-input users-page__search"
            aria-label="Search users"
            placeholder="Search name, email, or role"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        {error ? (
          <p className="users-page__message users-page__message--error" role="alert">
            {error}
          </p>
        ) : loading ? (
          <p className="users-page__message" role="status">Loading users…</p>
        ) : filteredUsers.length === 0 ? (
          <p className="users-page__message">
            {users.length === 0 ? "No registered users yet." : "No users match that search."}
          </p>
        ) : (
          <div className="users-page__table-wrap">
            <table className="users-page__table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Joined</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id}>
                    <td data-label="Name">{user.name}</td>
                    <td data-label="Email">{user.email}</td>
                    <td data-label="Role">
                      <span className={`users-page__role users-page__role--${user.role.toLowerCase()}`}>
                        {user.role}
                      </span>
                    </td>
                    <td data-label="Joined">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="users-page__teacher-access" aria-labelledby="teacher-access-title">
        <div className="users-page__teacher-heading">
          <p className="users-page__eyebrow">ACCESS CONTROL</p>
          <h2 id="teacher-access-title">Teacher access</h2>
          <p>Invite teachers by email. Invited users receive the Teacher role when they sign in.</p>
        </div>
        <TeacherInvites />
      </section>
    </div>
  );
};

export default UsersPage;
