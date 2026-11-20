export const SUPPORTED_LANGUAGES = [
  "English",
  "Cebuano",
  "Tagalog",
  "Ilocano",
  "Bikolano",
] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];
