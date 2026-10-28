import { profileImageUrl } from "../../domain/rules.ts";
import type { Channel } from "../../domain/types.ts";
import { createElement, setText } from "../dom/elements.ts";

export class ChannelAvatarView {
  readonly element: HTMLSpanElement;
  readonly #document: Document;
  readonly #fallback: HTMLSpanElement;
  #image: HTMLImageElement | undefined;
  #url: string | null = null;

  constructor(document: Document) {
    this.#document = document;
    this.element = createElement(document, "span", "channel-avatar");
    this.element.setAttribute("aria-hidden", "true");
    this.#fallback = createElement(document, "span", "channel-avatar-fallback");
    this.element.append(this.#fallback);
  }

  render(channel: Pick<Channel, "id" | "name" | "channel_image_url">): void {
    const displayName = channel.name || channel.id;
    setText(this.#fallback, Array.from(displayName)[0]?.toLocaleUpperCase("ko-KR") || "?");
    const url = profileImageUrl(channel.channel_image_url);
    // Dashboard polling must not reload an unchanged image or repeatedly request a failed URL.
    if (url === this.#url) return;
    this.#url = url;
    const previous = this.#image;
    this.#image = undefined;
    previous?.remove();
    previous?.removeAttribute("src");
    this.#fallback.hidden = false;
    if (!url) return;
    const image = createElement(this.#document, "img", "channel-avatar-image");
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    this.#image = image;
    image.addEventListener("load", () => {
      if (this.#image !== image) return;
      image.className = "channel-avatar-image is-loaded";
      this.#fallback.hidden = true;
    }, { once: true });
    image.addEventListener("error", () => {
      if (this.#image !== image) return;
      image.className = "channel-avatar-image";
      this.#fallback.hidden = false;
    }, { once: true });
    this.element.append(image);
    image.src = url;
  }
}
