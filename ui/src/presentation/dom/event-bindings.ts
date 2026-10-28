export class EventBindings {
  #removers: (() => void)[] = [];

  listen<EventType extends Event = Event>(
    target: EventTarget, type: string, listener: (event: EventType) => void,
  ): void {
    const callback = listener as EventListener;
    target.addEventListener(type, callback);
    this.#removers.push(() => target.removeEventListener(type, callback));
  }

  dispose(): void {
    for (const remove of this.#removers) remove();
    this.#removers = [];
  }
}
