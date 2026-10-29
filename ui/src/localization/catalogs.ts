import { en } from "./catalogs/en.ts";
import { ja } from "./catalogs/ja.ts";
import { ko } from "./catalogs/ko.ts";
import { zhTW } from "./catalogs/zh-TW.ts";
import type { Catalog } from "./catalogs/en.ts";
import type { Locale } from "../domain/types.ts";

export const catalogs: Readonly<Record<Locale, Catalog>> = Object.freeze({
  en: Object.freeze(en), ko: Object.freeze(ko), ja: Object.freeze(ja), "zh-TW": Object.freeze(zhTW),
});

export type { Catalog, MessageKey } from "./catalogs/en.ts";
