import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { API_ROOT } from "../config";

export type Role = "ADMIN" | "TEACHER" | "STUDENT";

export interface AuthUser {
  id: number | "admin";
  name: string;
  email: string;
  role: Role;
}

interface AuthResult {
  success: boolean;
  error?: string;
  role?: Role;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthResult>;
  register: (
    name: string,
    email: string,
    password: string,
    role?: Role,
  ) => Promise<AuthResult>;
  loginWithGoogle: (credential: string) => Promise<AuthResult>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Shared with services/api.ts so plain fetch calls can attach the token too.
export const AUTH_STORAGE_KEY = "sla-auth";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setUser(parsed.user ?? null);
        setToken(parsed.token ?? null);

        if (parsed.token) {
          fetch(`${API_ROOT}/api/auth/me`, {
            headers: { Authorization: `Bearer ${parsed.token}` },
          })
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
              if (data?.success && data?.user) {
                setUser(data.user);
                localStorage.setItem(
                  AUTH_STORAGE_KEY,
                  JSON.stringify({ user: data.user, token: parsed.token }),
                );
              }
            })
            .catch(() => {});
        }
      } catch {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    }
    setLoading(false);
  }, []);

  const persist = (nextUser: AuthUser, nextToken: string) => {
    setUser(nextUser);
    setToken(nextToken);
    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({ user: nextUser, token: nextToken }),
    );
  };

  const handleAuthResponse = async (res: Response): Promise<AuthResult> => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      return {
        success: false,
        error: data.error || "Something went wrong",
      };
    }
    persist(data.user, data.token);
    return { success: true, role: data.user.role };
  };

  const login = async (email: string, password: string) => {
    try {
      const res = await fetch(`${API_ROOT}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      return handleAuthResponse(res);
    } catch {
      return { success: false, error: "Couldn't reach the server" };
    }
  };

  const register = async (
    name: string,
    email: string,
    password: string,
    role: Role = "STUDENT",
  ) => {
    try {
      const res = await fetch(`${API_ROOT}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });
      return handleAuthResponse(res);
    } catch {
      return { success: false, error: "Couldn't reach the server" };
    }
  };

  const loginWithGoogle = async (credential: string) => {
    try {
      const res = await fetch(`${API_ROOT}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      return handleAuthResponse(res);
    } catch {
      return { success: false, error: "Couldn't reach the server" };
    }
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  };

  return (
    <AuthContext.Provider
      value={{ user, token, loading, login, register, loginWithGoogle, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
