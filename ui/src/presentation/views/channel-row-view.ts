import { channelState } from "../../domain/rules.ts";
import type { Localizer } from "../../localization/localizer.ts";
import type { Channel } from "../../domain/types.ts";
import { createAction, createElement, setText } from "../dom/elements.ts";
import { ChannelAvatarView } from "./channel-avatar-view.ts";

export class ChannelRowView {
  readonly row: HTMLElement;
  readonly #avatar: ChannelAvatarView;
  readonly #name: HTMLHeadingElement;
  readonly #badge: HTMLSpanElement;
  readonly #title: HTMLParagraphElement;
  readonly #category: HTMLSpanElement;
  readonly #viewers: HTMLSpanElement;
  readonly #checked: HTMLSpanElement;
  readonly #watch: HTMLButtonElement;
  readonly #open: HTMLButtonElement;
  readonly #remove: HTMLButtonElement;
  readonly #localizer: Localizer;
  readonly #watchLabel: HTMLSpanElement;

  constructor(document: Document, identifier: string, localizer: Localizer) {
    this.#localizer = localizer;
    this.row = createElement(document, "article", "channel-card");
    this.row.setAttribute("role", "listitem");
    this.row.dataset.channelId = identifier;
    this.#avatar = new ChannelAvatarView(document);
    const content = createElement(document, "div", "channel-content");
    const nameRow = createElement(document, "div", "channel-name-row");
    this.#name = createElement(document, "h3");
    this.#badge = createElement(document, "span", "state-badge");
    nameRow.append(this.#name, this.#badge);
    this.#title = createElement(document, "p", "channel-title");
    const metadata = createElement(document, "div", "channel-meta");
    this.#category = createElement(document, "span");
    this.#viewers = createElement(document, "span");
    this.#checked = createElement(document, "span", "channel-last-check");
    metadata.append(this.#category, this.#viewers, this.#checked);
    content.append(nameRow, this.#title, metadata);
    const actions = createElement(document, "div", "channel-actions");
    this.#watch = createAction(document, "button small watch-button", "play", localizer.t("watchLive"));
    this.#watchLabel = createElement(document, "span", "", localizer.t("watchLive"));
    this.#watch.append(this.#watchLabel);
    this.#open = createAction(document, "icon-button", "open", localizer.t("openChannel"));
    this.#remove = createAction(document, "icon-button delete-channel", "delete", localizer.t("deleteChannel"));
    this.#watch.dataset.channelAction = "watch";
    this.#open.dataset.channelAction = "open";
    this.#remove.dataset.channelAction = "delete";
    actions.append(this.#watch, this.#open, this.#remove);
    this.row.append(this.#avatar.element, content, actions);
  }

  render(channel: Channel, blocked: boolean): void {
    const localizer = this.#localizer;
    const status = channelState(channel);
    const displayName = channel.name || channel.id;
    this.row.dataset.state = status;
    this.#avatar.render(channel);
    setText(this.#name, displayName);
    setText(this.#badge, localizer.t(status));
    setText(this.#title, status === "live" ? channel.live_title || localizer.t("noStreamTitle")
      : localizer.t(status === "offline" ? "channelOffline" : "channelUnchecked"));
    setText(this.#category, channel.category || localizer.t("noCategory"));
    this.#category.hidden = status !== "live";
    setText(this.#viewers, localizer.viewers(channel.viewer_count));
    this.#viewers.hidden = status !== "live";
    setText(this.#checked, channel.last_checked ? localizer.t("lastChecked", { time: localizer.timestamp(channel.last_checked) }) : localizer.t("neverChecked"));
    this.#checked.title = channel.last_checked || "";
    this.#watch.hidden = status !== "live";
    setText(this.#watchLabel, localizer.t("watchLive"));
    const actions: [HTMLButtonElement, "watchChannelLabel" | "openChannelLabel" | "deleteChannelLabel"][] = [
      [this.#watch, "watchChannelLabel"], [this.#open, "openChannelLabel"], [this.#remove, "deleteChannelLabel"],
    ];
    for (const [button, action] of actions) {
      const label = localizer.t(action, { name: displayName });
      button.setAttribute("aria-label", label);
      button.title = label;
    }
    this.setBlocked(blocked);
  }

  setBlocked(blocked: boolean): void {
    for (const button of [this.#watch, this.#open, this.#remove]) button.disabled = blocked;
  }
}
