import { API_ROOT } from "../config";
import { AUTH_STORAGE_KEY } from "../contexts/AuthContext";
import { compressSignImage } from "../utils/compressSignImage";
const API_BASE = `${API_ROOT}/api`;
const SIGN_LIBRARY_CACHE_KEY = "sign-library-cache-v1";
const SIGN_LIBRARY_UPDATED_EVENT = "sign-library-updated";

export function invalidateSignLibraryCache() {
  try {
    localStorage.removeItem(SIGN_LIBRARY_CACHE_KEY);
  } catch (error) {
    console.warn("Could not invalidate cached sign library:", error);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SIGN_LIBRARY_UPDATED_EVENT));
  }
}
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
    translations?: Record<string, string>;
    aliases?: string[];
  },
) {
  const uploadFile = await compressSignImage(file);
  const metadata = {
    word: options.word,
    language: options.language,
    fileName: uploadFile.name,
    type: uploadFile.type.split(";", 1)[0].trim().toLowerCase(),
    size: uploadFile.size,
    publish: options.publish,
    translations: options.translations ?? {},
    aliases: options.aliases ?? [],
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
    formData.append("file", uploadFile);
    formData.append("translations", JSON.stringify(metadata.translations));
    formData.append("aliases", JSON.stringify(metadata.aliases));
    if (options.publish !== undefined) {
      formData.append("publish", String(options.publish));
    }
    const response = await fetch(buildUrl("/upload"), {
      method: "POST",
      headers: authHeaders(),
      body: formData,
    });
    const result = await readResponse(response);
    invalidateSignLibraryCache();
    return result;
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
  const chunkCount = Math.ceil(uploadFile.size / chunkSize);
  try {
    for (let partNumber = 0; partNumber < chunkCount; partNumber += 1) {
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("partNumber", String(partNumber));
      formData.append(
        "file",
        uploadFile.slice(partNumber * chunkSize, (partNumber + 1) * chunkSize),
        uploadFile.name,
      );
      const response = await fetch(buildUrl("/upload/chunk/part"), {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      });
      await readResponse(response);
    }

    const result = await readResponse(
      await postJson("/upload/chunk/complete", {
        ...metadata,
        sessionId,
        chunkCount,
      }),
    );
    invalidateSignLibraryCache();
    return result;
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

export async function replaceSignAssetImage(id: number, file: File) {
  const uploadFile = await compressSignImage(file);
  const formData = new FormData();
  formData.append("file", uploadFile);
  const response = await fetch(buildUrl(`/upload/${id}/image`), {
    method: "PUT",
    headers: authHeaders(),
    body: formData,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) {
    throw new Error(body.error || body.message || `HTTP ${response.status}`);
  }
  invalidateSignLibraryCache();
  return body as {
    success: true;
    id: number;
    word: string;
    file: string;
    type: string;
  };
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
const TRANSLATION_CACHE_KEY = "sign-translation-cache-v2";
const TRANSLATION_CACHE_LIMIT = 100;

function translationCacheKey(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
) {
  return `${sourceLanguage.toLowerCase()}|${targetLanguage.toLowerCase()}|${text.trim().toLowerCase()}`;
}

function readTranslationCache(): Record<string, string> {
  try {
    const stored = localStorage.getItem(TRANSLATION_CACHE_KEY);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

export async function translateText(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
) {
  const cacheKey = translationCacheKey(text, sourceLanguage, targetLanguage);
  const cache = readTranslationCache();
  if (typeof cache[cacheKey] === "string") {
    return { translatedText: cache[cacheKey], provider: "cache" };
  }

  const result = await apiClient.post<{
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
  if (result.translatedText) {
    try {
      const updated = { ...cache, [cacheKey]: result.translatedText };
      const entries = Object.entries(updated);
      localStorage.setItem(
        TRANSLATION_CACHE_KEY,
        JSON.stringify(
          Object.fromEntries(entries.slice(-TRANSLATION_CACHE_LIMIT)),
        ),
      );
    } catch {
      // Translation still works when browser storage is disabled or full.
    }
  }
  return result;
}
