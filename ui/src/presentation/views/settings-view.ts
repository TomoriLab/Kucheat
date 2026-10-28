import type { DashboardState } from "../../application/state/dashboard-state.ts";
import type { SettingsFormValues } from "../../domain/types.ts";
import { element, setText } from "../dom/elements.ts";

export class SettingsView {
  readonly controls;
  readonly #document: Document;
  readonly #status;

  constructor(document: Document) {
    this.#document = document;
    this.controls = {
      form: element(document, "settings-form", "form"),
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
    };
  }

  writeValues(values: SettingsFormValues): void {
    this.controls.interval.value = String(values.interval);
    this.controls.notifyOffline.checked = values.notifyOffline;
    this.controls.clientId.value = values.clientId;
    this.controls.clientSecret.value = values.clientSecret || "";
    this.controls.clearSecret.checked = values.clearClientSecret;
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
    const { dashboard, operation } = state;
    const blocked = !ready || Boolean(operation);
    const controls = this.controls;
    controls.save.disabled = blocked || !dirty;
    controls.reset.disabled = blocked || !dirty;
    setText(controls.save, operation === "save" ? "저장 중…" : "변경 사항 저장");
    setText(this.#status.testLabel, operation === "test" ? "전송 중…" : "테스트 알림");
    setText(this.#status.edit, !ready ? "앱 연결 후 설정을 변경할 수 있습니다."
      : operation === "save" ? "설정을 저장하고 있습니다."
        : dirty ? "저장하지 않은 변경 사항이 있습니다." : "모든 변경 사항이 저장되었습니다.");
    controls.form.setAttribute("aria-busy", String(operation === "save"));
    setText(this.#status.secret, dashboard ? dashboard.api.has_client_secret ? "저장됨" : "저장된 값 없음" : "저장 여부 확인 전");
    controls.clientSecret.placeholder = dashboard?.api.has_client_secret ? "변경할 때만 새 Secret 입력" : "새 Secret 입력";
    controls.clearSecret.disabled = !dashboard?.api.has_client_secret || Boolean(operation);
    controls.clientSecret.disabled = controls.clearSecret.checked;
    if (operation !== "auto-launch") controls.autoLaunch.checked = Boolean(dashboard?.auto_launch);
    const launchError = state.autoLaunchError || dashboard?.auto_launch_error;
    this.#status.autoLaunchError.hidden = !launchError;
    if (launchError) setText(this.#status.autoLaunchError, `자동 실행 상태를 확인하거나 변경하지 못했습니다.\n${launchError}`);
    const version = dashboard?.version ? `v${dashboard.version}` : "";
    setText(this.#status.appVersion, version);
    setText(this.#status.version, version);
    setText(this.#status.session, dashboard ? { wayland: "Wayland 세션", x11: "X11 세션", unknown: "세션 유형 확인 불가" }[dashboard.session_type] || "세션 유형 확인 불가" : "");
  }
}
