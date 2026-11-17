// sign-language-server/src/utils/supabaseUrl.ts
// Purpose: parse legacy Supabase public storage URLs during the move to Neon.
const SUPABASE_PUBLIC_PATH = "/storage/v1/object/public/";

// Splits a Supabase public URL into { bucket, key }, or null when the URL
// isn't a Supabase storage URL (e.g. already migrated). Pure function.
export function parseSupabaseUrl(url: string): { bucket: string; key: string } | null {
  const idx = url.indexOf(SUPABASE_PUBLIC_PATH);
  if (idx === -1) return null;
  const rest = url.slice(idx + SUPABASE_PUBLIC_PATH.length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) };
}