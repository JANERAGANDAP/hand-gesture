import type { Prisma } from "@prisma/client";

type GestureDatabase = Prisma.TransactionClient;

export type GestureTranslations = Record<string, string>;

export interface GestureRegistryInput {
  word: string;
  language?: string;
  aliases?: string[];
  translations?: GestureTranslations;
}

export function normalizeGestureKey(word: string): string {
  return word
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseGestureTranslations(value: unknown): GestureTranslations {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(
      ([language, translation]) =>
        language.trim().length > 0 &&
        typeof translation === "string" &&
        translation.trim().length > 0,
    ),
  ) as GestureTranslations;
}

export async function syncGestureRegistry(
  database: GestureDatabase,
  input: GestureRegistryInput,
) {
  const word = input.word.trim();
  const wordKey = normalizeGestureKey(word);
  if (!wordKey) throw new Error("A gesture word is required");

  const existing = await database.gesture.findUnique({ where: { wordKey } });
  const translations = {
    ...parseGestureTranslations(existing?.translations),
    ...parseGestureTranslations(input.translations),
  };
  const aliases = Array.from(
    new Set(
      [
        ...(existing?.aliases ?? []),
        word,
        ...(input.aliases ?? []),
        ...Object.values(translations),
      ]
        .flatMap((alias) => {
          const trimmed = alias.trim();
          const normalized = normalizeGestureKey(trimmed);
          return normalized && normalized !== trimmed
            ? [trimmed, normalized]
            : [trimmed];
        })
        .filter(Boolean),
    ),
  );

  return database.gesture.upsert({
    where: { wordKey },
    create: {
      word,
      wordKey,
      language: input.language?.trim() || "English",
      translations,
      aliases,
    },
    update: {
      translations,
      aliases,
      isActive: true,
    },
  });
}
