import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CodedError } from "../src/domain/errors.ts";
import { languagePreferences } from "../src/domain/language.ts";
import { createChannelPayload, createSettingsPayload, parseChannelInput } from "../src/domain/rules.ts";
import type { SettingsFormValues } from "../src/domain/types.ts";
import { catalogs } from "../src/localization/catalogs.ts";
import type { MessageKey } from "../src/localization/catalogs.ts";
import { Localizer } from "../src/localization/localizer.ts";
import { locales, resolveLocale } from "../src/localization/locale.ts";
import { BridgeUnavailableError, TauriDesktopClient } from "../src/infrastructure/tauri/desktop-client.ts";
import type { NativeResults } from "../src/infrastructure/tauri/contracts.ts";
import { SettingsDraft } from "../src/application/state/settings-draft.ts";
import { dashboard } from "./support/dashboard.ts";

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
}

const values: SettingsFormValues = {
  interval: "60", notifyOffline: true, clientId: "client-id", clientSecret: "", clearClientSecret: false,
};

test("all four catalogs have exactly the same nonempty keys and interpolation placeholders", () => {
  const keys = Object.keys(catalogs.en) as MessageKey[];
  for (const locale of locales) {
    const catalog = catalogs[locale];
    assert.deepEqual(Object.keys(catalog).sort(), [...keys].sort(), locale);
    for (const key of keys) {
      assert.ok(catalog[key].trim(), `${locale}.${key}`);
      assert.deepEqual(placeholders(catalog[key]), placeholders(catalogs.en[key]), `${locale}.${key}`);
      assert.equal(catalog[key].replace(/\{\w+\}/g, "").includes("{"), false, `${locale}.${key}`);
    }
  }
});

test("system locale uses the first supported navigator preference and maps every Chinese variant to Taiwan Traditional Chinese", () => {
  for (const [languages, expected] of [
    [["fr-FR", "ja-JP", "ko-KR"], "ja"],
    [["de-DE", "EN_us.UTF-8"], "en"],
    [["ko_KR.UTF-8@modifier"], "ko"],
    [["ja_JP.eucJP"], "ja"],
    [["zh-CN"], "zh-TW"], [["zh-Hans-SG"], "zh-TW"], [["zh_Hant_HK.UTF-8"], "zh-TW"],
    [["zh"], "zh-TW"], [["zh-TW"], "zh-TW"], [["fr", "de"], "en"],
    [["", "invalid", "korean", "enough"], "en"],
  ] as const) assert.equal(resolveLocale("system", languages), expected);
  assert.equal(resolveLocale("system", [], "ja_JP.UTF-8"), "ja");
  assert.equal(resolveLocale("system", ["ko"], "ja"), "ko");
  assert.equal(resolveLocale(undefined, ["zh-CN"]), "zh-TW");
  assert.equal(resolveLocale("invalid", ["ko"]), "ko");
  assert.equal(resolveLocale("system"), "en");
});

test("explicit choices override navigator preferences and localizer instances remain independent", () => {
  let languages = ["ja-JP"];
  const first = new Localizer("system", () => languages);
  const second = new Localizer("ko");
  assert.equal(first.locale, "ja");
  for (const locale of locales) {
    first.setPreference(locale);
    assert.equal(first.locale, locale);
    assert.equal(first.preference, locale);
  }
  languages = ["zh-CN"];
  assert.equal(first.setPreference("system"), false);
  languages = ["en-US"];
  assert.equal(first.setPreference("system"), true);
  assert.equal(first.locale, "en");
  assert.equal(second.locale, "ko");
});

test("interpolation preserves supplied Unicode, braces, replacement tokens, and markup as literal text", () => {
  for (const locale of locales) {
    const localizer = new Localizer(locale);
    const name = "한글 日本語 繁體中文 <img src=x> $& {name}";
    assert.equal(localizer.t("deleteDescription", { name }), catalogs[locale].deleteDescription.replace("{name}", () => name));
    assert.equal(localizer.t("monitorInterval", { seconds: "60", checked: "12:00" }), catalogs[locale].monitorInterval.replace("{seconds}", "60").replace("{checked}", "12:00"));
    const message = localizer.message("saveSuccess");
    assert.equal(message(), catalogs[locale].saveSuccess);
    localizer.setPreference("en");
    assert.equal(message(), catalogs.en.saveSuccess);
  }
});

test("locale-specific number and date formatting is deterministic with an explicit timezone", () => {
  const value = "2025-05-01T12:30:00Z";
  const results = new Set<string>();
  for (const locale of locales) {
    const localizer = new Localizer(locale);
    assert.equal(localizer.number(12345.6), new Intl.NumberFormat(locale).format(12345.6));
    assert.equal(localizer.timestamp(value, "UTC"), new Intl.DateTimeFormat(locale, {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
    }).format(new Date(value)));
    results.add(localizer.timestamp(value, "UTC"));
    assert.equal(localizer.timestamp(null), catalogs[locale].neverChecked);
    assert.equal(localizer.timestamp("invalid"), catalogs[locale].invalidTime);
    assert.equal(localizer.viewers(1234.9), catalogs[locale].viewers.replace("{count}", localizer.number(1234)));
    for (const count of [undefined, null, -1, NaN, Infinity]) assert.equal(localizer.viewers(count), catalogs[locale].noViewers);
  }
  assert.ok(results.size > 1);
});

