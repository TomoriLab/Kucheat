import type { LocalizedText, Localizer } from "../localization/localizer.ts";
import type { Dashboard } from "../domain/types.ts";
import type { DesktopClient } from "./ports/desktop-client.ts";
import type { ApplicationView, ErrorTarget, Feedback, Scheduler, ScreenController } from "./ports/presentation.ts";
import { DashboardState } from "./state/dashboard-state.ts";
import type { Operation } from "./state/dashboard-state.ts";

export interface OperationOptions {
  dashboard?: boolean;
  errorTarget?: ErrorTarget;
  context?: LocalizedText;
  success?: LocalizedText;
  onSuccess?: () => void;
}

export interface ApplicationActions {
  readonly ready: boolean;
  poll(): Promise<void>;
  renderControls(): void;
  relocalize(): void;
  run(operation: Operation, action: () => Promise<Dashboard | void>, options?: OperationOptions): Promise<boolean>;
}

export class ApplicationController implements ApplicationActions {
  readonly #client: DesktopClient;
  readonly #state: DashboardState;
  readonly #view: ApplicationView;
  readonly #feedback: Feedback;
  readonly #scheduler: Scheduler;
  readonly #screens: readonly ScreenController[];
  readonly #localizer: Localizer;
  #cancelPoll: (() => void) | undefined;
  #running = false;
  #generation = 0;
  #revision = 0;

  constructor(
    client: DesktopClient, state: DashboardState, view: ApplicationView,
    feedback: Feedback, scheduler: Scheduler, createScreens: (actions: ApplicationActions) => readonly ScreenController[],
    localizer: Localizer,
  ) {
    this.#localizer = localizer;
    this.#client = client;
    this.#state = state;
    this.#view = view;
    this.#feedback = feedback;
    this.#scheduler = scheduler;
    this.#screens = createScreens(this);
  }

  get ready(): boolean { return this.#running && this.#client.available && Boolean(this.#state.dashboard); }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#generation += 1;
    this.#feedback.start();
    for (const screen of this.#screens) screen.start();
    this.render();
    if (this.#client.available) void this.poll();
  }

  dispose(): void {
    if (!this.#running) return;
    this.#running = false;
    this.#generation += 1;
    this.#cancelPoll?.();
    this.#cancelPoll = undefined;
    this.#state.endLoading();
    this.#state.endOperation();
    for (const screen of this.#screens) screen.dispose();
    this.#feedback.dispose();
  }

  renderControls(): void {
    this.#view.renderControls();
    for (const screen of this.#screens) screen.renderControls?.();
  }

  async poll(): Promise<void> {
    this.#cancelPoll?.();
    this.#cancelPoll = undefined;
    if (!this.#running || !this.#client.available) return;
    if (this.#state.loading || this.#state.operation) {
      this.schedulePoll();
      return;
    }
    const generation = this.#generation;
    const revision = ++this.#revision;
    this.#state.beginLoading();
    this.render();
    try {
      const dashboard = await this.#client.getDashboard();
      if (this.isCurrent(generation) && revision === this.#revision) this.#state.accept(dashboard);
    } catch (error) {
      if (this.isCurrent(generation) && revision === this.#revision) this.#state.failConnection(error);
    } finally {
      if (this.isCurrent(generation)) {
        this.#state.endLoading();
        this.render();
        this.schedulePoll();
      }
    }
  }

  async run(
    operation: Operation, action: () => Promise<Dashboard | void>, options: OperationOptions = {},
  ): Promise<boolean> {
    if (!this.ready || !this.#state.beginOperation(operation)) return false;
    const generation = this.#generation;
    // Starting a mutation invalidates a poll even when the injected client permits concurrency.
    if (options.dashboard) this.#revision += 1;
    const restoreFocus = this.#view.captureFocus();
    let succeeded = false;
    if (options.errorTarget) this.#feedback.clearError(options.errorTarget);
    this.renderControls();
    try {
      const result = await action();
      if (!this.isCurrent(generation)) return false;
      if (options.dashboard) {
        this.#state.accept(result);
        this.render(operation === "save");
      }
      succeeded = true;
      if (options.success) this.#feedback.showToast(options.success);
      return true;
    } catch (error) {
      if (!this.isCurrent(generation)) return false;
      const context = options.context || this.#localizer.message("requestFailure");
      if (options.errorTarget) this.#feedback.displayError(options.errorTarget, context, error);
      else if (operation === "auto-launch") this.#state.setAutoLaunchError(error);
      else this.#feedback.showActionError(context, error);
      return false;
    } finally {
      if (this.isCurrent(generation)) {
        this.#state.endOperation();
        this.renderControls();
        if (succeeded) options.onSuccess?.();
        restoreFocus();
        this.schedulePoll();
      }
    }
  }

  relocalize(): void { if (this.#running) this.render(); }

  private render(resetSettings = false): void {
    if (this.#state.dashboard) this.#localizer.setPreference(this.#state.dashboard.settings.language);
    else this.#localizer.setPreference("system");
    this.#view.render();
    for (const screen of this.#screens) screen.render?.(resetSettings);
    this.#feedback.render?.();
    this.renderControls();
  }

  private isCurrent(generation: number): boolean {
    return this.#running && this.#generation === generation;
  }

  private schedulePoll(): void {
    this.#cancelPoll?.();
    if (this.#running && this.#client.available) {
      this.#cancelPoll = this.#scheduler.schedule(() => { void this.poll(); }, 3000);
    }
  }
}
