import { CodedError } from "../../domain/errors.ts";
import type { Dashboard } from "../../domain/types.ts";

export type Operation = "add" | "delete" | "save" | "auto-launch" | "refresh" | "open" | "test";

export class DashboardState {
  #dashboard: Dashboard | null = null;
  #loading = false;
  #connectionError: unknown = null;
  #operation: Operation | null = null;
  #autoLaunchError: unknown = null;

  get dashboard(): Dashboard | null { return this.#dashboard; }
  get loading(): boolean { return this.#loading; }
  get connectionError(): unknown { return this.#connectionError; }
  get operation(): Operation | null { return this.#operation; }
  get autoLaunchError(): unknown { return this.#autoLaunchError; }

  accept(dashboard: Dashboard | void): void {
    if (!dashboard || !Array.isArray(dashboard.channels) || !dashboard.settings || !dashboard.api || !dashboard.monitor) {
      throw new CodedError("invalidDashboard");
    }
    this.#dashboard = dashboard;
    this.#connectionError = null;
  }

  beginLoading(): void { this.#loading = true; }
  endLoading(): void { this.#loading = false; }
  failConnection(error: unknown): void { this.#connectionError = this.diagnostic(error); }

  beginOperation(operation: Operation): boolean {
    if (this.#operation) return false;
    this.#operation = operation;
    return true;
  }

  endOperation(): void { this.#operation = null; }
  setAutoLaunchError(error: unknown): void { this.#autoLaunchError = error === null ? null : this.diagnostic(error); }

  private diagnostic(error: unknown): unknown {
    if (error instanceof Error && !(error instanceof CodedError)) return error.message;
    return error ?? new CodedError("unknownError");
  }
}
