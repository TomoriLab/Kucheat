import type { Dashboard, SettingsFormValues } from "../../domain/types.ts";

export class SettingsDraft {
  #values: SettingsFormValues = {
    interval: "", notifyOffline: false, clientId: "", clientSecret: "", clearClientSecret: false,
  };
  #dirty = false;
  #hydrated = false;

  get values(): SettingsFormValues { return { ...this.#values }; }
  get dirty(): boolean { return this.#dirty; }
  get hydrated(): boolean { return this.#hydrated; }

  hydrate(dashboard: Dashboard, editing = false, force = false): boolean {
    if (!force && this.#hydrated && (this.#dirty || editing)) return false;
    this.#values = {
      interval: String(dashboard.settings.check_interval_secs),
      notifyOffline: dashboard.settings.notify_offline,
      clientId: dashboard.api.client_id || "",
      clientSecret: "",
      clearClientSecret: false,
    };
    this.#dirty = false;
    this.#hydrated = true;
    return true;
  }

  update(values: SettingsFormValues, dashboard: Dashboard): void {
    this.#values = { ...values, clientSecret: values.clearClientSecret ? "" : values.clientSecret };
    this.#dirty = String(this.#values.interval) !== String(dashboard.settings.check_interval_secs)
      || this.#values.notifyOffline !== dashboard.settings.notify_offline
      || this.#values.clientId !== (dashboard.api.client_id || "")
      || Boolean(this.#values.clientSecret) || this.#values.clearClientSecret;
  }
}
