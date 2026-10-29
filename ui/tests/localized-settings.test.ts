import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationController } from "../src/application/application-controller.ts";
import { DashboardState } from "../src/application/state/dashboard-state.ts";
import { SettingsDraft } from "../src/application/state/settings-draft.ts";
import type { Dashboard, SettingsFormValues } from "../src/domain/types.ts";
import { CodedError } from "../src/domain/errors.ts";
import { Localizer } from "../src/localization/localizer.ts";
import { locales } from "../src/localization/locale.ts";
import { catalogs } from "../src/localization/catalogs.ts";
import { SettingsController } from "../src/presentation/controllers/settings-controller.ts";
import { SettingsView } from "../src/presentation/views/settings-view.ts";
import { FeedbackView } from "../src/presentation/views/feedback-view.ts";
import { LocalizedDocument } from "../src/presentation/dom/localized-document.ts";
import { Deferred, FakeDesktopClient, ManualScheduler, RecordingFeedback, RecordingView, flushPromises } from "./support/application-fakes.ts";
import { SettingsDocument } from "./support/settings-dom.ts";
import { dashboard } from "./support/dashboard.ts";

class SavingDesktopClient extends FakeDesktopClient {
  readonly saved: SettingsFormValues[] = [];
  readonly saves: Deferred<Dashboard>[] = [];

  override saveSettings(values?: SettingsFormValues): Promise<Dashboard> {
    if (!values) throw new Error("Settings values are required.");
    this.saved.push(values);
    const result = new Deferred<Dashboard>();
    this.saves.push(result);
    return result.promise;
  }
}

function fixture() {
  const document = new SettingsDocument();
  const localizer = new Localizer("system", () => ["en-US"]);
  const client = new SavingDesktopClient();
  const state = new DashboardState();
  const draft = new SettingsDraft();
  const settings = new SettingsView(document.asDocument(), localizer);
  const feedback = new RecordingFeedback();
  const scheduler = new ManualScheduler();
  const view = new RecordingView();
  const application = new ApplicationController(client, state, view, feedback, scheduler,
    (actions) => [new SettingsController(settings, draft, state, client, actions, feedback, localizer)], localizer);
  return { document, localizer, client, state, draft, settings, feedback, application };
}

test("saving each language applies the authoritative locale immediately and announces success in that locale", async () => {
  const { application, client, localizer, document, feedback, draft } = fixture();
  application.start();
  client.requests[0]?.resolve(dashboard());
  await flushPromises();
  for (const [index, language] of locales.entries()) {
    document.node("language").value = language;
    document.node("settings-form").dispatchEvent(new Event("change"));
    assert.equal(draft.dirty, true);
    const previousLocale = localizer.locale;
    document.node("settings-form").dispatchEvent(new Event("submit", { cancelable: true }));
    assert.equal(client.saved[index]?.language, language);
    assert.equal(localizer.locale, previousLocale);
    const snapshot = dashboard();
    snapshot.settings.language = language;
    client.saves[index]?.resolve(snapshot);
    await flushPromises();
    assert.equal(localizer.locale, language);
    assert.equal(document.node("save-settings").textContent, catalogs[language].save);
    assert.equal(feedback.messages.at(-1), catalogs[language].saveSuccess);
    assert.equal(draft.dirty, false);
  }
  application.dispose();
});

test("poll-driven language updates and focused forms preserve unsaved values and secrets", async () => {
  const { application, client, localizer, document, draft } = fixture();
  application.start();
  client.requests[0]?.resolve(dashboard());
  await flushPromises();
  document.node("language").value = "ja";
  document.node("client-secret").value = "unsaved secret";
  document.node("check-interval").value = "120";
  document.node("settings-form").dispatchEvent(new Event("input"));
  const pending = application.poll();
  const snapshot = dashboard();
  snapshot.settings.language = "zh-TW";
  client.requests[1]?.resolve(snapshot);
  await pending;
  assert.equal(localizer.locale, "zh-TW");
  assert.equal(document.node("language").value, "ja");
  assert.equal(document.node("client-secret").value, "unsaved secret");
  assert.equal(document.node("check-interval").value, "120");
  assert.equal(draft.dirty, true);
  document.node("reset-settings").dispatchEvent(new Event("click"));
  assert.equal(document.node("language").value, "zh-TW");
  assert.equal(document.node("client-secret").value, "");
  assert.equal(draft.dirty, false);
  document.activeElement = document.node("language");
  document.node("settings-form").contained = document.activeElement;
  const next = application.poll();
  snapshot.settings.language = "ko";
  client.requests[2]?.resolve(snapshot);
  await next;
  assert.equal(document.node("language").value, "zh-TW");
  assert.equal(localizer.locale, "ko");
  application.dispose();
});

