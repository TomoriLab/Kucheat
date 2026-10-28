import type { ApplicationView } from "../../application/ports/presentation.ts";
import type { DashboardState } from "../../application/state/dashboard-state.ts";
import { formatTimestamp } from "../../domain/rules.ts";
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

  constructor(document: Document, window: Window, state: DashboardState, available: boolean) {
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
    this.#nativeControls = document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLFieldSetElement>("[data-native], [data-native-edit]");
  }

  get initialTheme(): string | undefined { return this.#document.documentElement.dataset.theme; }

  setPage(page: Page): void {
    for (const button of this.controls.navigation) {
      if (button.dataset.page === page) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    this.#pages.channels.hidden = page !== "channels";
    this.#pages.settings.hidden = page !== "settings";
    this.#document.title = `${page === "channels" ? "채널" : "설정"} · Kucheat`;
    this.#headings[page].focus({ preventScroll: true });
    this.#window.scrollTo({ top: 0, behavior: "instant" });
  }

  applyTheme(theme: Theme): void {
    this.#document.documentElement.dataset.theme = theme;
    for (const radio of this.controls.themes) radio.checked = radio.value === theme;
  }

  showThemePersistence(persisted: boolean): void {
    setText(this.#themeHelp, persisted ? "테마는 이 기기에 저장되며 즉시 적용됩니다."
      : "테마를 적용했습니다. 저장 공간에 접근할 수 없어 앱을 다시 열면 초기화됩니다.");
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
    setText(this.controls.retry, state.loading ? "연결 중…" : "다시 연결");
    if (unavailable) {
      setText(this.#connection.title, "데스크톱 앱에서 열어 주세요");
      setText(this.#connection.detail, "브라우저에서는 앱에 연결할 수 없습니다. 채널 관리와 알림은 Kucheat 앱에서 사용할 수 있습니다.");
    } else if (failed) {
      setText(this.#connection.title, state.dashboard ? "앱 정보를 갱신하지 못했습니다" : "앱에 연결하지 못했습니다");
      setText(this.#connection.detail, `${state.dashboard ? "마지막으로 받은 정보를 표시합니다. " : ""}자동으로 다시 연결합니다.\n${state.connectionError}`);
    }
  }

  private renderMonitor(): void {
    const { dashboard, connectionError } = this.#state;
    let label = this.#available ? "앱에 연결하는 중" : "앱 연결 없음";
    let detail = this.#available ? "모니터링 상태를 확인하고 있습니다." : "Kucheat 데스크톱 앱을 실행해 주세요.";
    let status = "";
    if (dashboard) {
      const monitor = dashboard.monitor;
      status = monitor.last_error ? "error" : monitor.checking ? "checking" : monitor.running ? "running" : "";
      label = monitor.checking ? "방송 상태 확인 중" : monitor.running ? "모니터링 중" : "모니터링 중지됨";
      if (connectionError) {
        label = "연결 상태 확인 필요";
        status = "error";
      }
      const lastChecked = monitor.last_checked ? `최근 확인 ${formatTimestamp(monitor.last_checked)}` : "첫 확인을 기다리고 있습니다";
      detail = monitor.running
        ? `${dashboard.settings.check_interval_secs.toLocaleString("ko-KR")}초 간격 · ${lastChecked}`
        : "실행 중인 모니터링 서비스를 확인해 주세요.";
      if (monitor.host) detail += ` · ${monitor.host}`;
      this.#monitor.error.hidden = !monitor.last_error;
      setText(this.#monitor.errorDetail, monitor.last_error || "");
    } else {
      this.#monitor.error.hidden = true;
      if (connectionError) {
        label = "앱 연결 실패";
        detail = "연결을 복구하면 모니터링 상태를 표시합니다.";
        status = "error";
      }
    }
    setText(this.#monitor.label, label);
    setText(this.#monitor.detail, detail);
    setText(this.#monitor.sidebarLabel, label);
    this.#monitor.dot.className = `status-dot ${status}`;
    this.#monitor.sidebarDot.className = `status-dot ${status}`;
  }
}
