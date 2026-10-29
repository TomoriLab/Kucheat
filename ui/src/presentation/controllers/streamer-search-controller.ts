import type { ApplicationActions } from "../../application/application-controller.ts";
import type { DesktopClient } from "../../application/ports/desktop-client.ts";
import type { DashboardState } from "../../application/state/dashboard-state.ts";
import { StreamerSearchState } from "../../application/state/streamer-search-state.ts";
import type { Localizer } from "../../localization/localizer.ts";
import { EventBindings } from "../dom/event-bindings.ts";
import type { StreamerSearchPresentation } from "../views/streamer-search-view.ts";

export class StreamerSearchController {
  readonly #view: StreamerSearchPresentation;
  readonly #search: StreamerSearchState;
  readonly #dashboard: DashboardState;
  readonly #client: DesktopClient;
  readonly #application: ApplicationActions;
  readonly #localizer: Localizer;
  readonly #closeDialog: () => void;
  readonly #events = new EventBindings();
  #running = false;
  #lifetime = 0;

  constructor(
    view: StreamerSearchPresentation, search: StreamerSearchState, dashboard: DashboardState,
    client: DesktopClient, application: ApplicationActions, localizer: Localizer, closeDialog: () => void,
  ) {
    this.#view = view;
    this.#search = search;
    this.#dashboard = dashboard;
    this.#client = client;
    this.#application = application;
    this.#localizer = localizer;
    this.#closeDialog = closeDialog;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    const controls = this.#view.controls;
    this.#events.listen(controls.input, "input", () => {
      this.#search.changeQuery(controls.input.value);
      this.render();
    });
    this.#events.listen<KeyboardEvent>(controls.input, "keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.isComposing) void this.search();
    });
    this.#events.listen(controls.submit, "click", () => { void this.search(); });
    this.#events.listen(controls.more, "click", () => { void this.search(true); });
    this.#events.listen(controls.results, "click", (event) => {
      const identifier = this.#view.selectedIdentifier(event);
      if (identifier) void this.add(identifier);
    });
    if (this.#view.open) this.open();
  }

  dispose(): void {
    this.#running = false;
    this.#events.dispose();
    this.close();
  }

  open(): void {
    this.#lifetime += 1;
    this.#search.open();
    this.#view.resetInput();
    this.render();
  }

  close(): void {
    this.#lifetime += 1;
    this.#search.close();
  }

  render(): void {
    this.#search.synchronizeRegistration(this.#dashboard.dashboard?.channels ?? null);
    this.#view.render(this.#search, this.#dashboard.dashboard?.channels ?? null,
      !this.#running || !this.#application.ready || Boolean(this.#dashboard.operation));
  }

  async search(more = false): Promise<void> {
    if (!this.usable()) return;
    this.#search.changeQuery(this.#view.controls.input.value);
    let request;
    try {
      request = this.#search.begin(more);
    } catch (error) {
      this.#search.invalid(error);
      this.render();
      this.#view.markInvalid();
      return;
    }
    if (!request) return;
    const lifetime = this.#lifetime;
    this.render();
    try {
      const result = await this.#client.searchChannels(request.query, request.offset);
      if (this.current(lifetime)) this.#search.accept(request, result);
    } catch (error) {
      if (this.current(lifetime)) this.#search.fail(request, error);
    } finally {
      if (this.current(lifetime) && this.#search.revision === request.revision) this.render();
    }
  }

  async add(identifier: string): Promise<void> {
    if (!this.usable()) return;
    const channels = this.#dashboard.dashboard?.channels ?? null;
    this.#search.synchronizeRegistration(channels);
    const result = this.#search.result(identifier, channels);
    if (!result || result.registered) return;
    const lifetime = this.#lifetime;
    await this.#application.run("add", () => this.#client.addChannel(result.id, null, channels ?? []), {
      dashboard: true, errorTarget: "add-error", context: this.#localizer.message("addFailure"),
      success: this.#localizer.message("addSuccess"),
      onSuccess: () => { if (this.current(lifetime)) this.#closeDialog(); },
    });
  }

  private usable(): boolean {
    return this.current(this.#lifetime) && this.#application.ready && !this.#dashboard.operation;
  }

  private current(lifetime: number): boolean {
    return this.#running && this.#view.open && this.#search.active && lifetime === this.#lifetime;
  }
}
