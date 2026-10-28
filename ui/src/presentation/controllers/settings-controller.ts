import type { ApplicationActions } from "../../application/application-controller.ts";
import type { DesktopClient } from "../../application/ports/desktop-client.ts";
import type { Feedback, ScreenController } from "../../application/ports/presentation.ts";
import type { DashboardState } from "../../application/state/dashboard-state.ts";
import { SettingsDraft } from "../../application/state/settings-draft.ts";
import { createSettingsPayload } from "../../domain/rules.ts";
import { EventBindings } from "../dom/event-bindings.ts";
import type { SettingsView } from "../views/settings-view.ts";

export class SettingsController implements ScreenController {
  readonly #view: SettingsView;
  readonly #draft: SettingsDraft;
  readonly #state: DashboardState;
  readonly #client: DesktopClient;
  readonly #application: ApplicationActions;
  readonly #feedback: Feedback;
  readonly #events = new EventBindings();

  constructor(
    view: SettingsView, draft: SettingsDraft, state: DashboardState,
    client: DesktopClient, application: ApplicationActions, feedback: Feedback,
  ) {
    this.#view = view;
    this.#draft = draft;
    this.#state = state;
    this.#client = client;
    this.#application = application;
    this.#feedback = feedback;
  }

  start(): void {
    const controls = this.#view.controls;
    this.#events.listen(controls.form, "input", () => this.updateDraft());
    this.#events.listen(controls.form, "change", () => this.updateDraft());
    this.#events.listen(controls.reset, "click", () => {
      this.render(true);
      this.#view.clearValidation();
      this.#application.renderControls();
      this.#view.focusInterval();
    });
    this.#events.listen(controls.form, "submit", (event) => { event.preventDefault(); void this.save(); });
    this.#events.listen(controls.autoLaunch, "change", () => {
      const enabled = controls.autoLaunch.checked;
      this.#state.setAutoLaunchError(null);
      void this.#application.run("auto-launch", () => this.#client.setAutoLaunch(enabled), {
        dashboard: true, success: enabled ? "자동 실행을 켰습니다." : "자동 실행을 껐습니다.",
      });
    });
    this.#events.listen(controls.test, "click", () => {
      void this.#application.run("test", () => this.#client.sendTestNotification(), {
        context: "테스트 알림을 보내지 못했습니다", success: "테스트 알림을 요청했습니다. 데스크톱 알림을 확인해 주세요.",
      });
    });
  }

  dispose(): void { this.#events.dispose(); }

  render(force = false): void {
    const dashboard = this.#state.dashboard;
    if (dashboard && this.#draft.hydrate(dashboard, this.#view.editing, force)) this.#view.writeValues(this.#draft.values);
  }

  renderControls(): void { this.#view.renderControls(this.#state, this.#application.ready, this.#draft.dirty); }

  private updateDraft(): void {
    const dashboard = this.#state.dashboard;
    if (!dashboard) return;
    const values = this.#view.readValues();
    this.#draft.update(values, dashboard);
    if (values.clearClientSecret) this.#view.clearSecretInput();
    this.#view.clearValidation();
    this.#application.renderControls();
  }

  private async save(): Promise<void> {
    if (!this.#draft.dirty || this.#state.operation) return;
    const values = this.#view.readValues();
    try {
      createSettingsPayload(values);
    } catch (error) {
      this.#feedback.displayError("settings-error", "설정값을 확인해 주세요.", error);
      this.#view.markInvalid();
      return;
    }
    await this.#application.run("save", () => this.#client.saveSettings(values), {
      dashboard: true, context: "설정을 저장하지 못했습니다", errorTarget: "settings-error", success: "설정을 저장했습니다.",
    });
  }
}
