import type { Scheduler } from "../../application/ports/presentation.ts";

export class BrowserScheduler implements Scheduler {
  schedule(callback: () => void, milliseconds: number): () => void {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  }
}
