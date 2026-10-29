import type { ErrorTarget } from "../../application/ports/presentation.ts";
import { resolveText } from "../../localization/localizer.ts";
import type { LocalizedText, Localizer } from "../../localization/localizer.ts";
import { element, setText } from "../dom/elements.ts";

interface ErrorMessage {
  context: LocalizedText;
  error: unknown;
}

export class FeedbackView {
  readonly controls;
  readonly #document: Document;
  readonly #localizer: Localizer;
  readonly #toast;
  readonly #message;
  readonly #actionError;
  readonly #actionTitle;
  readonly #actionDetail;
  readonly #errors;
  readonly #inlineMessages = new Map<ErrorTarget, ErrorMessage>();
  #toastMessage: LocalizedText | undefined;
  #actionMessage: ErrorMessage | undefined;

  constructor(document: Document, localizer: Localizer) {
    this.#document = document;
    this.#localizer = localizer;
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
  clearError(target: ErrorTarget): void { this.#errors[target].hidden = true; this.#inlineMessages.delete(target); }

  displayError(target: ErrorTarget, context: LocalizedText, error: unknown): void {
    this.#inlineMessages.set(target, { context, error });
    this.#errors[target].hidden = false;
    this.render();
  }

  showActionError(context: LocalizedText, error: unknown): void {
    this.hideToast();
    this.#actionMessage = { context, error };
    this.#actionError.hidden = false;
    this.render();
  }

  showToast(message: LocalizedText): void {
    this.hideActionError();
    this.#toastMessage = message;
    this.#toast.hidden = false;
    this.render();
  }

  render(): void {
    if (this.#toastMessage && !this.#toast.hidden) setText(this.#message, resolveText(this.#toastMessage));
    if (this.#actionMessage && !this.#actionError.hidden) {
      setText(this.#actionTitle, resolveText(this.#actionMessage.context));
      setText(this.#actionDetail, this.#localizer.error(this.#actionMessage.error));
    }
    for (const [target, message] of this.#inlineMessages) {
      if (!this.#errors[target].hidden) setText(this.#errors[target], this.#localizer.t("errorDetails", {
        context: resolveText(message.context), error: this.#localizer.error(message.error),
      }));
    }
  }
}
