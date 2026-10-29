import { CodedError } from "../../domain/errors.ts";
import type { DesktopClient } from "../../application/ports/desktop-client.ts";
import { createChannelPayload, createSettingsPayload } from "../../domain/rules.ts";
import type { Channel, Dashboard, SettingsFormValues } from "../../domain/types.ts";
import type { NativeArguments, NativeCommand, NativeInvoke, NativeResults } from "./contracts.ts";

export class BridgeUnavailableError extends CodedError {
  constructor() {
    super("bridgeUnavailable");
    this.name = "BridgeUnavailableError";
  }
}

export class TauriDesktopClient implements DesktopClient {
  readonly #invoke: NativeInvoke | undefined;
  #pending: Promise<unknown> = Promise.resolve();

  constructor(invoke: NativeInvoke | undefined) {
    this.#invoke = invoke;
  }

  get available(): boolean { return typeof this.#invoke === "function"; }

  getDashboard(): Promise<Dashboard> { return this.call("get_dashboard"); }

  addChannel(input: string, name: string | null, channels?: readonly Pick<Channel, "id">[]): Promise<Dashboard> {
    return this.call("add_channel", createChannelPayload(input, name, channels));
  }

  removeChannel(channelId: string): Promise<Dashboard> { return this.call("remove_channel", { channelId }); }

  saveSettings(values: SettingsFormValues): Promise<Dashboard> {
    return this.call("save_settings", createSettingsPayload(values));
  }

  setAutoLaunch(enabled: boolean): Promise<Dashboard> {
    return this.call("set_auto_launch", { enabled: Boolean(enabled) });
  }

  refreshChannels(): Promise<void> { return this.call("refresh_channels"); }

  openChannel(channelId: string, live: boolean): Promise<void> {
    return this.call("open_channel", { channelId, live: Boolean(live) });
  }

  sendTestNotification(): Promise<void> { return this.call("send_test_notification"); }

  private call<Command extends NativeCommand>(
    command: Command, ...argumentsValue: NativeArguments<Command>
  ): Promise<NativeResults[Command]> {
    const invoke = this.#invoke;
    if (typeof invoke !== "function") return Promise.reject(new BridgeUnavailableError());
    // Serial calls prevent an older dashboard response from overtaking a mutation.
    const result = this.#pending.then(() => invoke(command, ...argumentsValue));
    this.#pending = result.catch(() => {});
    return result;
  }
}