test("saving language does not erase edits made during the request and failed saves retain the previous locale", async () => {
  const { application, client, localizer, document, draft, feedback } = fixture();
  application.start();
  client.requests[0]?.resolve(dashboard());
  await flushPromises();
  document.node("language").value = "ja";
  document.node("settings-form").dispatchEvent(new Event("change"));
  document.node("settings-form").dispatchEvent(new Event("submit"));
  document.node("client-secret").value = "new unsaved secret";
  document.node("check-interval").value = "180";
  const snapshot = dashboard();
  snapshot.settings.language = "ja";
  client.saves[0]?.resolve(snapshot);
  await flushPromises();
  assert.equal(localizer.locale, "ja");
  assert.equal(document.node("client-secret").value, "new unsaved secret");
  assert.equal(document.node("check-interval").value, "180");
  assert.equal(draft.dirty, true);
  document.node("language").value = "ko";
  document.node("settings-form").dispatchEvent(new Event("change"));
  document.node("settings-form").dispatchEvent(new Event("submit"));
  client.saves[1]?.reject(new Error("OS error: 権限なし"));
  await flushPromises();
  assert.equal(localizer.locale, "ja");
  assert.equal(document.node("language").value, "ko");
  assert.equal(document.node("client-secret").value, "new unsaved secret");
  assert.equal(feedback.errors.at(-1)?.context, catalogs.ja.saveFailure);
  application.dispose();
});

test("localized document updates text and accessible attributes without replacing counters, controls, or their values", () => {
  const document = new SettingsDocument();
  const localizer = new Localizer("en");
  const heading = document.add("heading", "h1");
  heading.dataset.i18n = "settings";
  const filter = document.add("filter", "button");
  filter.dataset.i18nLeading = "all";
  const text = { nodeType: 3, textContent: "All " };
  const counter = { nodeType: 1, textContent: "12" };
  filter.childNodes.push(text, counter);
  const search = document.add("search", "input");
  search.value = "User input 日本語";
  search.setAttribute("data-i18n-placeholder", "searchPlaceholder");
  search.setAttribute("data-i18n-aria-label", "searchLabel");
  document.select("[data-i18n]", [heading]);
  document.select("[data-i18n-leading]", [filter]);
  document.select("[data-i18n-placeholder]", [search]);
  document.select("[data-i18n-aria-label]", [search]);
  const view = new LocalizedDocument(document.asDocument(), localizer);
  for (const locale of locales) {
    localizer.setPreference(locale);
    view.render();
    assert.equal(document.documentElement.lang, locale);
    assert.equal(heading.textContent, catalogs[locale].settings);
    assert.equal(text.textContent.trim(), catalogs[locale].all);
    assert.equal(filter.childNodes[1], counter);
    assert.equal(counter.textContent, "12");
    assert.equal(search.value, "User input 日本語");
    assert.equal(search.getAttribute("placeholder"), catalogs[locale].searchPlaceholder);
    assert.equal(search.getAttribute("aria-label"), catalogs[locale].searchLabel);
  }
});

test("visible toasts and errors retranslate without changing native diagnostic content or reviving dismissed panels", () => {
  const document = new SettingsDocument();
  const localizer = new Localizer("en");
  const view = new FeedbackView(document.asDocument(), localizer);
  const diagnostic = "Native error: 권한 없음 日本語";
  view.showActionError(localizer.message("saveFailure"), diagnostic);
  view.displayError("settings-error", localizer.message("settingsValidation"), new CodedError("invalidInterval"));
  for (const locale of locales) {
    localizer.setPreference(locale);
    view.render();
    assert.equal(document.node("action-error-title").textContent, catalogs[locale].saveFailure);
    assert.equal(document.node("action-error-detail").textContent, diagnostic);
    assert.equal(document.node("settings-error").textContent, `${catalogs[locale].settingsValidation}\n${catalogs[locale].invalidInterval}`);
  }
  view.hideActionError();
  view.showToast(localizer.message("saveSuccess"));
  localizer.setPreference("en");
  view.render();
  assert.equal(document.node("toast-message").textContent, catalogs.en.saveSuccess);
  assert.equal(document.node("action-error-panel").hidden, true);
  view.hideToast();
  view.clearError("settings-error");
  localizer.setPreference("ja");
  view.render();
  assert.equal(document.node("toast").hidden, true);
  assert.equal(document.node("settings-error").hidden, true);
});
