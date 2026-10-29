import type { ChannelSearchResult, ChannelSearchResults } from "../../src/domain/types.ts";

export function streamer(character = "b", values: Partial<ChannelSearchResult> = {}): ChannelSearchResult {
  return {
    id: character.repeat(32), name: `Streamer ${character}`, channel_image_url: null,
    is_live: true, follower_count: 1234, registered: false, ...values,
  };
}

export function searchResults(channels = [streamer()], nextOffset: number | null = null): ChannelSearchResults {
  return { channels, next_offset: nextOffset };
}
