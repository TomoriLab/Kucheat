import { CodedError } from "./errors.ts";
import type { ChannelSearchPayload, ChannelSearchResult, ChannelSearchResults } from "./types.ts";

export function createChannelSearchPayload(query: string, offset = 0): ChannelSearchPayload {
  const trimmed = query.trim();
  const length = Array.from(trimmed).length;
  if (length < 1 || length > 100) throw new CodedError("invalidStreamerQuery");
  if (!Number.isInteger(offset) || offset < 0 || offset > 1000) throw new CodedError("invalidSearchOffset");
  return { query: trimmed, offset };
}

export function normalizeChannelSearchResults(value: unknown, offset: number): ChannelSearchResults {
  if (!isRecord(value) || !Array.isArray(value.channels) || value.channels.length > 20
      || !(value.next_offset === null || (typeof value.next_offset === "number"
        && Number.isInteger(value.next_offset) && value.next_offset > offset && value.next_offset <= 1000))) {
    throw new CodedError("invalidSearchResults");
  }
  const channels = value.channels.map((channel): ChannelSearchResult => {
    if (!isRecord(channel) || typeof channel.id !== "string" || !/^[a-f\d]{32}$/i.test(channel.id)
        || typeof channel.name !== "string" || typeof channel.is_live !== "boolean"
        || typeof channel.registered !== "boolean"
        || !(channel.channel_image_url === null || typeof channel.channel_image_url === "string")
        || !(channel.follower_count === null || (typeof channel.follower_count === "number"
          && Number.isSafeInteger(channel.follower_count) && channel.follower_count >= 0))) {
      throw new CodedError("invalidSearchResults");
    }
    return {
      id: channel.id.toLowerCase(), name: channel.name, channel_image_url: channel.channel_image_url,
      is_live: channel.is_live, follower_count: channel.follower_count, registered: channel.registered,
    };
  });
  return { channels, next_offset: value.next_offset };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
