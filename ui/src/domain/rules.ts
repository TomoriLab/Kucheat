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
    throw new Error("32자리 채널 ID 또는 CHZZK 채널·라이브 주소를 입력해 주세요.");
  }

  if (!["https:", "http:"].includes(address.protocol)
      || address.hostname !== "chzzk.naver.com"
      || address.username || address.password || address.port) {
    throw new Error("chzzk.naver.com의 채널 또는 라이브 주소만 사용할 수 있습니다.");
  }

  const identifier = address.pathname.match(/^\/(?:live\/)?([a-f\d]{32})\/?$/i)?.[1];
  if (!identifier) throw new Error("주소에서 채널 ID를 찾을 수 없습니다. 채널 또는 라이브 주소를 확인해 주세요.");
  return identifier.toLowerCase();
}

export function createChannelPayload(
  input: string, name: string | null, channels: readonly Pick<Channel, "id">[] = [],
): AddChannelPayload {
  const channelId = parseChannelInput(input);
  if (channels.some((channel) => channel.id.toLowerCase() === channelId)) {
    throw new Error("이미 등록한 채널입니다.");
  }
  const displayName = String(name ?? "").trim();
  if (displayName.length > 80) throw new Error("표시 이름은 80자 이내로 입력해 주세요.");
  return { channelId, name: displayName || null };
}

export function createSettingsPayload(values: SettingsFormValues): SaveSettingsPayload {
  const intervalText = String(values.interval ?? "").trim();
  const interval = Number(intervalText);
  if (!/^\d+$/.test(intervalText) || !Number.isSafeInteger(interval)
      || interval < minimumInterval || interval > maximumInterval) {
    throw new Error("확인 간격은 15~86,400초 사이의 정수로 입력해 주세요.");
  }
  const secret = String(values.clientSecret ?? "").trim();
  const clearSecret = Boolean(values.clearClientSecret);
  if (secret && clearSecret) throw new Error("새 Client Secret 입력과 저장된 Secret 삭제 중 하나만 선택해 주세요.");
  return {
    settings: {
      check_interval_secs: interval,
      notify_offline: Boolean(values.notifyOffline),
      client_id: String(values.clientId ?? "").trim(),
      client_secret: secret || null,
      clear_client_secret: clearSecret,
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
  channels: readonly Channel[], query = "", filter: ChannelFilter = "all",
): Channel[] {
  const needle = query.trim().toLocaleLowerCase("ko-KR");
  const order: Record<ChannelState, number> = { live: 0, unknown: 1, offline: 2 };
  return channels.filter((channel) => {
    if (filter !== "all" && channelState(channel) !== filter) return false;
    return !needle || [channel.name, channel.id, channel.live_title, channel.category]
      .some((value) => String(value ?? "").toLocaleLowerCase("ko-KR").includes(needle));
  }).sort((first, second) => order[channelState(first)] - order[channelState(second)]
    || (first.name || first.id).localeCompare(second.name || second.id, "ko"));
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) || "알 수 없는 오류";
  } catch {
    return "알 수 없는 오류";
  }
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "아직 확인하지 않음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "확인 시간 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

export function formatViewerCount(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? `${new Intl.NumberFormat("ko-KR").format(Math.floor(value))}명 시청` : "시청자 수 미제공";
}

export function normalizeTheme(value: unknown): Theme {
  return themes.find((theme) => theme === value) ?? "system";
}
