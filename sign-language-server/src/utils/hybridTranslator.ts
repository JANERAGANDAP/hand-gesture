import { fallbackTranslate, shouldUseOllamaFallback } from "./localTranslator";
import { translations } from "../translations/translations";
import { callGroq } from "./groqClient";
export interface HybridTranslationResult {
  translatedText: string;
  provider: "local" | "groq" | "original";
}
const SUSPICIOUS_RESPONSE_MARKERS = [
  "here is the translation",
  "here's the translation",
  "translation:",
  "i cannot",
  "i can't",
  "as an ai",
  "sure,",
];
function looksMalformed(candidate: string, originalText: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed) return true;
  if (trimmed.length > originalText.length * 3 + 20) return true;
  const lower = trimmed.toLowerCase();
  return SUSPICIOUS_RESPONSE_MARKERS.some((marker) => lower.includes(marker));
}
async function callGroqTranslator(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<string | null> {
  return callGroq([
    {
      role: "system",
      content: `Translate the following text from ${sourceLanguage || "English"} to ${targetLanguage || "Tagalog"}. Return ONLY the translated text, nothing else - no explanation, no quotes, no preamble.`,
    },
    {
      role: "user",
      content: text,
    },
  ]);
}
export async function translateWithHybridFallback(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<HybridTranslationResult> {
  text = text.trim();
  if (!text) {
    return {
      translatedText: "",
      provider: "original",
    };
  }
  if (
    sourceLanguage === targetLanguage ||
    /^[a-z]$/i.test(text) ||
    /^\d+$/.test(text)
  ) {
    return {
      translatedText: text,
      provider: "original",
    };
  }
  const words = text.split(/\s+/);
  if (words.length === 1) {
    const key = words[0].toLowerCase();
    const dictionary =
      translations[targetLanguage as keyof typeof translations];
    if (dictionary?.[key]) {
      return {
        translatedText: dictionary[key],
        provider: "local",
      };
    }
  }
  const localTranslation = fallbackTranslate(
    text,
    sourceLanguage,
    targetLanguage,
  );
  if (
    localTranslation &&
    localTranslation !== text &&
    !shouldUseOllamaFallback(text, sourceLanguage, targetLanguage)
  ) {
    return {
      translatedText: localTranslation,
      provider: "local",
    };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await callGroqTranslator(
        text,
        sourceLanguage,
        targetLanguage,
      );
      if (result && !looksMalformed(result, text)) {
        return {
          translatedText: result,
          provider: "groq",
        };
      }
      console.warn(
        `Groq translation attempt ${attempt + 1} looked malformed, ${attempt === 0 ? "retrying" : "giving up"}`,
      );
    } catch (error) {
      console.warn(`Groq translation attempt ${attempt + 1} failed:`, error);
      break;
    }
  }
  return {
    translatedText: localTranslation || text,
    provider: localTranslation !== text ? "local" : "original",
  };
}
export function normalizeForCacheKey(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:()'"-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
