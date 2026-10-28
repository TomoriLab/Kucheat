import type { DesktopClient } from "../../src/application/ports/desktop-client.ts";
import type { ApplicationView, ErrorTarget, Feedback, Scheduler, ScreenController } from "../../src/application/ports/presentation.ts";
import type { Dashboard } from "../../src/domain/types.ts";
import { dashboard } from "./dashboard.ts";

export class Deferred<Value> {
  readonly promise: Promise<Value>;
  resolve!: (value: Value) => void;
  reject!: (error: unknown) => void;

  constructor() {
    this.promise = new Promise<Value>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

export class FakeDesktopClient implements DesktopClient {
  available = true;
  readonly requests: Deferred<Dashboard>[] = [];

  getDashboard(): Promise<Dashboard> {
    const request = new Deferred<Dashboard>();
    this.requests.push(request);
    return request.promise;
  }

  async addChannel(): Promise<Dashboard> { return dashboard(); }
  async removeChannel(): Promise<Dashboard> { return dashboard(); }
  async saveSettings(): Promise<Dashboard> { return dashboard(); }
  async setAutoLaunch(): Promise<Dashboard> { return dashboard(); }
  async refreshChannels(): Promise<void> {}
  async openChannel(): Promise<void> {}
  async sendTestNotification(): Promise<void> {}
}

export class ManualScheduler implements Scheduler {
  readonly tasks = new Map<number, { callback: () => void; milliseconds: number }>();
  #identifier = 0;

  schedule(callback: () => void, milliseconds: number): () => void {
    const identifier = ++this.#identifier;
    this.tasks.set(identifier, { callback, milliseconds });
    return () => { this.tasks.delete(identifier); };
  }

  fire(): void {
    const next = this.tasks.entries().next().value;
    if (!next) throw new Error("No scheduled task is available.");
    this.tasks.delete(next[0]);
    next[1].callback();
  }
}

export class RecordingView implements ApplicationView {
  renders = 0;
  controls = 0;
  restoredFocus = 0;
  render(): void { this.renders += 1; }
  renderControls(): void { this.controls += 1; }
  captureFocus(): () => void { return () => { this.restoredFocus += 1; }; }
}

export class RecordingScreen implements ScreenController {
  starts = 0;
  disposals = 0;
  readonly resets: boolean[] = [];
  controls = 0;
  start(): void { this.starts += 1; }
  dispose(): void { this.disposals += 1; }
  render(resetSettings = false): void { this.resets.push(resetSettings); }
  renderControls(): void { this.controls += 1; }
}

export class RecordingFeedback implements Feedback {
  starts = 0;
  disposals = 0;
  readonly messages: string[] = [];
  readonly errors: { target: ErrorTarget | null; context: string; error: unknown }[] = [];
  readonly cleared: ErrorTarget[] = [];
  start(): void { this.starts += 1; }
  dispose(): void { this.disposals += 1; }
  clearError(target: ErrorTarget): void { this.cleared.push(target); }
  displayError(target: ErrorTarget, context: string, error: unknown): void { this.errors.push({ target, context, error }); }
  showActionError(context: string, error: unknown): void { this.errors.push({ target: null, context, error }); }
  showToast(message: string): void { this.messages.push(message); }
}

export async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
