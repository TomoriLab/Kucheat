export interface Channel {
  id: string;
  name: string;
  channel_image_url: string | null;
  is_live: boolean | null;
  live_title: string | null;
  category: string | null;
  viewer_count: number | null;
  last_checked: string | null;
  went_live_at: string | null;
}

export interface Settings {
  check_interval_secs: number;
  notify_offline: boolean;
  language?: LanguagePreference;
}

export interface ApiCredentials {
  client_id: string;
  has_client_secret: boolean;
}

export interface Monitor {
  running: boolean;
  checking: boolean;
  last_error: string | null;
  last_checked: string | null;
  host: string | null;
}

export interface Dashboard {
  channels: Channel[];
  settings: Settings;
  api: ApiCredentials;
  auto_launch: boolean;
  auto_launch_error: string | null;
  monitor: Monitor;
  session_type: "wayland" | "x11" | "unknown";
  version: string;
}

export interface AddChannelPayload {
  channelId: string;
  name: string | null;
}

export interface RemoveChannelPayload {
  channelId: string;
}

export interface SaveSettingsPayload {
  settings: Settings & {
    client_id: string;
    client_secret: string | null;
    clear_client_secret: boolean;
  };
}

export interface SetAutoLaunchPayload {
  enabled: boolean;
}

export interface OpenChannelPayload {
  channelId: string;
  live: boolean;
}

export interface SettingsFormValues {
  interval: string | number;
  notifyOffline: boolean;
  clientId: string;
  clientSecret: string | null;
  clearClientSecret: boolean;
  language?: LanguagePreference;
}

export type ChannelState = "live" | "offline" | "unknown";
export type ChannelFilter = "all" | ChannelState;
export type ChannelCounts = Record<ChannelFilter, number>;
export type Theme = "system" | "light" | "dark";

export type Locale = "ko" | "en" | "ja" | "zh-TW";
export type LanguagePreference = "system" | Locale;

export interface ChannelSearchPayload {
  query: string;
  offset: number;
}

export interface ChannelSearchResult {
  id: string;
  name: string;
  channel_image_url: string | null;
  is_live: boolean;
  follower_count: number | null;
  registered: boolean;
}

export interface ChannelSearchResults {
  channels: ChannelSearchResult[];
  next_offset: number | null;
}
