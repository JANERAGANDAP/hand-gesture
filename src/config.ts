const configuredApiRoot = import.meta.env.VITE_API_ROOT?.trim() || "";
const isDevelopmentBuild = import.meta.env.MODE === "development";
const configuredApiRootIsLoopback = (() => {
  if (!configuredApiRoot) return false;
  try {
    const hostname = new URL(configuredApiRoot).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
})();

if (!isDevelopmentBuild && configuredApiRootIsLoopback) {
  console.warn(
    "Ignoring VITE_API_ROOT in production because it points to localhost; using the same-origin API instead.",
  );
}

export const API_ROOT =
  configuredApiRoot && (isDevelopmentBuild || !configuredApiRootIsLoopback)
    ? configuredApiRoot
    : isDevelopmentBuild
      ? "http://localhost:3001"
      : "";

export const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || "";
export const GOOGLE_SIGN_IN_CONFIGURED =
  GOOGLE_CLIENT_ID.endsWith(".apps.googleusercontent.com");

export function resolveApiUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;

  const apiRoot = API_ROOT.replace(/\/+$/, "");
  const apiPath = url.startsWith("/") ? url : `/${url}`;
  return `${apiRoot}${apiPath}`;
}
