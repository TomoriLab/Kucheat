import type { ErrorTarget } from "../../application/ports/presentation.ts";
import { errorText } from "../../domain/rules.ts";
import { element, setText } from "../dom/elements.ts";

export class FeedbackView {
  readonly controls;
  readonly #document: Document;
  readonly #toast;
  readonly #message;
  readonly #actionError;
  readonly #actionTitle;
  readonly #actionDetail;
  readonly #errors;

  constructor(document: Document) {
    this.#document = document;
    this.controls = {
      dismissToast: element(document, "dismiss-toast", "button"),
      dismissError: element(document, "dismiss-action-error", "button"),
    };
    this.#toast = element(document, "toast", "div");
    this.#message = element(document, "toast-message", "span");
    this.#actionError = element(document, "action-error-panel", "section");
    this.#actionTitle = element(document, "action-error-title", "strong");
    this.#actionDetail = element(document, "action-error-detail", "p");
    this.#errors = {
      "add-error": element(document, "add-error", "div"),
      "delete-error": element(document, "delete-error", "div"),
      "settings-error": element(document, "settings-error", "div"),
    };
  }

  get toastFocused(): boolean { return this.#toast.contains(this.#document.activeElement); }
  hideToast(): void { this.#toast.hidden = true; }
  hideActionError(): void { this.#actionError.hidden = true; }
  clearError(target: ErrorTarget): void { this.#errors[target].hidden = true; }

  displayError(target: ErrorTarget, context: string, error: unknown): void {
    setText(this.#errors[target], `${context}\n${errorText(error)}`);
    this.#errors[target].hidden = false;
  }

  showActionError(context: string, error: unknown): void {
    this.hideToast();
    setText(this.#actionTitle, context);
    setText(this.#actionDetail, errorText(error));
    this.#actionError.hidden = false;
  }

  showToast(message: string): void {
    this.hideActionError();
    setText(this.#message, message);
    this.#toast.hidden = false;
  }
}
