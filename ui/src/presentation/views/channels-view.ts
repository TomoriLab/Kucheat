import type { Localizer } from "../../localization/localizer.ts";
import { channelCounts } from "../../domain/rules.ts";
import type { ChannelFilter, Dashboard } from "../../domain/types.ts";
import type { ChannelLibrary } from "../../application/state/channel-library.ts";
import { createElement, element, setText } from "../dom/elements.ts";
import { ChannelRowView } from "./channel-row-view.ts";

interface EmptyAction {
  label: string;
  type: "add" | "retry" | "clear";
}

export class ChannelsView {
  readonly controls;
  readonly #document: Document;
  readonly #empty;
  readonly #footnote;
  readonly #announcement;
  readonly #navigationCount;
  readonly #counts;
  readonly #rows = new Map<string, ChannelRowView>();
  readonly #localizer: Localizer;

  constructor(document: Document, localizer: Localizer) {
    this.#localizer = localizer;
    this.#document = document;
    this.controls = {
      list: element(document, "channel-list", "div"),
      search: element(document, "channel-search", "input"),
      clearSearch: element(document, "clear-search", "button"),
      emptyAction: element(document, "empty-action", "button"),
      add: element(document, "add-channel", "button"),
      refresh: element(document, "refresh-channels", "button"),
      refreshLabel: element(document, "refresh-label", "span"),
      filters: document.querySelectorAll<HTMLButtonElement>("[data-filter]"),
    };
    this.#empty = {
      panel: element(document, "channel-empty", "div"),
      title: element(document, "empty-title", "h2"),
      description: element(document, "empty-description", "p"),
    };
    this.#footnote = element(document, "channel-footnote", "p");
    this.#announcement = element(document, "filter-announcement", "p");
    this.#navigationCount = element(document, "navigation-count", "span");
    this.#counts = {
      all: element(document, "count-all", "span"),
      live: element(document, "count-live", "span"),
      offline: element(document, "count-offline", "span"),
    };
  }

  selectFilter(filter: ChannelFilter): void {
    for (const button of this.controls.filters) button.setAttribute("aria-pressed", String(button.dataset.filter === filter));
  }

  clearSearch(): void {
    this.controls.search.value = "";
    this.controls.search.focus();
  }

  render(dashboard: Dashboard | null, library: ChannelLibrary, available: boolean, loading: boolean, blocked: boolean): void {
    const localizer = this.#localizer;
    const { list } = this.controls;
    const channels = dashboard?.channels || [];
    const counts = channelCounts(channels);
    for (const filter of ["all", "live", "offline"] as const) setText(this.#counts[filter], localizer.number(counts[filter]));
    setText(this.#navigationCount, dashboard ? localizer.number(counts.all) : "—");
    this.controls.clearSearch.hidden = !library.query;
    this.#empty.panel.hidden = true;
    this.#footnote.hidden = true;
    list.setAttribute("aria-busy", String(loading && !dashboard));
    if (!dashboard) {
      if (loading) {
        this.showLoading();
        return;
      }
      list.replaceChildren();
      if (!available) this.showEmpty(localizer.t("noChannelsConnection"), localizer.t("noChannelsDesktop"), blocked);
      else this.showEmpty(localizer.t("checkConnectionTitle"), localizer.t("channelLoadFailure"), false, { label: localizer.t("retry"), type: "retry" });
      return;
    }
    for (const loading of list.querySelectorAll(".loading-card")) loading.remove();
    const filtered = library.visible(channels, localizer.locale);
    const visibleIdentifiers = new Set(filtered.map((channel) => channel.id));
    const activeElement = this.#document.activeElement;
    for (const [identifier, view] of this.#rows) {
      if (!visibleIdentifiers.has(identifier)) view.row.remove();
      if (!channels.some((channel) => channel.id === identifier)) this.#rows.delete(identifier);
    }
    filtered.forEach((channel, index) => {
      let view = this.#rows.get(channel.id);
      if (!view) {
        view = new ChannelRowView(this.#document, channel.id, localizer);
        this.#rows.set(channel.id, view);
      }
      view.render(channel, blocked);
      if (list.children[index] !== view.row) list.insertBefore(view.row, list.children[index] || null);
    });
    // Keyed updates retain channel controls and restore focus if a live-state reorder moves them.
    if (activeElement instanceof HTMLElement) {
      if (activeElement !== this.#document.body && activeElement.isConnected && this.#document.activeElement !== activeElement) {
        activeElement.focus({ preventScroll: true });
      } else if (!activeElement.isConnected && activeElement.closest(".channel-card")) {
        this.controls.search.focus({ preventScroll: true });
      }
    }
    if (!channels.length) {
      this.showEmpty(localizer.t("firstChannel"), localizer.t("firstChannelHelp"), blocked, { label: localizer.t("addChannel"), type: "add" });
    } else if (!filtered.length) {
      const description = localizer.t(library.query ? "searchHelp" : library.filter === "live" ? "noLiveHelp" : "noOfflineHelp");
      this.showEmpty(localizer.t(library.query ? "noSearchResults" : library.filter === "live" ? "noLiveChannels" : "noOfflineChannels"), description, blocked, { label: localizer.t("showAll"), type: "clear" });
    }
    this.#footnote.hidden = !filtered.length;
    setText(this.#announcement, localizer.t("channelAnnouncement", { count: localizer.number(filtered.length) }));
  }

  renderControls(blocked: boolean, operation: string | null, checking: boolean): void {
    this.controls.refresh.disabled = blocked || checking;
    setText(this.controls.refreshLabel, this.#localizer.t(operation === "refresh" ? "requestPending" : checking ? "checking" : "checkNow"));
    for (const view of this.#rows.values()) view.setBlocked(blocked);
  }

  private showEmpty(title: string, description: string, blocked: boolean, action?: EmptyAction): void {
    this.#empty.panel.hidden = false;
    setText(this.#empty.title, title);
    setText(this.#empty.description, description);
    this.controls.emptyAction.hidden = !action;
    if (action) {
      setText(this.controls.emptyAction, action.label);
      this.controls.emptyAction.dataset.action = action.type;
      this.controls.emptyAction.disabled = blocked;
    }
  }

  private showLoading(): void {
    const { list } = this.controls;
    if (list.querySelector(".loading-card")) return;
    list.replaceChildren();
    for (let index = 0; index < 3; index += 1) {
      const card = createElement(this.#document, "div", "loading-card");
      card.setAttribute("aria-hidden", "true");
      const lines = createElement(this.#document, "div", "loading-lines");
      lines.append(createElement(this.#document, "span"), createElement(this.#document, "span"));
      card.append(createElement(this.#document, "span", "loading-avatar"), lines);
      list.append(card);
    }
  }
}
