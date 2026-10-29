import { normalizeLanguage } from "../domain/language.ts";
import type { Locale } from "../domain/types.ts";

export const locales = ["ko", "en", "ja", "zh-TW"] as const;

export function resolveLocale(preference: unknown, languages: readonly string[] = [], language = ""): Locale {
  const selected = normalizeLanguage(preference);
  if (selected !== "system") return selected;
  for (const candidate of [...languages, language]) {
    const primary = candidate.trim().replaceAll("_", "-").split(/[.@-]/)[0]?.toLowerCase();
    if (primary === "ko" || primary === "en" || primary === "ja") return primary;
    if (primary === "zh") return "zh-TW";
  }
  return "en";
}
