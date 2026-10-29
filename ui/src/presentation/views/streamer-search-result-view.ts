import type { ChannelSearchResult } from "../../domain/types.ts";
import type { Localizer } from "../../localization/localizer.ts";
import { createElement, setText } from "../dom/elements.ts";
import { ChannelAvatarView } from "./channel-avatar-view.ts";

export class StreamerSearchResultView {
  readonly row: HTMLElement;
  readonly add: HTMLButtonElement;
  readonly #avatar: ChannelAvatarView;
  readonly #name: HTMLHeadingElement;
  readonly #badge: HTMLSpanElement;
  readonly #followers: HTMLParagraphElement;
  readonly #registered: HTMLSpanElement;
  readonly #localizer: Localizer;

  constructor(document: Document, identifier: string, localizer: Localizer) {
    this.#localizer = localizer;
    this.row = createElement(document, "article", "streamer-search-result");
    this.row.dataset.channelId = identifier;
    this.row.setAttribute("role", "listitem");
    this.#avatar = new ChannelAvatarView(document);
    const content = createElement(document, "div", "streamer-search-copy");
    const heading = createElement(document, "div", "channel-name-row");
    this.#name = createElement(document, "h3");
    this.#badge = createElement(document, "span", "state-badge");
    this.#registered = createElement(document, "span", "caption");
    this.#followers = createElement(document, "p", "caption");
    heading.append(this.#name, this.#badge);
    content.append(heading, this.#followers, this.#registered);
    this.add = createElement(document, "button", "button secondary small");
    this.add.type = "button";
    this.add.dataset.searchAdd = identifier;
    this.row.append(this.#avatar.element, content, this.add);
  }

  render(result: ChannelSearchResult, blocked: boolean): void {
    const localizer = this.#localizer;
    this.#avatar.render(result);
    setText(this.#name, result.name || result.id);
    this.row.dataset.state = result.is_live ? "live" : "offline";
    setText(this.#badge, localizer.t(result.is_live ? "live" : "offline"));
    const count = result.follower_count;
    this.#followers.hidden = count === null;
    setText(this.#followers, count === null ? "" : localizer.t("streamerFollowers", { count: localizer.number(count) }));
    this.#registered.hidden = !result.registered;
    setText(this.#registered, localizer.t("streamerRegistered"));
    setText(this.add, localizer.t(result.registered ? "streamerRegistered" : "add"));
    this.add.setAttribute("aria-label", localizer.t(result.registered ? "streamerRegisteredLabel" : "streamerAddLabel", { name: result.name || result.id }));
    this.add.disabled = blocked || result.registered;
  }
}
