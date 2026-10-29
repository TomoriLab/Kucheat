import type { LanguagePreference } from "./types.ts";

export const languagePreferences = ["system", "ko", "en", "ja", "zh-TW"] as const;

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return languagePreferences.some((preference) => preference === value);
}

export function normalizeLanguage(value: unknown): LanguagePreference {
  return isLanguagePreference(value) ? value : "system";
}
