import type { LocalizedText } from "../../localization/localizer.ts";

export type ErrorTarget = "add-error" | "delete-error" | "settings-error";

export interface ScreenController {
  start(): void;
  dispose(): void;
  render?(resetSettings?: boolean): void;
  renderControls?(): void;
}

export interface ApplicationView {
  render(): void;
  renderControls(): void;
  captureFocus(): () => void;
}

export interface Feedback {
  start(): void;
  dispose(): void;
  render?(): void;
  clearError(target: ErrorTarget): void;
  displayError(target: ErrorTarget, context: LocalizedText, error: unknown): void;
  showActionError(context: LocalizedText, error: unknown): void;
  showToast(message: LocalizedText): void;
}

export interface Scheduler {
  schedule(callback: () => void, milliseconds: number): () => void;
}
