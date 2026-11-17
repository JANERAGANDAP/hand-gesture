import { API_ROOT } from "../config";
import { AUTH_STORAGE_KEY } from "../contexts/AuthContext";
const API_BASE = `${API_ROOT}/api`;
export function buildUrl(endpoint: string): string {
  return endpoint.startsWith("/")
    ? `${API_BASE}${endpoint}`
    : `${API_BASE}/${endpoint}`;
}
export function authHeaders(): Record<string, string> {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return {};
    const { token } = JSON.parse(raw);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}
async function handle(response: Response) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error: any = new Error(
      body.error || body.message || `HTTP ${response.status}`,
    );
    error.status = response.status;
    if (response.status === 429) {
      error.retryAfterSeconds =
        body.retryAfterSeconds ??
        Number(response.headers.get("Retry-After")) ??
        10;
    }
    throw error;
  }
  return response.json();
}
export const apiClient = {
  async get<T>(
    endpoint: string,
    options: {
      timeout?: number;
    } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = options.timeout
      ? setTimeout(() => controller.abort(), options.timeout)
      : null;
    try {
      const response = await fetch(buildUrl(endpoint), {
        signal: controller.signal,
        headers: authHeaders(),
      });
      return await handle(response);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  },
  async post<T>(
    endpoint: string,
    body: any,
    options: {
      timeout?: number;
    } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = options.timeout
      ? setTimeout(() => controller.abort(), options.timeout)
      : null;
    try {
      const response = await fetch(buildUrl(endpoint), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return await handle(response);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  },
  async put<T>(
    endpoint: string,
    body: any,
    options: {
      timeout?: number;
    } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = options.timeout
      ? setTimeout(() => controller.abort(), options.timeout)
      : null;
    try {
      const response = await fetch(buildUrl(endpoint), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return await handle(response);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  },
  async delete<T>(
    endpoint: string,
    options: {
      timeout?: number;
    } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = options.timeout
      ? setTimeout(() => controller.abort(), options.timeout)
      : null;
    try {
      const response = await fetch(buildUrl(endpoint), {
        method: "DELETE",
        signal: controller.signal,
        headers: authHeaders(),
      });
      return await handle(response);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  },
};
export async function translateText(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
) {
  return apiClient.post<{
    translatedText: string;
    provider: string;
  }>(
    "/translate",
    {
      text,
      sourceLanguage,
      targetLanguage,
    },
    {
      timeout: 10000,
    },
  );
}
