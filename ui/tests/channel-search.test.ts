import test from "node:test";
import assert from "node:assert/strict";
import { createChannelSearchPayload, normalizeChannelSearchResults } from "../src/domain/channel-search.ts";
import { StreamerSearchState } from "../src/application/state/streamer-search-state.ts";
import { CodedError } from "../src/domain/errors.ts";
import { Localizer } from "../src/localization/localizer.ts";
import { catalogs } from "../src/localization/catalogs.ts";
import { locales } from "../src/localization/locale.ts";
import { searchResults, streamer } from "./support/channel-search.ts";

function searching(query = "streamer") {
  const state = new StreamerSearchState();
  state.open();
  state.changeQuery(query);
  return state;
}

test("discovery validation trims queries and counts Unicode code points rather than UTF-16 units", () => {
  assert.deepEqual(createChannelSearchPayload(" \t이름 日本語 台灣 \n"), { query: "이름 日本語 台灣", offset: 0 });
  const astral = String.fromCodePoint(0x1f600);
  assert.equal(createChannelSearchPayload(astral.repeat(100), 1000).query.length, 200);
  assert.equal(createChannelSearchPayload("a".repeat(100), 0).offset, 0);
  assert.equal(createChannelSearchPayload(astral).query, astral);
  for (const query of ["", " \n\t", "a".repeat(101), astral.repeat(101)]) {
    assert.throws(() => createChannelSearchPayload(query), { code: "invalidStreamerQuery" });
  }
  for (const offset of [-1, 1001, 0.5, NaN, Infinity, -Infinity]) {
    assert.throws(() => createChannelSearchPayload("name", offset), { code: "invalidSearchOffset" });
  }
});

test("result normalization preserves the native shape and rejects malformed or nonprogressing pages atomically", () => {
  const source = searchResults([streamer("A")], 20);
  assert.deepEqual(normalizeChannelSearchResults(source, 0), searchResults([streamer("a", { name: "Streamer A" })], 20));
  assert.equal(source.channels[0]?.id, "A".repeat(32));
  for (const value of [
    null, {}, { channels: [], nextOffset: null }, searchResults([], 0), searchResults([], 1001),
    searchResults([], 2.5), searchResults(Array.from({ length: 21 }, () => streamer())),
    searchResults([streamer("x")]), searchResults([streamer("b", { follower_count: -1 })]),
    searchResults([streamer("b", { follower_count: Infinity })]),
    { channels: [{ ...streamer(), is_live: null }], next_offset: null },
    { channels: [{ ...streamer(), registered: "false" }], next_offset: null },
    { channels: [{ ...streamer(), channel_image_url: 123 }], next_offset: null },
  ]) assert.throws(() => normalizeChannelSearchResults(value, 0), { code: "invalidSearchResults" });
  assert.throws(() => normalizeChannelSearchResults(searchResults([], 20), 20), { code: "invalidSearchResults" });
});

test("pagination appends distinct normalized IDs in first-seen order and owns result snapshots", () => {
  const state = searching();
  const first = state.begin()!;
  assert.equal(state.begin(), null);
  state.accept(first, searchResults([streamer("b"), streamer("c")], 20));
  const next = state.begin(true)!;
  assert.equal(next.offset, 20);
  const source = searchResults([streamer("B", { name: "Updated" }), streamer("d")], null);
  state.accept(next, source);
  assert.deepEqual(state.results.map((channel) => channel.id), ["b", "c", "d"].map((value) => value.repeat(32)));
  assert.equal(state.results[0]?.name, "Updated");
  source.channels[0]!.name = "External mutation";
  state.results[0]!.name = "Caller mutation";
  assert.equal(state.results[0]?.name, "Updated");
  assert.equal(state.begin(true), null);
  assert.equal(state.accept(first, searchResults()), false);
});

test("query changes, close, and reopen invalidate both successful and failed completions", () => {
  const state = searching();
  const first = state.begin()!;
  state.changeQuery("new name");
  assert.equal(state.loading, false);
  assert.equal(state.accept(first, searchResults()), false);
  assert.equal(state.fail(first, new Error("old error")), false);
  const second = state.begin()!;
  state.close();
  state.open();
  assert.equal(state.accept(second, searchResults()), false);
  assert.equal(state.query, "");
  assert.equal(state.searched, false);
  assert.deepEqual(state.results, []);
});

test("failed pages retain prior results and retry the same offset without duplicates", () => {
  const state = searching();
  state.accept(state.begin()!, searchResults([streamer()], 20));
  const request = state.begin(true)!;
  state.fail(request, "Network unavailable");
  assert.equal(state.error, "Network unavailable");
  assert.equal(state.failedOffset, 20);
  assert.equal(state.results.length, 1);
  const retry = state.begin(true)!;
  assert.equal(retry.offset, 20);
  assert.equal(state.error, null);
  assert.throws(() => state.accept(retry, { channels: null }), CodedError);
  state.fail(retry, new CodedError("invalidSearchResults"));
  state.accept(state.begin(true)!, searchResults([streamer(), streamer("c")]));
  assert.equal(state.results.length, 2);
  assert.equal(state.error, null);
});

test("registered flags respect search responses until a newer dashboard updates additions and removals", () => {
  const state = searching();
  const initial: { id: string }[] = [];
  state.synchronizeRegistration(initial);
  state.accept(state.begin()!, searchResults([streamer("b", { registered: true }), streamer("c")]));
  assert.equal(state.result("b".repeat(32), initial)?.registered, true);
  state.synchronizeRegistration(initial);
  assert.equal(state.result("b".repeat(32), initial)?.registered, true);
  const updated = [{ id: "c".repeat(32) }];
  state.synchronizeRegistration(updated);
  assert.equal(state.result("b".repeat(32), updated)?.registered, false);
  assert.equal(state.result("c".repeat(32), updated)?.registered, true);
  assert.equal(state.result("missing", updated), null);
});

test("all new discovery errors and interpolated labels are available in every locale", () => {
  for (const locale of locales) {
    const localizer = new Localizer(locale);
    for (const code of ["invalidStreamerQuery", "invalidSearchOffset", "invalidSearchResults"] as const) {
      assert.equal(localizer.error(new CodedError(code)), catalogs[locale][code]);
    }
    assert.equal(localizer.t("streamerFollowers", { count: "1,234" }), catalogs[locale].streamerFollowers.replace("{count}", "1,234"));
    assert.ok(localizer.t("streamerAddLabel", { name: "<streamer>" }).includes("<streamer>"));
  }
});
