export class SettingsElement extends EventTarget {
  readonly localName: string;
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly childNodes: { nodeType: number; textContent: string }[] = [];
  value = "";
  checked = false;
  disabled = false;
  hidden = false;
  textContent = "";
  placeholder = "";
  lang = "";
  focused = false;
  contained: unknown;

  constructor(tag: string) { super(); this.localName = tag; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  contains(node: unknown): boolean { return node === this.contained; }
  focus(): void { this.focused = true; }
}

export class SettingsDocument {
  readonly elements = new Map<string, SettingsElement>();
  readonly documentElement = new SettingsElement("html");
  activeElement: unknown = null;
  readonly #selectors = new Map<string, SettingsElement[]>();

  constructor() {
    for (const identifier of ["check-interval", "notify-offline", "client-id", "client-secret", "clear-client-secret", "auto-launch"]) this.add(identifier, "input");
    for (const identifier of ["save-settings", "reset-settings", "test-notification", "dismiss-toast", "dismiss-action-error"]) this.add(identifier, "button");
    for (const identifier of ["settings-error", "auto-launch-error", "add-error", "delete-error", "toast"]) this.add(identifier, "div");
    for (const identifier of ["secret-status", "app-version", "settings-version", "session-type", "test-button-label", "toast-message"]) this.add(identifier, "span");
    for (const identifier of ["settings-edit-status", "action-error-detail"]) this.add(identifier, "p");
    this.add("settings-form", "form");
    this.add("language", "select");
    this.add("action-error-panel", "section");
    this.add("action-error-title", "strong");
  }

  add(identifier: string, tag: string): SettingsElement {
    const node = new SettingsElement(tag);
    this.elements.set(identifier, node);
    return node;
  }

  node(identifier: string): SettingsElement {
    const node = this.elements.get(identifier);
    if (!node) throw new Error(`Unknown test element: ${identifier}`);
    return node;
  }

  getElementById(identifier: string): SettingsElement | null { return this.elements.get(identifier) ?? null; }
  querySelectorAll(selector: string): SettingsElement[] { return this.#selectors.get(selector) ?? []; }
  select(selector: string, nodes: SettingsElement[]): void { this.#selectors.set(selector, nodes); }
  asDocument(): Document { return this as unknown as Document; }
}
