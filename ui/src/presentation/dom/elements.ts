export function element<Tag extends keyof HTMLElementTagNameMap>(
  document: Document, identifier: string, tag: Tag,
): HTMLElementTagNameMap[Tag] {
  const node = document.getElementById(identifier);
  if (!node || node.localName !== tag) throw new Error(`Required interface element not found: ${identifier}`);
  return node as HTMLElementTagNameMap[Tag];
}

export function setText(node: Element, value: unknown): void {
  const text = String(value ?? "");
  if (node.textContent !== text) node.textContent = text;
}

export function createElement<Tag extends keyof HTMLElementTagNameMap>(
  document: Document, tag: Tag, className?: string, text?: string,
): HTMLElementTagNameMap[Tag] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createAction(document: Document, className: string, iconName: string, label: string): HTMLButtonElement {
  const button = createElement(document, "button", className);
  button.type = "button";
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.classList.add("icon");
  icon.setAttribute("aria-hidden", "true");
  const reference = document.createElementNS("http://www.w3.org/2000/svg", "use");
  reference.setAttribute("href", `#icon-${iconName}`);
  icon.append(reference);
  button.append(icon);
  button.setAttribute("aria-label", label);
  button.title = label;
  return button;
}

export function isDisabled(control: HTMLElement): boolean {
  return "disabled" in control && control.disabled === true;
}
