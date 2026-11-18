export function normalizeSpeechText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isOneEditAway(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
    } else {
      edits += 1;
      if (edits > 1) return false;
      if (left.length > right.length) leftIndex += 1;
      else if (right.length > left.length) rightIndex += 1;
      else {
        leftIndex += 1;
        rightIndex += 1;
      }
    }
  }
  return edits + Number(leftIndex < left.length || rightIndex < right.length) <= 1;
}

export function signLookupScore(query: string, candidates: string[]): number | null {
  const normalizedQuery = normalizeSpeechText(query);
  if (!normalizedQuery) return null;
  const normalizedCandidates = candidates
    .map(normalizeSpeechText)
    .filter(Boolean);
  if (normalizedCandidates.includes(normalizedQuery)) return 0;

  const queryTokens = normalizedQuery.split(" ");
  if (queryTokens.length !== 1 || normalizedQuery.length < 4) return null;
  return normalizedCandidates.some(
    (candidate) =>
      candidate.length >= 4 &&
      candidate.split(" ").length === 1 &&
      isOneEditAway(normalizedQuery, candidate),
  )
    ? 1
    : null;
}

export function resolveRegisteredTranslation(
  gesture: {
    word: string;
    language: string;
    translations: unknown;
  },
  targetLanguage: string,
): string | null {
  const translations = gesture.translations;
  if (translations && typeof translations === "object" && !Array.isArray(translations)) {
    const translated = Object.entries(translations).find(
      ([language, value]) =>
        language.toLowerCase() === targetLanguage.toLowerCase() &&
        typeof value === "string" &&
        value.trim(),
    )?.[1];
    if (typeof translated === "string") return translated;
  }

  return gesture.language.toLowerCase() === targetLanguage.toLowerCase()
    ? gesture.word
    : null;
}
