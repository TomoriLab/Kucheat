export class AvatarElement extends EventTarget {
  readonly localName: string;
  readonly children: AvatarElement[] = [];
  readonly attributes = new Map<string, string>();
  parent: AvatarElement | undefined;
  className = "";
  textContent = "";
  hidden = false;
  src = "";
  alt = "";
  loading = "";
  decoding = "";
  referrerPolicy = "";

  constructor(tag: string) {
    super();
    this.localName = tag;
  }

  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === "src") this.src = "";
  }

  append(child: AvatarElement): void {
    child.parent = this;
    this.children.push(child);
  }

  remove(): void {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = undefined;
  }
}

export class AvatarDocument {
  readonly elements: AvatarElement[] = [];

  createElement(tag: string): AvatarElement {
    const element = new AvatarElement(tag);
    this.elements.push(element);
    return element;
  }

  asDocument(): Document { return this as unknown as Document; }

  get root(): AvatarElement { return this.elements[0]!; }
  get fallback(): AvatarElement { return this.elements[1]!; }
  get images(): AvatarElement[] { return this.elements.filter((element) => element.localName === "img"); }
}
