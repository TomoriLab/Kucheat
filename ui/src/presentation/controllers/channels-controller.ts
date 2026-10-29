import type { StreamerSearchController } from "./streamer-search-controller.ts";
import type { Localizer } from "../../localization/localizer.ts";
import type { ApplicationActions } from "../../application/application-controller.ts";
import type { DesktopClient } from "../../application/ports/desktop-client.ts";
import type { Feedback, ScreenController } from "../../application/ports/presentation.ts";
import { ChannelLibrary } from "../../application/state/channel-library.ts";
import type { DashboardState } from "../../application/state/dashboard-state.ts";
import { createChannelPayload } from "../../domain/rules.ts";
import { EventBindings } from "../dom/event-bindings.ts";
import type { ChannelDialogsView } from "../views/channel-dialogs-view.ts";
import type { ChannelsView } from "../views/channels-view.ts";

export class ChannelsController implements ScreenController {
  readonly #view: ChannelsView;
  readonly #dialogs: ChannelDialogsView;
  readonly #library: ChannelLibrary;
  readonly #state: DashboardState;
  readonly #client: DesktopClient;
  readonly #application: ApplicationActions;
  readonly #feedback: Feedback;
  readonly #events = new EventBindings();
  readonly #localizer: Localizer;
  readonly #search: StreamerSearchController;

  constructor(
    view: ChannelsView, dialogs: ChannelDialogsView, library: ChannelLibrary,
    state: DashboardState, client: DesktopClient, application: ApplicationActions, feedback: Feedback,
    localizer: Localizer, search: StreamerSearchController,
  ) {
    this.#search = search;
    this.#localizer = localizer;
    this.#view = view;
    this.#dialogs = dialogs;
    this.#library = library;
    this.#state = state;
    this.#client = client;
    this.#application = application;
    this.#feedback = feedback;
  }

  start(): void {
    this.#search.start();
    const controls = this.#view.controls;
    for (const button of controls.filters) this.#events.listen(button, "click", () => {
      const filter = button.dataset.filter;
      if (filter !== "all" && filter !== "live" && filter !== "offline" && filter !== "unknown") return;
      this.#library.selectFilter(filter);
      this.#view.selectFilter(filter);
      this.render();
    });
    this.#events.listen(controls.search, "input", () => {
      this.#library.search(controls.search.value);
      this.render();
    });
    this.#events.listen(controls.clearSearch, "click", () => this.clearSearch());
    this.#events.listen(controls.emptyAction, "click", () => {
      const action = controls.emptyAction.dataset.action;
      if (action === "add") this.openAdd(controls.emptyAction);
      else if (action === "retry") void this.#application.poll();
      else {
        this.#library.selectFilter("all");
        this.#view.selectFilter("all");
        this.clearSearch();
      }
    });
    this.#events.listen(controls.add, "click", () => this.openAdd(controls.add));
    this.#events.listen(controls.refresh, "click", () => {
      void this.#application.run("refresh", () => this.#client.refreshChannels(), {
        context: this.#localizer.message("refreshFailure"), success: this.#localizer.message("refreshSuccess"),
      });
    });
    this.#events.listen(controls.list, "click", (event) => this.handleRowAction(event));
    const dialogControls = this.#dialogs.controls;
    for (const button of dialogControls.closeButtons) this.#events.listen(button, "click", () => {
      const identifier = button.dataset.closeDialog;
      if (!this.#state.operation && (identifier === "add-dialog" || identifier === "delete-dialog")) this.#dialogs.close(identifier);
    });
    for (const identifier of ["add-dialog", "delete-dialog"] as const) {
      const dialog = dialogControls.dialogs[identifier];
      this.#events.listen(dialog, "cancel", (event) => { if (this.#state.operation) event.preventDefault(); });
      this.#events.listen(dialog, "close", () => {
        this.#dialogs.restoreFocus(identifier);
        if (identifier === "add-dialog" && !dialog.open) this.#search.close();
        if (identifier === "delete-dialog") this.#library.clearDeletion();
      });
    }
    this.#events.listen(dialogControls.addForm, "submit", (event) => { event.preventDefault(); void this.add(); });
    this.#events.listen(dialogControls.deleteForm, "submit", (event) => { event.preventDefault(); void this.remove(); });
    this.#events.listen(dialogControls.identifier, "input", () => this.#dialogs.clearAddError());
  }

  dispose(): void { this.#events.dispose(); this.#search.dispose(); }

  render(): void {
    this.#view.render(this.#state.dashboard, this.#library, this.#client.available, this.#state.loading,
      !this.#application.ready || Boolean(this.#state.operation));
  }

  renderControls(): void {
    this.#view.renderControls(!this.#application.ready || Boolean(this.#state.operation),
      this.#state.operation, Boolean(this.#state.dashboard?.monitor.checking));
    this.#dialogs.renderControls(this.#state.operation);
    this.#search.render();
  }

  private clearSearch(): void {
    this.#library.clearSearch();
    this.#view.clearSearch();
    this.render();
  }

  private openAdd(invoker: HTMLElement): void {
    if (!this.#application.ready || this.#state.operation) return;
    this.#dialogs.openAdd(invoker);
    this.#search.open();
  }

  private handleRowAction(event: Event): void {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>("button[data-channel-action]");
    const identifier = button?.closest<HTMLElement>(".channel-card")?.dataset.channelId;
    if (!button || button.disabled || !identifier || !this.#application.ready || this.#state.operation) return;
    if (button.dataset.channelAction === "delete") {
      const channel = this.#library.selectDeletion(identifier, this.#state.dashboard?.channels || []);
      if (channel) this.#dialogs.openDelete(channel, button);
    } else {
      const live = button.dataset.channelAction === "watch";
      void this.#application.run("open", () => this.#client.openChannel(identifier, live), {
        context: this.#localizer.message(live ? "liveOpenFailure" : "channelOpenFailure"),
      });
    }
  }

  private async add(): Promise<void> {
    if (this.#state.operation) return;
    const { identifier, name } = this.#dialogs.controls;
    const channels = this.#state.dashboard?.channels || [];
    try {
      createChannelPayload(identifier.value, name.value, channels);
    } catch (error) {
      this.#feedback.displayError("add-error", this.#localizer.message("channelValidation"), error);
      this.#dialogs.markInvalid();
      return;
    }
    await this.#application.run("add", () => this.#client.addChannel(identifier.value, name.value, channels), {
      dashboard: true, context: this.#localizer.message("addFailure"), errorTarget: "add-error", success: this.#localizer.message("addSuccess"),
      onSuccess: () => this.#dialogs.close("add-dialog"),
    });
  }

  private async remove(): Promise<void> {
    const channel = this.#library.deletion;
    if (!channel) return;
    const success = await this.#application.run("delete", () => this.#client.removeChannel(channel.id), {
      dashboard: true, context: this.#localizer.message("deleteFailure"), errorTarget: "delete-error", success: this.#localizer.message("deleteSuccess"),
      onSuccess: () => this.#dialogs.close("delete-dialog"),
    });
    if (success) this.#dialogs.focusAdd();
  }
}
