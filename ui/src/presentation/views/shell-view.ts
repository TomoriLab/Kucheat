import type { ApplicationView } from "../../application/ports/presentation.ts";
import type { DashboardState } from "../../application/state/dashboard-state.ts";
import type { Localizer } from "../../localization/localizer.ts";
import { LocalizedDocument } from "../dom/localized-document.ts";
import type { Theme } from "../../domain/types.ts";
import { element, isDisabled, setText } from "../dom/elements.ts";

export type Page = "channels" | "settings";

export class ShellView implements ApplicationView {
  readonly controls;
  readonly #document: Document;
  readonly #window: Window;
  readonly #state: DashboardState;
  readonly #available: boolean;
  readonly #connection;
  readonly #monitor;
  readonly #pages;
  readonly #headings;
  readonly #themeHelp;
  readonly #nativeControls;
  readonly #localizer: Localizer;
  readonly #localizedDocument: LocalizedDocument;
  #page: Page = "channels";
  #themePersisted = true;

  constructor(document: Document, window: Window, state: DashboardState, available: boolean, localizer: Localizer) {
    this.#localizer = localizer;
    this.#localizedDocument = new LocalizedDocument(document, localizer);
    this.#document = document;
    this.#window = window;
    this.#state = state;
    this.#available = available;
    this.controls = {
      retry: element(document, "retry-connection", "button"),
      navigation: document.querySelectorAll<HTMLButtonElement>("[data-page]"),
      themes: document.querySelectorAll<HTMLInputElement>('[name="theme"]'),
    };
    this.#connection = {
      banner: element(document, "connection-banner", "section"),
      title: element(document, "connection-title", "strong"),
      detail: element(document, "connection-detail", "p"),
    };
    this.#monitor = {
      label: element(document, "monitor-status-text", "strong"),
      detail: element(document, "monitor-detail", "p"),
      sidebarLabel: element(document, "sidebar-status-text", "span"),
      dot: element(document, "monitor-status-dot", "span"),
      sidebarDot: element(document, "sidebar-status-dot", "span"),
      error: element(document, "monitor-error", "div"),
      errorDetail: element(document, "monitor-error-detail", "p"),
    };
    this.#pages = { channels: element(document, "channels-page", "section"), settings: element(document, "settings-page", "section") };
    this.#headings = { channels: element(document, "channels-heading", "h1"), settings: element(document, "settings-heading", "h1") };
    this.#themeHelp = element(document, "theme-help", "p");
    this.#nativeControls = document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLFieldSetElement | HTMLSelectElement>("[data-native], [data-native-edit]");
  }

  get initialTheme(): string | undefined { return this.#document.documentElement.dataset.theme; }

  setPage(page: Page): void {
    this.#page = page;
    for (const button of this.controls.navigation) {
      if (button.dataset.page === page) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    this.#pages.channels.hidden = page !== "channels";
    this.#pages.settings.hidden = page !== "settings";
    this.renderTitle();
    this.#headings[page].focus({ preventScroll: true });
    this.#window.scrollTo({ top: 0, behavior: "instant" });
  }

  applyTheme(theme: Theme): void {
    this.#document.documentElement.dataset.theme = theme;
    for (const radio of this.controls.themes) radio.checked = radio.value === theme;
  }

  showThemePersistence(persisted: boolean): void {
    this.#themePersisted = persisted;
    setText(this.#themeHelp, this.#localizer.t(persisted ? "themeHelp" : "themeStorageFailure"));
  }

  captureFocus(): () => void {
    const activeControl = this.#document.activeElement;
    return () => {
      if (activeControl instanceof HTMLElement && activeControl.isConnected
          && !isDisabled(activeControl) && this.#document.activeElement === this.#document.body) {
        activeControl.focus({ preventScroll: true });
      }
    };
  }

  render(): void {
    this.#localizedDocument.render();
    this.renderTitle();
    this.showThemePersistence(this.#themePersisted);
    this.renderConnection();
    this.renderMonitor();
  }

  renderControls(): void {
    const blocked = !this.#available || !this.#state.dashboard || Boolean(this.#state.operation);
    for (const control of this.#nativeControls) control.disabled = blocked;
    this.controls.retry.disabled = this.#state.loading || Boolean(this.#state.operation);
  }

  private renderConnection(): void {
    const state = this.#state;
    const unavailable = !this.#available;
    const failed = Boolean(state.connectionError);
    this.#connection.banner.hidden = !unavailable && !failed;
    this.#connection.banner.classList.toggle("warning", failed);
    this.controls.retry.hidden = unavailable || !failed;
    this.controls.retry.disabled = state.loading || Boolean(state.operation);
    setText(this.controls.retry, this.#localizer.t(state.loading ? "connecting" : "retry"));
    if (unavailable) {
      setText(this.#connection.title, this.#localizer.t("desktopRequired"));
      setText(this.#connection.detail, this.#localizer.t("browserDetail"));
    } else if (failed) {
      setText(this.#connection.title, this.#localizer.t(state.dashboard ? "updateFailed" : "connectionFailed"));
      setText(this.#connection.detail, this.#localizer.t(state.dashboard ? "staleDetail" : "reconnectDetail", { error: this.#localizer.error(state.connectionError) }));
    }
  }

  private renderMonitor(): void {
    const { dashboard, connectionError } = this.#state;
    const localizer = this.#localizer;
    let label = localizer.t(this.#available ? "appConnecting" : "appDisconnected");
    let detail = localizer.t(this.#available ? "monitorConnecting" : "startDesktop");
    let status = "";
    if (dashboard) {
      const monitor = dashboard.monitor;
      status = monitor.last_error ? "error" : monitor.checking ? "checking" : monitor.running ? "running" : "";
      label = localizer.t(monitor.checking ? "checkingStreams" : monitor.running ? "monitoring" : "monitoringStopped");
      if (connectionError) {
        label = localizer.t("checkConnection");
        status = "error";
      }
      const lastChecked = monitor.last_checked ? localizer.t("lastChecked", { time: localizer.timestamp(monitor.last_checked) }) : localizer.t("waitingFirstCheck");
      detail = monitor.running
        ? localizer.t("monitorInterval", { seconds: localizer.number(dashboard.settings.check_interval_secs), checked: lastChecked })
        : localizer.t("monitorService");
      if (monitor.host) detail = localizer.t("monitorHost", { detail, host: monitor.host });
      this.#monitor.error.hidden = !monitor.last_error;
      setText(this.#monitor.errorDetail, monitor.last_error || "");
    } else {
      this.#monitor.error.hidden = true;
      if (connectionError) {
        label = localizer.t("appConnectionFailed");
        detail = localizer.t("monitorReconnect");
        status = "error";
      }
    }
    setText(this.#monitor.label, label);
    setText(this.#monitor.detail, detail);
    setText(this.#monitor.sidebarLabel, label);
    this.#monitor.dot.className = `status-dot ${status}`;
    this.#monitor.sidebarDot.className = `status-dot ${status}`;
  }

  private renderTitle(): void {
    this.#document.title = this.#localizer.t("pageTitle", { page: this.#localizer.t(this.#page) });
  }
}
