import type { Localizer, StaticMessageKey } from "../../localization/localizer.ts";
import { setText } from "./elements.ts";

export class LocalizedDocument {
  readonly #document: Document;
  readonly #localizer: Localizer;
  readonly #bindings: (() => void)[] = [];

  constructor(document: Document, localizer: Localizer) {
    this.#document = document;
    this.#localizer = localizer;
    for (const node of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
      const key = localizer.staticKey(node.dataset.i18n || "");
      this.#bindings.push(() => setText(node, localizer.text(key)));
    }
    for (const node of document.querySelectorAll<HTMLElement>("[data-i18n-leading]")) {
      const key = localizer.staticKey(node.dataset.i18nLeading || "");
      const text = Array.from(node.childNodes).find((child) => child.nodeType === 3 && child.textContent?.trim());
      if (!text) throw new Error(`Missing localized text node: ${key}`);
      // Updating only the text node preserves icons, counters, form values, and focus.
      this.#bindings.push(() => { text.textContent = `${localizer.text(key)} `; });
    }
    for (const attribute of ["aria-label", "placeholder", "title", "alt", "content"] as const) {
      for (const node of document.querySelectorAll(`[data-i18n-${attribute}]`)) {
        const key: StaticMessageKey = localizer.staticKey(node.getAttribute(`data-i18n-${attribute}`) || "");
        this.#bindings.push(() => node.setAttribute(attribute, localizer.text(key)));
      }
    }
  }

  render(): void {
    this.#document.documentElement.lang = this.#localizer.locale;
    for (const render of this.#bindings) render();
  }
}
