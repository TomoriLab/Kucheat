import test from "node:test";
import assert from "node:assert/strict";
import { ChannelLibrary } from "../src/application/state/channel-library.ts";
import { DashboardState } from "../src/application/state/dashboard-state.ts";
import { SettingsDraft } from "../src/application/state/settings-draft.ts";
import { createSettingsPayload } from "../src/domain/rules.ts";
import { channel, dashboard } from "./support/dashboard.ts";

test("dashboard acceptance clears connection failure and rejects malformed responses without losing the snapshot", () => {
  const state = new DashboardState();
  assert.equal(state.dashboard, null);
  state.beginLoading();
  state.failConnection(new Error("offline"));
  assert.equal(state.connectionError, "offline");
  const snapshot = dashboard();
  state.accept(snapshot);
  state.endLoading();
  assert.equal(state.loading, false);
  assert.equal(state.connectionError, null);
  assert.equal(state.dashboard, snapshot);
  assert.throws(() => state.accept(undefined), /Dashboard/);
  assert.equal(state.dashboard, snapshot);
  assert.equal(state.beginOperation("save"), true);
  assert.equal(state.beginOperation("delete"), false);
  assert.equal(state.operation, "save");
  state.endOperation();
  assert.equal(state.beginOperation("delete"), true);
  state.setAutoLaunchError(new Error("permission denied"));
  assert.equal(state.autoLaunchError, "permission denied");
  state.setAutoLaunchError(null);
  assert.equal(state.autoLaunchError, null);
});

test("channel libraries isolate search, filtering, and deletion selection without mutating channels", () => {
  const library = new ChannelLibrary();
  const other = new ChannelLibrary();
  const channels = [channel("a".repeat(32), false), channel("b".repeat(32), true), channel("c".repeat(32))];
  library.selectFilter("offline");
  library.search(" a ");
  assert.deepEqual(library.visible(channels), [channels[0]]);
  assert.equal(channels[0]?.is_live, false);
  assert.equal(other.query, "");
  assert.equal(other.filter, "all");
  library.clearSearch();
  library.selectFilter("unknown");
  assert.deepEqual(library.visible(channels), [channels[2]]);
  assert.equal(library.selectDeletion("b".repeat(32), channels), channels[1]);
  library.clearDeletion();
  assert.equal(library.deletion, null);
  assert.equal(library.selectDeletion("missing", channels), null);
});

test("settings drafts preserve dirty values and write-only secrets across repeated polls", () => {
  const draft = new SettingsDraft();
  const source = dashboard();
  assert.equal(draft.hydrate(source), true);
  assert.equal(draft.values.clientSecret, "");
  draft.update({ ...draft.values, interval: "120", clientSecret: "replacement" }, source);
  const edited = draft.values;
  assert.equal(draft.dirty, true);
  for (let index = 0; index < 3; index += 1) assert.equal(draft.hydrate(dashboard(300)), false);
  assert.deepEqual(draft.values, edited);
  assert.equal(draft.hydrate(dashboard(120), true, true), true);
  assert.equal(draft.dirty, false);
  assert.equal(draft.values.interval, "120");
  assert.equal(draft.values.clientSecret, "");
  assert.equal(createSettingsPayload(draft.values).settings.client_secret, null);
});

test("focused clean settings remain unchanged until editing ends and reset uses the newest snapshot", () => {
  const draft = new SettingsDraft();
  const initial = dashboard();
  assert.equal(draft.hydrate(initial, true), true);
  assert.equal(draft.hydrate(dashboard(300), true), false);
  assert.equal(draft.values.interval, "60");
  assert.equal(draft.hydrate(dashboard(300)), true);
  assert.equal(draft.values.interval, "300");
  draft.update({ ...draft.values, interval: "invalid" }, dashboard(300));
  assert.equal(draft.dirty, true);
  assert.equal(draft.hydrate(dashboard(600), true, true), true);
  assert.equal(draft.values.interval, "600");
  assert.equal(draft.dirty, false);
});

test("draft ownership prevents caller mutation and clearing a secret discards replacement input", () => {
  const draft = new SettingsDraft();
  const source = dashboard();
  draft.hydrate(source);
  const values = { ...draft.values, clientSecret: "replacement", clearClientSecret: true };
  draft.update(values, source);
  values.clientId = "external mutation";
  const snapshot = draft.values;
  snapshot.interval = "changed outside the draft";
  assert.equal(draft.values.clientId, "client-id");
  assert.equal(draft.values.interval, "60");
  assert.equal(draft.values.clientSecret, "");
  assert.equal(draft.dirty, true);
  assert.deepEqual(createSettingsPayload(draft.values).settings, {
    check_interval_secs: 60, notify_offline: true, client_id: "client-id",
    client_secret: null, clear_client_secret: true,
  });
  draft.update({ ...draft.values, clearClientSecret: false }, source);
  assert.equal(draft.dirty, false);
});
