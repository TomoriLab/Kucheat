import type { Channel, ChannelSearchResults, Dashboard, SettingsFormValues } from "../../domain/types.ts";

export interface DesktopClient {
  readonly available: boolean;
  getDashboard(): Promise<Dashboard>;
  searchChannels(query: string, offset?: number): Promise<ChannelSearchResults>;
  addChannel(input: string, name: string | null, channels?: readonly Pick<Channel, "id">[]): Promise<Dashboard>;
  removeChannel(channelId: string): Promise<Dashboard>;
  saveSettings(values: SettingsFormValues): Promise<Dashboard>;
  setAutoLaunch(enabled: boolean): Promise<Dashboard>;
  refreshChannels(): Promise<void>;
  openChannel(channelId: string, live: boolean): Promise<void>;
  sendTestNotification(): Promise<void>;
}
