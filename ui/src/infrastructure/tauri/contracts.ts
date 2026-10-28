import type {
  AddChannelPayload, Dashboard, OpenChannelPayload, RemoveChannelPayload,
  SaveSettingsPayload, SetAutoLaunchPayload,
} from "../../domain/types.ts";

export interface NativePayloads {
  get_dashboard: undefined;
  add_channel: AddChannelPayload;
  remove_channel: RemoveChannelPayload;
  save_settings: SaveSettingsPayload;
  set_auto_launch: SetAutoLaunchPayload;
  refresh_channels: undefined;
  open_channel: OpenChannelPayload;
  send_test_notification: undefined;
}

export interface NativeResults {
  get_dashboard: Dashboard;
  add_channel: Dashboard;
  remove_channel: Dashboard;
  save_settings: Dashboard;
  set_auto_launch: Dashboard;
  refresh_channels: void;
  open_channel: void;
  send_test_notification: void;
}

export type NativeCommand = keyof NativePayloads;
export type NativeArguments<Command extends NativeCommand> = NativePayloads[Command] extends undefined
  ? [] : [argumentsValue: NativePayloads[Command]];

export type NativeInvoke = <Command extends NativeCommand>(
  command: Command,
  ...argumentsValue: NativeArguments<Command>
) => Promise<NativeResults[Command]>;

export interface TauriBridge {
  core: { invoke: NativeInvoke };
}

declare global {
  interface Window {
    __TAURI__?: TauriBridge;
  }
}
