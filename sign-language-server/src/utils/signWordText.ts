/**
 * Shared helpers for the raw `word` text stored on a SpeechSign row.
 *
 * Root cause this exists to prevent: the frontend's speech matcher
 * (SpeechGesture.tsx) always normalizes what's SPOKEN into clean,
 * single-space text before comparing it against recorded library words.
 * If the recorded word itself was saved with a double space, a leading/
 * trailing space, a tab, or — most commonly, from copy-pasting a phrase
 * out of Word/Docs/a messaging app — a non-breaking space (U+00A0, which
 * is visually identical to a normal space but a different character),
 * the two strings could never be equal no matter how clearly the phrase
 * was spoken. That caused a whole family of "the video never shows even
 * though the student said it correctly" bugs (e.g. "Nice To Meet You").
 *
 * sanitizeSignWord() is applied once, at the only place a sign's word is
 * ever created (upload.routes.ts), so bad text can't reach the database
 * going forward. hasIrregularWhitespace() lets a health-check endpoint
 * flag any row saved before this existed, without silently rewriting
 * anyone's data.
 */

// Collapses any whitespace variant to a single ASCII space and trims.
// Deliberately does NOT touch punctuation or casing — those are handled
// at match time (see normalizeForMatch in SpeechGesture.tsx) and
// stripping them here would make the stored/displayed text itself less
// readable for teachers browsing the Sign Library.
export function sanitizeSignWord(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

// True if `word` contains any whitespace irregularity sanitizeSignWord
// would change: a non-space whitespace character (tab, newline, a
// non-breaking space, etc. — anything \s matches that isn't a literal
// " "), two or more consecutive spaces, or a leading/trailing space.
export function hasIrregularWhitespace(word: string): boolean {
  return /[^\S ]| {2,}|^ | $/.test(word);
}

// Case-insensitive, whitespace-normalized equality — used to catch
// likely-accidental duplicate sign entries (same phrase, different
// casing/spacing) that would otherwise both look valid in the UI while
// speech recognition can only ever resolve to one of them.
export function isSameSignWord(a: string, b: string): boolean {
  return sanitizeSignWord(a).toLowerCase() === sanitizeSignWord(b).toLowerCase();
}
