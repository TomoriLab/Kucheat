import { CodedError } from "../../domain/errors.ts";
import type { StreamerSearchState } from "../../application/state/streamer-search-state.ts";
import type { Channel } from "../../domain/types.ts";
import type { Localizer } from "../../localization/localizer.ts";
import { element, setText } from "../dom/elements.ts";
import { StreamerSearchResultView } from "./streamer-search-result-view.ts";

export interface StreamerSearchPresentation {
  readonly controls: {
    input: HTMLInputElement;
    submit: HTMLButtonElement;
    more: HTMLButtonElement;
    results: HTMLElement;
  };
  readonly open: boolean;
  resetInput(): void;
  markInvalid(): void;
  selectedIdentifier(event: Event): string | null;
  render(state: StreamerSearchState, channels: readonly Channel[] | null, blocked: boolean): void;
}

export class StreamerSearchView implements StreamerSearchPresentation {
  readonly controls;
  readonly #document: Document;
  readonly #dialog: HTMLDialogElement;
  readonly #status: HTMLParagraphElement;
  readonly #localizer: Localizer;
  readonly #rows = new Map<string, StreamerSearchResultView>();
  #paginationFocusRevision: number | null = null;

  constructor(document: Document, localizer: Localizer) {
    this.#document = document;
    this.#localizer = localizer;
    this.#dialog = element(document, "add-dialog", "dialog");
    this.#status = element(document, "streamer-search-status", "p");
    this.controls = {
      input: element(document, "streamer-search", "input"),
      submit: element(document, "search-streamers", "button"),
      more: element(document, "streamer-search-more", "button"),
      results: element(document, "streamer-search-results", "div"),
    };
  }

  get open(): boolean { return this.#dialog.open; }
  resetInput(): void { this.controls.input.value = ""; this.controls.input.removeAttribute("aria-invalid"); }
  markInvalid(): void { this.controls.input.setAttribute("aria-invalid", "true"); this.controls.input.focus(); }

  selectedIdentifier(event: Event): string | null {
    if (!(event.target instanceof Element)) return null;
    const button = event.target.closest<HTMLButtonElement>("button[data-search-add]");
    return button && !button.disabled && this.controls.results.contains(button) ? button.dataset.searchAdd ?? null : null;
  }

  render(state: StreamerSearchState, channels: readonly Channel[] | null, blocked: boolean): void {
    const localizer = this.#localizer;
    const { input, submit, more, results } = this.controls;
    const active = this.#document.activeElement;
    if (active === more && state.loading) this.#paginationFocusRevision = state.revision;
    if (this.#paginationFocusRevision !== state.revision) this.#paginationFocusRevision = null;
    input.disabled = blocked;
    submit.disabled = blocked || state.loading;
    more.disabled = blocked || state.loading;
    input.setAttribute("aria-invalid", String(state.error instanceof CodedError && state.error.code === "invalidStreamerQuery"));
    more.hidden = state.nextOffset === null && !(state.failedOffset !== null && state.failedOffset > 0);
    setText(submit, localizer.t(state.loading ? "streamerSearching" : state.error && state.failedOffset === 0 ? "streamerRetry" : "streamerSearch"));
    setText(more, localizer.t(state.loading ? "streamerSearching" : state.error ? "streamerRetry" : "streamerMore"));
    results.setAttribute("aria-busy", String(state.loading));
    this.#status.classList.toggle("streamer-search-error", Boolean(state.error));
    setText(this.#status, !state.active ? "" : blocked && !state.searched && !state.loading ? localizer.t("streamerUnavailable")
      : state.error ? localizer.t("streamerFailure", { error: localizer.error(state.error) })
        : state.loading ? localizer.t("streamerSearching")
          : !state.searched ? localizer.t("streamerSearchHelp")
            : state.results.length ? localizer.t("streamerResultCount", { count: localizer.number(state.results.length) })
              : localizer.t("streamerEmpty"));
    const identifiers = new Set(state.results.map((result) => result.id));
    for (const [identifier, view] of this.#rows) {
      if (!identifiers.has(identifier)) { view.row.remove(); this.#rows.delete(identifier); }
    }
    for (const result of state.results) {
      let view = this.#rows.get(result.id);
      if (!view) {
        view = new StreamerSearchResultView(this.#document, result.id, localizer);
        this.#rows.set(result.id, view);
        results.append(view.row);
      }
      view.render(state.result(result.id, channels) ?? result, blocked);
    }
    // A disabled pagination button may lose focus in the webview while the request is pending.
    if (!state.loading && !blocked && this.open && this.#paginationFocusRevision === state.revision) {
      this.#paginationFocusRevision = null;
      if (active === more || active === this.#document.body) (more.hidden ? input : more).focus({ preventScroll: true });
    }
  }
}
