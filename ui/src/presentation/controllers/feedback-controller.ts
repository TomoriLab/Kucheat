import type { ErrorTarget, Feedback, Scheduler } from "../../application/ports/presentation.ts";
import { EventBindings } from "../dom/event-bindings.ts";
import type { FeedbackView } from "../views/feedback-view.ts";

export class FeedbackController implements Feedback {
  readonly #view: FeedbackView;
  readonly #scheduler: Scheduler;
  readonly #events = new EventBindings();
  #cancelToast: (() => void) | undefined;

  constructor(view: FeedbackView, scheduler: Scheduler) {
    this.#view = view;
    this.#scheduler = scheduler;
  }

  start(): void {
    this.#events.listen(this.#view.controls.dismissToast, "click", () => this.#view.hideToast());
    this.#events.listen(this.#view.controls.dismissError, "click", () => this.#view.hideActionError());
  }

  dispose(): void {
    this.#events.dispose();
    this.#cancelToast?.();
    this.#cancelToast = undefined;
  }

  clearError(target: ErrorTarget): void { this.#view.clearError(target); }
  displayError(target: ErrorTarget, context: string, error: unknown): void { this.#view.displayError(target, context, error); }
  showActionError(context: string, error: unknown): void { this.#view.showActionError(context, error); }

  showToast(message: string): void {
    this.#cancelToast?.();
    this.#view.showToast(message);
    this.#cancelToast = this.#scheduler.schedule(() => {
      if (!this.#view.toastFocused) this.#view.hideToast();
    }, 6000);
  }
}
