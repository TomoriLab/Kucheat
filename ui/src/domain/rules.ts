import { CodedError } from "./errors.ts";
import { isLanguagePreference } from "./language.ts";
import type {
  AddChannelPayload, Channel, ChannelCounts, ChannelFilter, ChannelState,
  SaveSettingsPayload, SettingsFormValues, Theme,
} from "./types.ts";

const channelIdentifierPattern = /^[a-f\d]{32}$/i;

export const minimumInterval = 15;
export const maximumInterval = 86400;
export const themes: readonly Theme[] = Object.freeze(["system", "light", "dark"]);

export function parseChannelInput(input: string): string {
  const value = String(input ?? "").trim();
  if (channelIdentifierPattern.test(value)) return value.toLowerCase();

  let address: URL;
  try {
    address = new URL(value.startsWith("chzzk.naver.com/") ? `https://${value}` : value);
  } catch {
    throw new CodedError("invalidChannelInput");
  }

  if (!["https:", "http:"].includes(address.protocol)
      || address.hostname !== "chzzk.naver.com"
      || address.username || address.password || address.port) {
    throw new CodedError("invalidChannelHost");
  }

  const identifier = address.pathname.match(/^\/(?:live\/)?([a-f\d]{32})\/?$/i)?.[1];
  if (!identifier) throw new CodedError("missingChannelId");
  return identifier.toLowerCase();
}

export function createChannelPayload(
  input: string, name: string | null, channels: readonly Pick<Channel, "id">[] = [],
): AddChannelPayload {
  const channelId = parseChannelInput(input);
  if (channels.some((channel) => channel.id.toLowerCase() === channelId)) {
    throw new CodedError("duplicateChannel");
  }
  const displayName = String(name ?? "").trim();
  if (displayName.length > 80) throw new CodedError("longChannelName");
  return { channelId, name: displayName || null };
}

export function createSettingsPayload(values: SettingsFormValues): SaveSettingsPayload {
  const intervalText = String(values.interval ?? "").trim();
  const interval = Number(intervalText);
  if (!/^\d+$/.test(intervalText) || !Number.isSafeInteger(interval)
      || interval < minimumInterval || interval > maximumInterval) {
    throw new CodedError("invalidInterval");
  }
  const secret = String(values.clientSecret ?? "").trim();
  const clearSecret = Boolean(values.clearClientSecret);
  if (secret && clearSecret) throw new CodedError("conflictingSecret");
  if (values.language !== undefined && !isLanguagePreference(values.language)) throw new CodedError("invalidLanguage");
  return {
    settings: {
      check_interval_secs: interval,
      notify_offline: Boolean(values.notifyOffline),
      client_id: String(values.clientId ?? "").trim(),
      client_secret: secret || null,
      clear_client_secret: clearSecret,
      ...(values.language === undefined ? {} : { language: values.language }),
    },
  };
}

export function profileImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const address = new URL(value);
    if (address.protocol !== "https:" || !address.hostname.endsWith(".pstatic.net")
        || address.username || address.password || address.port) return null;
    return address.href;
  } catch {
    return null;
  }
}

export function channelState(channel: Pick<Channel, "is_live">): ChannelState {
  if (channel.is_live === true) return "live";
  if (channel.is_live === false) return "offline";
  return "unknown";
}

export function channelCounts(channels: readonly Channel[]): ChannelCounts {
  return channels.reduce<ChannelCounts>((counts, channel) => {
    counts.all += 1;
    counts[channelState(channel)] += 1;
    return counts;
  }, { all: 0, live: 0, offline: 0, unknown: 0 });
}

export function filterChannels(
  channels: readonly Channel[], query = "", filter: ChannelFilter = "all", locale = "ko",
): Channel[] {
  const needle = query.trim().toLocaleLowerCase(locale);
  const order: Record<ChannelState, number> = { live: 0, unknown: 1, offline: 2 };
  return channels.filter((channel) => {
    if (filter !== "all" && channelState(channel) !== filter) return false;
    return !needle || [channel.name, channel.id, channel.live_title, channel.category]
      .some((value) => String(value ?? "").toLocaleLowerCase(locale).includes(needle));
  }).sort((first, second) => order[channelState(first)] - order[channelState(second)]
    || (first.name || first.id).localeCompare(second.name || second.id, locale));
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) || "Unknown error";
  } catch {
    return "Unknown error";
  }
}


export function normalizeTheme(value: unknown): Theme {
  return themes.find((theme) => theme === value) ?? "system";
}
