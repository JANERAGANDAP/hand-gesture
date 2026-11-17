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

export async function uploadSignAsset(
  file: File,
  options: {
    word: string;
    language: string;
    publish?: boolean;
  },
) {
  const metadata = {
    word: options.word,
    language: options.language,
    fileName: file.name,
    type: file.type.split(";", 1)[0].trim().toLowerCase(),
    size: file.size,
    publish: options.publish,
  };
  const postJson = (endpoint: string, body: unknown) =>
    fetch(buildUrl(endpoint), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify(body),
    });
  const readResponse = async (response: Response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || body.message || `HTTP ${response.status}`);
    }
    return body;
  };
  const uploadDirectly = async () => {
    const formData = new FormData();
    formData.append("word", options.word);
    formData.append("language", options.language);
    formData.append("file", file);
    if (options.publish !== undefined) {
      formData.append("publish", String(options.publish));
    }
    const response = await fetch(buildUrl("/upload"), {
      method: "POST",
      headers: authHeaders(),
      body: formData,
    });
    return readResponse(response);
  };

  const startResponse = await postJson("/upload/chunk/start", metadata);
  if (startResponse.status === 501) return uploadDirectly();
  const started = await readResponse(startResponse);
  if (
    typeof started.sessionId !== "string" ||
    !Number.isInteger(started.chunkSize) ||
    started.chunkSize <= 0
  ) {
    throw new Error("The server returned an invalid upload session");
  }

  const sessionId: string = started.sessionId;
  const chunkSize: number = started.chunkSize;
  const chunkCount = Math.ceil(file.size / chunkSize);
  try {
    for (let partNumber = 0; partNumber < chunkCount; partNumber += 1) {
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("partNumber", String(partNumber));
      formData.append(
        "file",
        file.slice(partNumber * chunkSize, (partNumber + 1) * chunkSize),
        file.name,
      );
      const response = await fetch(buildUrl("/upload/chunk/part"), {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      });
      await readResponse(response);
    }

    return await readResponse(
      await postJson("/upload/chunk/complete", {
        ...metadata,
        sessionId,
        chunkCount,
      }),
    );
  } catch (error) {
    try {
      const abortResponse = await postJson("/upload/chunk/abort", {
        sessionId,
        chunkCount,
      });
      if (!abortResponse.ok) {
        console.error("Could not clean up an incomplete sign upload.");
      }
    } catch (cleanupError) {
      console.error("Could not clean up an incomplete sign upload:", cleanupError);
    }
    throw error;
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
