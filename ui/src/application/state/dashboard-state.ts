import { errorText } from "../../domain/rules.ts";
import type { Dashboard } from "../../domain/types.ts";

export type Operation = "add" | "delete" | "save" | "auto-launch" | "refresh" | "open" | "test";

export class DashboardState {
  #dashboard: Dashboard | null = null;
  #loading = false;
  #connectionError: string | null = null;
  #operation: Operation | null = null;
  #autoLaunchError: string | null = null;

  get dashboard(): Dashboard | null { return this.#dashboard; }
  get loading(): boolean { return this.#loading; }
  get connectionError(): string | null { return this.#connectionError; }
  get operation(): Operation | null { return this.#operation; }
  get autoLaunchError(): string | null { return this.#autoLaunchError; }

  accept(dashboard: Dashboard | void): void {
    if (!dashboard || !Array.isArray(dashboard.channels) || !dashboard.settings || !dashboard.api || !dashboard.monitor) {
      throw new Error("앱에서 올바르지 않은 Dashboard 응답을 받았습니다.");
    }
    this.#dashboard = dashboard;
    this.#connectionError = null;
  }

  beginLoading(): void { this.#loading = true; }
  endLoading(): void { this.#loading = false; }
  failConnection(error: unknown): void { this.#connectionError = errorText(error); }

  beginOperation(operation: Operation): boolean {
    if (this.#operation) return false;
    this.#operation = operation;
    return true;
  }

  endOperation(): void { this.#operation = null; }
  setAutoLaunchError(error: unknown): void { this.#autoLaunchError = error === null ? null : errorText(error); }
}
