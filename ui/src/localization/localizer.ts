import { CodedError } from "../domain/errors.ts";
import { normalizeLanguage } from "../domain/language.ts";
import type { LanguagePreference, Locale } from "../domain/types.ts";
import { catalogs } from "./catalogs.ts";
import type { MessageKey } from "./catalogs.ts";
import type { en } from "./catalogs/en.ts";
import { resolveLocale } from "./locale.ts";

type Placeholders<Text extends string> = Text extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest> : never;
export type MessageParameters<Key extends MessageKey> = Record<Placeholders<(typeof en)[Key]>, string | number>;
export type StaticMessageKey = { [Key in MessageKey]: Placeholders<(typeof en)[Key]> extends never ? Key : never }[MessageKey];
export type LocalizedText = string | (() => string);

export function resolveText(value: LocalizedText): string { return typeof value === "function" ? value() : value; }

export class Localizer {
  readonly #languages: () => readonly string[];
  readonly #language: () => string;
  #preference: LanguagePreference;
  #locale: Locale;

  constructor(preference: LanguagePreference = "system", languages: () => readonly string[] = () => [], language: () => string = () => "") {
    this.#languages = languages;
    this.#language = language;
    this.#preference = preference;
    this.#locale = resolveLocale(preference, languages(), language());
  }

  get locale(): Locale { return this.#locale; }
  get preference(): LanguagePreference { return this.#preference; }

  setPreference(preference: unknown): boolean {
    this.#preference = normalizeLanguage(preference);
    const locale = resolveLocale(this.#preference, this.#languages(), this.#language());
    const changed = locale !== this.#locale;
    this.#locale = locale;
    return changed;
  }

  t<Key extends MessageKey>(key: Key, ...argumentsValue: Placeholders<(typeof en)[Key]> extends never
    ? [] : [parameters: MessageParameters<Key>]): string {
    return this.interpolate(key, argumentsValue[0]);
  }

  text(key: StaticMessageKey): string { return catalogs[this.#locale][key]; }
  message(key: StaticMessageKey): () => string { return () => this.text(key); }

  staticKey(value: string): StaticMessageKey {
    if (!Object.hasOwn(catalogs.en, value) || /\{\w+\}/.test(catalogs.en[value as MessageKey])) {
      throw new Error(`Invalid static localization key: ${value}`);
    }
    return value as StaticMessageKey;
  }

  number(value: number): string { return new Intl.NumberFormat(this.#locale).format(value); }

  timestamp(value: string | null | undefined, timeZone?: string): string {
    if (!value) return this.t("neverChecked");
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return this.t("invalidTime");
    return new Intl.DateTimeFormat(this.#locale, {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
      ...(timeZone ? { timeZone } : {}),
    }).format(date);
  }

  viewers(value: number | null | undefined): string {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? this.t("viewers", { count: this.number(Math.floor(value)) }) : this.t("noViewers");
  }

  error(error: unknown): string {
    if (error instanceof CodedError) return this.text(error.code);
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    try { return JSON.stringify(error) || this.t("unknownError"); }
    catch { return this.t("unknownError"); }
  }

  private interpolate(key: MessageKey, parameters: Readonly<Record<string, string | number>> = {}): string {
    return catalogs[this.#locale][key].replace(/\{(\w+)\}/g, (_match: string, name: string) => {
      const value = parameters[name];
      if (value === undefined) throw new Error(`Missing localization parameter: ${key}.${name}`);
      return String(value);
    });
  }
}
