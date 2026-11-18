import test from "node:test";
import assert from "node:assert/strict";
import { shouldUseOllamaFallback, fallbackTranslate } from "./localTranslator";
test("fallbackTranslate: exact phrase match returns the mapped phrase", () => {
  assert.equal(
    fallbackTranslate("good morning", "English", "Tagalog"),
    "magandang umaga",
  );
});
test("fallbackTranslate: single known word is translated", () => {
  assert.equal(fallbackTranslate("hello", "English", "Bikolano"), "kumusta");
});
test("fallbackTranslate: red resolves to Tagalog and Cebuano", () => {
  assert.equal(fallbackTranslate("red!", "English", "Tagalog"), "pula");
  assert.equal(fallbackTranslate("red", "English", "Cebuano"), "pula");
});
test("fallbackTranslate: unknown word is returned unchanged", () => {
  assert.equal(
    fallbackTranslate("xyznotaword", "English", "Tagalog"),
    "xyznotaword",
  );
});
test("fallbackTranslate: unknown target language returns original text", () => {
  assert.equal(fallbackTranslate("hello", "English", "Klingon"), "hello");
});
test("fallbackTranslate: empty/whitespace input returns the original text", () => {
  assert.equal(fallbackTranslate("   ", "English", "Tagalog"), "   ");
});
test("fallbackTranslate: is case-insensitive and punctuation-tolerant", () => {
  assert.equal(fallbackTranslate("Hello!", "English", "Ilocano"), "kumusta");
});
test("shouldUseOllamaFallback: false when every token is translatable locally", () => {
  assert.equal(shouldUseOllamaFallback("hello", "English", "Tagalog"), false);
});
test("shouldUseOllamaFallback: true when nothing in the phrase can be mapped", () => {
  assert.equal(
    shouldUseOllamaFallback(
      "completely unmapped phrase here",
      "English",
      "Tagalog",
    ),
    true,
  );
});
test("shouldUseOllamaFallback: true for an unsupported target language", () => {
  assert.equal(shouldUseOllamaFallback("hello", "English", "Klingon"), true);
});
test("shouldUseOllamaFallback: false for empty input (nothing to escalate)", () => {
  assert.equal(shouldUseOllamaFallback("", "English", "Tagalog"), false);
});
