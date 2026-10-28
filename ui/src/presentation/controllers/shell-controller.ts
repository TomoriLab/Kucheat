import type { ApplicationActions } from "../../application/application-controller.ts";
import type { ScreenController } from "../../application/ports/presentation.ts";
import { normalizeTheme } from "../../domain/rules.ts";
import { EventBindings } from "../dom/event-bindings.ts";
import type { Page, ShellView } from "../views/shell-view.ts";

export class ShellController implements ScreenController {
  readonly #view: ShellView;
  readonly #window: Window;
  readonly #application: ApplicationActions;
  readonly #events = new EventBindings();
  #page: Page = "channels";

  constructor(view: ShellView, window: Window, application: ApplicationActions) {
    this.#view = view;
    this.#window = window;
    this.#application = application;
  }

  get page(): Page { return this.#page; }

  start(): void {
    for (const button of this.#view.controls.navigation) this.#events.listen(button, "click", () => {
      const page = button.dataset.page;
      if (page !== "channels" && page !== "settings") return;
      this.#page = page;
      this.#view.setPage(page);
    });
    this.#events.listen(this.#view.controls.retry, "click", () => { void this.#application.poll(); });
    for (const radio of this.#view.controls.themes) this.#events.listen(radio, "change", () => {
      if (!radio.checked) return;
      const preference = normalizeTheme(radio.value);
      this.#view.applyTheme(preference);
      try {
        this.#window.localStorage.setItem("kucheat.theme", preference);
        this.#view.showThemePersistence(true);
      } catch {
        this.#view.showThemePersistence(false);
      }
    });
    this.#events.listen<StorageEvent>(this.#window, "storage", (event) => {
      if (event.key === "kucheat.theme" || event.key === null) this.#view.applyTheme(normalizeTheme(event.newValue));
    });
    this.#view.applyTheme(normalizeTheme(this.#view.initialTheme));
  }

  dispose(): void { this.#events.dispose(); }
}
