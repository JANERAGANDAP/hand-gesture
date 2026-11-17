export const API_ROOT =
  import.meta.env.VITE_API_ROOT ||
  (import.meta.env.DEV ? "http://localhost:3001" : "");

export function resolveApiUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;

  const apiRoot = API_ROOT.replace(/\/+$/, "");
  const apiPath = url.startsWith("/") ? url : `/${url}`;
  return `${apiRoot}${apiPath}`;
}
