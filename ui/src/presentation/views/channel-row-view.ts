import { channelState, formatTimestamp, formatViewerCount } from "../../domain/rules.ts";
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

  constructor(document: Document, identifier: string) {
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
    this.#watch = createAction(document, "button small watch-button", "play", "라이브 보기");
    this.#watch.append(createElement(document, "span", "", "라이브 보기"));
    this.#open = createAction(document, "icon-button", "open", "채널 페이지 열기");
    this.#remove = createAction(document, "icon-button delete-channel", "delete", "채널 삭제");
    this.#watch.dataset.channelAction = "watch";
    this.#open.dataset.channelAction = "open";
    this.#remove.dataset.channelAction = "delete";
    actions.append(this.#watch, this.#open, this.#remove);
    this.row.append(this.#avatar.element, content, actions);
  }

  render(channel: Channel, blocked: boolean): void {
    const status = channelState(channel);
    const displayName = channel.name || channel.id;
    this.row.dataset.state = status;
    this.#avatar.render(channel);
    setText(this.#name, displayName);
    setText(this.#badge, { live: "라이브", offline: "오프라인", unknown: "확인 전" }[status]);
    setText(this.#title, status === "live" ? channel.live_title || "방송 제목 미제공"
      : status === "offline" ? "지금은 방송 중이 아닙니다." : "아직 방송 상태를 확인하지 않았습니다.");
    setText(this.#category, channel.category || "카테고리 미제공");
    this.#category.hidden = status !== "live";
    setText(this.#viewers, formatViewerCount(channel.viewer_count));
    this.#viewers.hidden = status !== "live";
    setText(this.#checked, channel.last_checked ? `최근 확인 ${formatTimestamp(channel.last_checked)}` : "아직 확인하지 않음");
    this.#checked.title = channel.last_checked || "";
    this.#watch.hidden = status !== "live";
    const actions: [HTMLButtonElement, string][] = [
      [this.#watch, "라이브 보기"], [this.#open, "채널 페이지 열기"], [this.#remove, "채널 삭제"],
    ];
    for (const [button, action] of actions) {
      const label = `${displayName} · ${action}`;
      button.setAttribute("aria-label", label);
      button.title = label;
    }
    this.setBlocked(blocked);
  }

  setBlocked(blocked: boolean): void {
    for (const button of [this.#watch, this.#open, this.#remove]) button.disabled = blocked;
  }
}
