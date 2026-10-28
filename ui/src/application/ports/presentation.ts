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
  clearError(target: ErrorTarget): void;
  displayError(target: ErrorTarget, context: string, error: unknown): void;
  showActionError(context: string, error: unknown): void;
  showToast(message: string): void;
}

export interface Scheduler {
  schedule(callback: () => void, milliseconds: number): () => void;
}
