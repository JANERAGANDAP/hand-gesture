import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeSignWord,
  hasIrregularWhitespace,
  isSameSignWord,
} from "./signWordText";

test("sanitizeSignWord: collapses a double space", () => {
  assert.equal(sanitizeSignWord("Nice To  Meet You"), "Nice To Meet You");
});

test("sanitizeSignWord: collapses a non-breaking space", () => {
  assert.equal(sanitizeSignWord("Nice To\u00A0Meet You"), "Nice To Meet You");
});

test("sanitizeSignWord: collapses a tab", () => {
  assert.equal(sanitizeSignWord("Nice\tTo Meet You"), "Nice To Meet You");
});

test("sanitizeSignWord: trims leading/trailing whitespace", () => {
  assert.equal(sanitizeSignWord("  Good Morning  "), "Good Morning");
});

test("sanitizeSignWord: leaves already-clean text unchanged", () => {
  assert.equal(sanitizeSignWord("Good Morning"), "Good Morning");
});

test("sanitizeSignWord: does not touch punctuation or casing", () => {
  assert.equal(sanitizeSignWord("Nice to Meet You!"), "Nice to Meet You!");
});

test("hasIrregularWhitespace: flags a double space", () => {
  assert.equal(hasIrregularWhitespace("Nice To  Meet You"), true);
});

test("hasIrregularWhitespace: flags a non-breaking space", () => {
  assert.equal(hasIrregularWhitespace("Nice To\u00A0Meet You"), true);
});

test("hasIrregularWhitespace: flags leading whitespace", () => {
  assert.equal(hasIrregularWhitespace(" Good Morning"), true);
});

test("hasIrregularWhitespace: false for clean text", () => {
  assert.equal(hasIrregularWhitespace("Good Morning"), false);
});

test("isSameSignWord: true for different casing", () => {
  assert.equal(isSameSignWord("Good Morning", "good morning"), true);
});

test("isSameSignWord: true for different whitespace", () => {
  assert.equal(isSameSignWord("Nice To  Meet You", "Nice To Meet You"), true);
});

test("isSameSignWord: false for genuinely different words", () => {
  assert.equal(isSameSignWord("Good Morning", "Good Afternoon"), false);
});
