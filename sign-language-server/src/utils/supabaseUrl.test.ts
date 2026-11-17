// sign-language-server/src/utils/supabaseUrl.test.ts
// Purpose: checks the Supabase URL parser the SpeechSign migration relies on.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSupabaseUrl } from "./supabaseUrl";

test("parses bucket and key from a Supabase public URL", () => {
  const url = "https://abc.supabase.co/storage/v1/object/public/hand-crops/1788764828626.mp4";
  assert.deepEqual(parseSupabaseUrl(url), { bucket: "hand-crops", key: "1788764828626.mp4" });
});

test("keeps nested key paths intact", () => {
  const url = "https://abc.supabase.co/storage/v1/object/public/signs/a/b.mp4";
  assert.deepEqual(parseSupabaseUrl(url), { bucket: "signs", key: "a/b.mp4" });
});

test("returns null for non-Supabase or malformed URLs", () => {
  assert.equal(parseSupabaseUrl("https://b.storage.neon.tech/assets/signs/1.mp4"), null);
  assert.equal(parseSupabaseUrl("https://abc.supabase.co/storage/v1/object/public/signs/"), null);
  assert.equal(parseSupabaseUrl("https://abc.supabase.co/storage/v1/object/public/"), null);
});