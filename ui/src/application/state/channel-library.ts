import { filterChannels } from "../../domain/rules.ts";
import type { Channel, ChannelFilter } from "../../domain/types.ts";

export class ChannelLibrary {
  #query = "";
  #filter: ChannelFilter = "all";
  #deletion: Channel | null = null;

  get query(): string { return this.#query; }
  get filter(): ChannelFilter { return this.#filter; }
  get deletion(): Channel | null { return this.#deletion; }

  search(query: string): void { this.#query = query; }
  selectFilter(filter: ChannelFilter): void { this.#filter = filter; }
  clearSearch(): void { this.#query = ""; }

  visible(channels: readonly Channel[], locale = "ko"): Channel[] {
    return filterChannels(channels, this.#query, this.#filter, locale);
  }

  selectDeletion(identifier: string, channels: readonly Channel[]): Channel | null {
    this.#deletion = channels.find((channel) => channel.id === identifier) ?? null;
    return this.#deletion;
  }

  clearDeletion(): void { this.#deletion = null; }
}