test("typed application errors are translated while native diagnostics remain byte-for-byte unchanged", async () => {
  const invalidActions = [
    () => parseChannelInput("bad"),
    () => parseChannelInput(`https://evil.example/${"a".repeat(32)}`),
    () => parseChannelInput("https://chzzk.naver.com/videos"),
    () => createChannelPayload("a".repeat(32), "", [{ id: "a".repeat(32) }]),
    () => createChannelPayload("a".repeat(32), "a".repeat(81)),
    () => createSettingsPayload({ ...values, interval: 1 }),
    () => createSettingsPayload({ ...values, clientSecret: "secret", clearClientSecret: true }),
  ];
  for (const locale of locales) {
    const localizer = new Localizer(locale);
    for (const action of invalidActions) {
      assert.throws(action, (error: unknown) => {
        assert.ok(error instanceof CodedError);
        assert.equal(localizer.error(error), catalogs[locale][error.code]);
        return true;
      });
    }
    assert.equal(localizer.error(new BridgeUnavailableError()), catalogs[locale].bridgeUnavailable);
    assert.equal(localizer.error(new CodedError("invalidDashboard")), catalogs[locale].invalidDashboard);
    const diagnostic = "D-Bus denied: 권한 없음\nAPI 403 日本語";
    assert.equal(localizer.error(diagnostic), diagnostic);
    assert.equal(localizer.error(new Error(diagnostic)), diagnostic);
    assert.equal(localizer.error(undefined), catalogs[locale].unknownError);
    const circular: { self?: unknown } = {};
    circular.self = circular;
    assert.equal(localizer.error(circular), catalogs[locale].unknownError);
  }
  await assert.rejects(new TauriDesktopClient(undefined).getDashboard(), BridgeUnavailableError);
});

test("HTML localization annotations reference static catalog keys and preserve the language select contract", () => {
  const html = readFileSync("ui/index.html", "utf8");
  const localizer = new Localizer("en");
  const annotations = [...html.matchAll(/data-i18n(?:-leading|-aria-label|-placeholder|-title|-alt|-content)?="([^"]+)"/g)];
  assert.ok(annotations.length > 50);
  for (const match of annotations) assert.doesNotThrow(() => localizer.staticKey(match[1]!));
  assert.throws(() => localizer.staticKey("missing"));
  assert.throws(() => localizer.staticKey("deleteDescription"));
  const select = html.match(/<select id="language"[^>]*>([\s\S]*?)<\/select>/)?.[1];
  assert.ok(select);
  assert.deepEqual([...select.matchAll(/value="([^"]+)"/g)].map((match) => match[1]), [...languagePreferences]);
  assert.ok(html.indexOf('id="language"') > html.indexOf('id="settings-form"'));
  assert.ok(html.indexOf('id="language"') < html.indexOf("</form>"));
  assert.match(html, /class="brand-mark" src="\.\/assets\/icons\/kucheat.png" alt="Kucheat"/);
});

test("save_settings includes supplied language without changing command casing or nullable secret semantics", async () => {
  const calls: unknown[][] = [];
  const snapshot = dashboard();
  const results: NativeResults = {
    get_dashboard: snapshot, add_channel: snapshot, remove_channel: snapshot, save_settings: snapshot,
    set_auto_launch: snapshot, refresh_channels: undefined, open_channel: undefined, send_test_notification: undefined,
    search_channels: { channels: [], next_offset: null },
  };
  const client = new TauriDesktopClient(async (command, ...argumentsValue) => {
    calls.push([command, ...argumentsValue]);
    return results[command];
  });
  assert.equal("language" in createSettingsPayload(values).settings, false);
  for (const language of languagePreferences) {
    const input = { ...values, language };
    assert.equal(await client.saveSettings(input), snapshot);
    assert.deepEqual(calls.at(-1), ["save_settings", { settings: {
      check_interval_secs: 60, notify_offline: true, client_id: "client-id",
      client_secret: null, clear_client_secret: false, language,
    } }]);
  }
  assert.equal(createSettingsPayload({ ...values, language: "ja", clientSecret: "new secret" }).settings.client_secret, "new secret");
});

test("language drafts default older dashboards to system, survive polls, and reset to the saved preference", () => {
  const draft = new SettingsDraft();
  const snapshot = dashboard();
  draft.hydrate(snapshot);
  assert.equal(draft.values.language, "system");
  draft.update({ ...draft.values, language: "ja", clientSecret: "pending secret" }, snapshot);
  const saved = { ...snapshot, settings: { ...snapshot.settings, language: "zh-TW" as const } };
  assert.equal(draft.hydrate(saved), false);
  assert.equal(draft.values.language, "ja");
  assert.equal(draft.values.clientSecret, "pending secret");
  assert.equal(draft.hydrate(saved, true, true), true);
  assert.equal(draft.values.language, "zh-TW");
  assert.equal(draft.values.clientSecret, "");
  assert.equal(draft.dirty, false);
  draft.update({ ...draft.values, language: "en" }, saved);
  assert.equal(draft.dirty, true);
});

test("acknowledging a saved language preserves subsequent unrelated edits and replacement secrets", () => {
  const draft = new SettingsDraft();
  const snapshot = dashboard();
  draft.hydrate(snapshot);
  const submitted = { ...draft.values, language: "ja" as const };
  draft.update({ ...submitted, interval: "120", clientId: "pending ID", clientSecret: "pending secret" }, snapshot);
  const saved = { ...snapshot, settings: { ...snapshot.settings, language: "ja" as const } };
  draft.acceptSaved(saved, submitted);
  assert.deepEqual(draft.values, {
    ...submitted, interval: "120", clientId: "pending ID", clientSecret: "pending secret",
  });
  assert.equal(draft.dirty, true);
  assert.equal(draft.hydrate(saved), false);
  const next = draft.values;
  draft.acceptSaved({ ...saved, settings: { ...saved.settings, check_interval_secs: 120 }, api: { ...saved.api, client_id: "pending ID" } }, next);
  assert.equal(draft.dirty, false);
  assert.equal(draft.values.clientSecret, "");
});
