import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeGestureKey,
  parseGestureTranslations,
} from "./gestureRegistry";

test("normalizeGestureKey normalizes case, punctuation, and whitespace", () => {
  assert.equal(normalizeGestureKey("  Nice,  To Meet You! "), "nice to meet you");
});

test("parseGestureTranslations accepts only language-to-text objects", () => {
  assert.deepEqual(parseGestureTranslations({ Tagalog: "pula", ignored: "" }), {
    Tagalog: "pula",
  });
  assert.deepEqual(parseGestureTranslations(["pula"]), {});
});
