import test from "node:test";
import assert from "node:assert/strict";
import { translateWithHybridFallback } from "./hybridTranslator";

test("translateWithHybridFallback translates red immediately to Tagalog", async () => {
  const result = await translateWithHybridFallback("red", "English", "Tagalog");
  assert.equal(result.translatedText, "pula");
  assert.equal(result.provider, "local");
});
