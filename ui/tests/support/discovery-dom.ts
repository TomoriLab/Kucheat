export class DiscoveryElement extends EventTarget {
  readonly localName: string;
  readonly children: DiscoveryElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly classList = {
    toggle: (name: string, enabled: boolean): void => {
      const values = new Set(this.className.split(" ").filter(Boolean));
      if (enabled) values.add(name); else values.delete(name);
      this.className = [...values].join(" ");
    },
  };
  readonly document: DiscoveryDocument;
  parent: DiscoveryElement | null = null;
  className = "";
  textContent = "";
  value = "";
  type = "";
  title = "";
  hidden = false;
  disabled = false;
  open = false;
  src = "";
  alt = "";
  loading = "";
  decoding = "";
  referrerPolicy = "";

  constructor(document: DiscoveryDocument, tag: string) { super(); this.document = document; this.localName = tag; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string): void { this.attributes.delete(name); if (name === "src") this.src = ""; }
  append(...nodes: DiscoveryElement[]): void {
    for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); }
  }
  remove(): void {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  contains(node: unknown): boolean { return node === this || this.children.some((child) => child.contains(node)); }
  focus(): void { this.document.activeElement = this; }
  closest(selector: string): DiscoveryElement | null {
    if (selector === "button[data-search-add]" && this.localName === "button" && this.dataset.searchAdd) return this;
    return this.parent?.closest(selector) ?? null;
  }
  showModal(): void { this.open = true; }
  close(): void { this.open = false; this.dispatchEvent(new Event("close")); }
  asElement<Tag extends keyof HTMLElementTagNameMap>(): HTMLElementTagNameMap[Tag] {
    return this as unknown as HTMLElementTagNameMap[Tag];
  }
}

export class DiscoveryDocument {
  readonly elements = new Map<string, DiscoveryElement>();
  readonly created: DiscoveryElement[] = [];
  readonly body = new DiscoveryElement(this, "body");
  activeElement: DiscoveryElement | null = null;

  constructor() {
    this.add("add-dialog", "dialog");
    this.add("streamer-search", "input");
    this.add("search-streamers", "button");
    this.add("streamer-search-more", "button");
    this.add("streamer-search-results", "div");
    this.add("streamer-search-status", "p");
    this.add("new-channel-id", "input");
    this.add("new-channel-name", "input");
  }
  createElement(tag: string): DiscoveryElement {
    const node = new DiscoveryElement(this, tag);
    this.created.push(node);
    return node;
  }
  add(identifier: string, tag: string): DiscoveryElement {
    const node = this.createElement(tag);
    this.elements.set(identifier, node);
    return node;
  }
  node(identifier: string): DiscoveryElement {
    const node = this.elements.get(identifier);
    if (!node) throw new Error(`Unknown discovery test element: ${identifier}`);
    return node;
  }
  getElementById(identifier: string): DiscoveryElement | null { return this.elements.get(identifier) ?? null; }
  asDocument(): Document { return this as unknown as Document; }
}

export class SearchKeyEvent extends Event {
  readonly key = "Enter";
  readonly isComposing: boolean;
  constructor(isComposing = false) { super("keydown", { cancelable: true, bubbles: true }); this.isComposing = isComposing; }
}
