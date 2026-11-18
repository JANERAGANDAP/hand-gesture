import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSpeechText,
  resolveRegisteredTranslation,
  signLookupScore,
} from "./signLookup";

test("normalizeSpeechText removes punctuation, diacritics, and extra whitespace", () => {
  assert.equal(normalizeSpeechText("  PÚLA,  ngayon! "), "pula ngayon");
});

test("signLookupScore matches translations and aliases exactly", () => {
  assert.equal(signLookupScore("Pula!", ["red", "pula", "pula ngayon"]), 0);
});

test("signLookupScore uses only a one-character correction for single words", () => {
  assert.equal(signLookupScore("helo", ["hello"]), 1);
  assert.equal(signLookupScore("helo there", ["hello there"]), null);
});

test("registered translations resolve aliases to the selected target language", () => {
  assert.equal(
    resolveRegisteredTranslation(
      {
        word: "red",
        language: "English",
        translations: { Tagalog: "pula", Cebuano: "pula" },
      },
      "English",
    ),
    "red",
  );
  assert.equal(
    resolveRegisteredTranslation(
      {
        word: "red",
        language: "English",
        translations: { Tagalog: "pula" },
      },
      "Tagalog",
    ),
    "pula",
  );
});
