import { normalizeLanguage } from "../../domain/language.ts";
import type { Localizer } from "../../localization/localizer.ts";
import type { DashboardState } from "../../application/state/dashboard-state.ts";
import type { SettingsFormValues } from "../../domain/types.ts";
import { element, setText } from "../dom/elements.ts";

export class SettingsView {
  readonly controls;
  readonly #document: Document;
  readonly #status;
  readonly #localizer: Localizer;

  constructor(document: Document, localizer: Localizer) {
    this.#localizer = localizer;
    this.#document = document;
    this.controls = {
      form: element(document, "settings-form", "form"),
      language: element(document, "language", "select"),
      interval: element(document, "check-interval", "input"),
      notifyOffline: element(document, "notify-offline", "input"),
      clientId: element(document, "client-id", "input"),
      clientSecret: element(document, "client-secret", "input"),
      clearSecret: element(document, "clear-client-secret", "input"),
      autoLaunch: element(document, "auto-launch", "input"),
      save: element(document, "save-settings", "button"),
      reset: element(document, "reset-settings", "button"),
      test: element(document, "test-notification", "button"),
    };
    this.#status = {
      secret: element(document, "secret-status", "span"),
      autoLaunchError: element(document, "auto-launch-error", "div"),
      appVersion: element(document, "app-version", "span"),
      version: element(document, "settings-version", "span"),
      session: element(document, "session-type", "span"),
      edit: element(document, "settings-edit-status", "p"),
      testLabel: element(document, "test-button-label", "span"),
      error: element(document, "settings-error", "div"),
    };
  }

  get editing(): boolean { return this.controls.form.contains(this.#document.activeElement); }

  readValues(): SettingsFormValues {
    const controls = this.controls;
    return {
      interval: controls.interval.value, notifyOffline: controls.notifyOffline.checked,
      clientId: controls.clientId.value, clientSecret: controls.clientSecret.value,
      clearClientSecret: controls.clearSecret.checked,
      language: normalizeLanguage(controls.language.value),
    };
  }

  writeValues(values: SettingsFormValues): void {
    this.controls.interval.value = String(values.interval);
    this.controls.notifyOffline.checked = values.notifyOffline;
    this.controls.clientId.value = values.clientId;
    this.controls.clientSecret.value = values.clientSecret || "";
    this.controls.clearSecret.checked = values.clearClientSecret;
    this.controls.language.value = normalizeLanguage(values.language);
  }

  clearValidation(): void {
    this.#status.error.hidden = true;
    this.controls.interval.removeAttribute("aria-invalid");
  }

  markInvalid(): void {
    this.controls.interval.setAttribute("aria-invalid", "true");
    this.controls.interval.focus();
  }

  clearSecretInput(): void { this.controls.clientSecret.value = ""; }
  focusInterval(): void { this.controls.interval.focus(); }

  renderControls(state: DashboardState, ready: boolean, dirty: boolean): void {
    const localizer = this.#localizer;
    const { dashboard, operation } = state;
    const blocked = !ready || Boolean(operation);
    const controls = this.controls;
    controls.save.disabled = blocked || !dirty;
    controls.reset.disabled = blocked || !dirty;
    setText(controls.save, localizer.t(operation === "save" ? "saving" : "save"));
    setText(this.#status.testLabel, localizer.t(operation === "test" ? "sending" : "testNotification"));
    setText(this.#status.edit, localizer.t(!ready ? "settingsUnavailable" : operation === "save" ? "settingsSaving" : dirty ? "settingsDirty" : "settingsSaved"));
    controls.form.setAttribute("aria-busy", String(operation === "save"));
    setText(this.#status.secret, localizer.t(dashboard ? dashboard.api.has_client_secret ? "secretSaved" : "secretMissing" : "secretUnknown"));
    controls.clientSecret.placeholder = localizer.t(dashboard?.api.has_client_secret ? "secretReplace" : "secretNew");
    controls.clearSecret.disabled = !dashboard?.api.has_client_secret || Boolean(operation);
    controls.clientSecret.disabled = controls.clearSecret.checked;
    if (operation !== "auto-launch") controls.autoLaunch.checked = Boolean(dashboard?.auto_launch);
    const launchError = state.autoLaunchError || dashboard?.auto_launch_error;
    this.#status.autoLaunchError.hidden = !launchError;
    if (launchError) setText(this.#status.autoLaunchError, localizer.t("autoLaunchError", { error: localizer.error(launchError) }));
    const version = dashboard?.version ? `v${dashboard.version}` : "";
    setText(this.#status.appVersion, version);
    setText(this.#status.version, version);
    setText(this.#status.session, dashboard ? localizer.t(dashboard.session_type === "wayland" ? "sessionWayland" : dashboard.session_type === "x11" ? "sessionX11" : "sessionUnknown") : "");
  }
}
