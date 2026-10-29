import { normalizeLanguage } from "../../domain/language.ts";
import type { Dashboard, SettingsFormValues } from "../../domain/types.ts";

export class SettingsDraft {
  #values: SettingsFormValues = {
    interval: "", notifyOffline: false, clientId: "", clientSecret: "", clearClientSecret: false, language: "system",
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
      language: normalizeLanguage(dashboard.settings.language),
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
      || Boolean(this.#values.clientSecret) || this.#values.clearClientSecret
      || normalizeLanguage(this.#values.language) !== normalizeLanguage(dashboard.settings.language);
  }

  acceptSaved(dashboard: Dashboard, submitted: SettingsFormValues, current: SettingsFormValues = this.#values): void {
    this.hydrate(dashboard, false, true);
    const saved = this.values;
    // A language update must not erase edits made after the save request began.
    this.update({
      interval: String(current.interval) === String(submitted.interval) ? saved.interval : current.interval,
      notifyOffline: current.notifyOffline === submitted.notifyOffline ? saved.notifyOffline : current.notifyOffline,
      clientId: current.clientId === submitted.clientId ? saved.clientId : current.clientId,
      clientSecret: current.clientSecret === submitted.clientSecret ? saved.clientSecret : current.clientSecret,
      clearClientSecret: current.clearClientSecret === submitted.clearClientSecret ? saved.clearClientSecret : current.clearClientSecret,
      language: normalizeLanguage(current.language) === normalizeLanguage(submitted.language) ? saved.language : current.language,
    }, dashboard);
  }
}
