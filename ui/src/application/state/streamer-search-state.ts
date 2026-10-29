import { createChannelSearchPayload, normalizeChannelSearchResults } from "../../domain/channel-search.ts";
import type { Channel, ChannelSearchPayload, ChannelSearchResult } from "../../domain/types.ts";

export interface SearchRequest extends Readonly<ChannelSearchPayload> {
  readonly revision: number;
}

export class StreamerSearchState {
  #active = false;
  #query = "";
  #results = new Map<string, ChannelSearchResult>();
  #nextOffset: number | null = null;
  #request: SearchRequest | null = null;
  #revision = 0;
  #searched = false;
  #error: unknown = null;
  #registrationSnapshot: readonly Pick<Channel, "id">[] | null = null;
  #failedOffset: number | null = null;

  get active(): boolean { return this.#active; }
  get query(): string { return this.#query; }
  get results(): readonly ChannelSearchResult[] { return [...this.#results.values()].map((result) => ({ ...result })); }
  get nextOffset(): number | null { return this.#nextOffset; }
  get loading(): boolean { return this.#request !== null; }
  get searched(): boolean { return this.#searched; }
  get error(): unknown { return this.#error; }
  get failedOffset(): number | null { return this.#failedOffset; }
  get revision(): number { return this.#revision; }

  open(): void { this.#active = true; this.reset(""); }
  close(): void { this.#active = false; this.reset(""); }

  changeQuery(query: string): void {
    if (this.#query !== query) this.reset(query);
  }

  begin(more = false): SearchRequest | null {
    if (!this.#active || this.loading) return null;
    const offset = more ? this.#failedOffset ?? this.#nextOffset : 0;
    if (offset === null) return null;
    const payload = createChannelSearchPayload(this.#query, offset);
    if (!more) {
      this.#results.clear();
      this.#nextOffset = null;
      this.#searched = false;
    }
    this.#error = null;
    this.#failedOffset = null;
    this.#request = Object.freeze({ ...payload, revision: ++this.#revision });
    return this.#request;
  }

  current(request: SearchRequest): boolean { return this.#active && this.#request === request; }

  accept(request: SearchRequest, value: unknown): boolean {
    if (!this.current(request)) return false;
    const result = normalizeChannelSearchResults(value, request.offset);
    for (const channel of result.channels) this.#results.set(channel.id, channel);
    this.#nextOffset = result.next_offset;
    this.#request = null;
    this.#searched = true;
    return true;
  }

  fail(request: SearchRequest, error: unknown): boolean {
    if (!this.current(request)) return false;
    this.#request = null;
    this.#error = error;
    this.#failedOffset = request.offset;
    return true;
  }

  invalid(error: unknown): void { this.#error = error; }

  // Search flags remain useful until a newer authoritative dashboard replaces their registration snapshot.
  synchronizeRegistration(channels: readonly Pick<Channel, "id">[] | null): void {
    if (channels === null || channels === this.#registrationSnapshot) return;
    this.#registrationSnapshot = channels;
    const identifiers = new Set(channels.map((channel) => channel.id.toLowerCase()));
    for (const [identifier, result] of this.#results) {
      this.#results.set(identifier, { ...result, registered: identifiers.has(identifier) });
    }
  }

  result(identifier: string, registered: readonly Pick<Channel, "id">[] | null): ChannelSearchResult | null {
    const result = this.#results.get(identifier.toLowerCase());
    if (!result) return null;
    return { ...result, registered: result.registered || Boolean(registered?.some((channel) => channel.id.toLowerCase() === result.id)) };
  }

  private reset(query: string): void {
    this.#revision += 1;
    this.#query = query;
    this.#results.clear();
    this.#request = null;
    this.#nextOffset = null;
    this.#searched = false;
    this.#error = null;
    this.#failedOffset = null;
    this.#registrationSnapshot = null;
  }
}
