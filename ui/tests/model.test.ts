import { Localizer } from "../src/localization/localizer.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {
  channelCounts, channelState, createChannelPayload, createSettingsPayload,
  errorText, filterChannels, normalizeTheme,
  parseChannelInput,
} from "../src/domain/rules.ts";
import { BridgeUnavailableError, TauriDesktopClient } from "../src/infrastructure/tauri/desktop-client.ts";
import type { Channel, Dashboard, SettingsFormValues } from "../src/domain/types.ts";
import type { NativeCommand, NativeResults } from "../src/infrastructure/tauri/contracts.ts";

const korean = new Localizer("ko");
const formatTimestamp = (value: string | null) => korean.timestamp(value, "UTC");
const formatViewerCount = (value: number | null) => korean.viewers(value);
const firstIdentifier = "a".repeat(32);
const secondIdentifier = "b".repeat(32);
const thirdIdentifier = "c".repeat(32);
const settingsValues: SettingsFormValues = {
  interval: "60", notifyOffline: true, clientId: " client-id ", clientSecret: "", clearClientSecret: false,
};
const unavailableFields = { channel_image_url: null, viewer_count: null, last_checked: null, went_live_at: null };
const channels: [Channel, Channel, Channel] = [
  { ...unavailableFields, id: firstIdentifier, name: "오프라인 채널", is_live: false, live_title: null, category: null },
  { ...unavailableFields, id: secondIdentifier, name: "라이브 채널", is_live: true, live_title: "오늘의 게임", category: "Adventure" },
  { ...unavailableFields, id: thirdIdentifier, name: "확인 전 채널", is_live: null, live_title: null, category: null },
];
const dashboard: Dashboard = {
  channels: [],
  settings: { check_interval_secs: 60, notify_offline: true },
  api: { client_id: "client-id", has_client_secret: true },
  auto_launch: false,
  auto_launch_error: null,
  monitor: { running: true, checking: false, last_error: null, last_checked: null, host: null },
  session_type: "wayland",
  version: "test",
};
const nativeResults: NativeResults = {
  get_dashboard: dashboard,
  add_channel: dashboard,
  remove_channel: dashboard,
  save_settings: dashboard,
  set_auto_launch: dashboard,
  refresh_channels: undefined,
  open_channel: undefined,
  send_test_notification: undefined,
};

test("channel identifiers are trimmed and normalized", () => {
  assert.equal(parseChannelInput(` ${firstIdentifier.toUpperCase()} `), firstIdentifier);
});

test("channel and live URLs accept trailing slash, query, and fragment", () => {
  for (const address of [
    `https://chzzk.naver.com/${firstIdentifier}`,
    `https://chzzk.naver.com/live/${firstIdentifier}/?source=share#player`,
    `chzzk.naver.com/${firstIdentifier}`,
    `http://chzzk.naver.com/${firstIdentifier}`,
  ]) assert.equal(parseChannelInput(address), firstIdentifier);
});

test("channel parsing rejects external, deceptive, credentialed, and malformed addresses", () => {
  for (const address of [
    "", "short", "g".repeat(32), `https://example.com/${firstIdentifier}`,
    `https://chzzk.naver.com.evil.example/${firstIdentifier}`,
    `https://user:password@chzzk.naver.com/${firstIdentifier}`,
    `https://chzzk.naver.com:8443/${firstIdentifier}`,
    `javascript:alert('${firstIdentifier}')`, `file:///live/${firstIdentifier}`,
    `https://chzzk.naver.com/${firstIdentifier}/videos`,
  ]) assert.throws(() => parseChannelInput(address), Error, address);
});

test("add payload uses exact camelCase argument names and nullable display name", () => {
  assert.deepEqual(createChannelPayload(firstIdentifier, "  "), { channelId: firstIdentifier, name: null });
  assert.deepEqual(createChannelPayload(firstIdentifier, " 채널 이름 "), { channelId: firstIdentifier, name: "채널 이름" });
  assert.throws(() => createChannelPayload(firstIdentifier, "가".repeat(81)), /longChannelName/);
  assert.throws(() => createChannelPayload(firstIdentifier.toUpperCase(), "", channels), /duplicateChannel/);
});

test("settings payload retains blank or null secret and contains no channels", () => {
  const payload = createSettingsPayload(settingsValues);
  assert.deepEqual(payload, { settings: {
    check_interval_secs: 60, notify_offline: true, client_id: "client-id",
    client_secret: null, clear_client_secret: false,
  } });
  assert.equal("channels" in payload, false);
  assert.equal(createSettingsPayload({ ...settingsValues, clientSecret: "  " }).settings.client_secret, null);
  assert.equal(createSettingsPayload({ ...settingsValues, clientSecret: null }).settings.client_secret, null);
});

test("settings support replacement and explicit clearing without ambiguous credentials", () => {
  assert.equal(createSettingsPayload({ ...settingsValues, clientSecret: " new-secret " }).settings.client_secret, "new-secret");
  assert.equal(createSettingsPayload({ ...settingsValues, clearClientSecret: true }).settings.clear_client_secret, true);
  assert.throws(() => createSettingsPayload({ ...settingsValues, clientSecret: "secret", clearClientSecret: true }), /conflictingSecret/);
});

test("poll interval has inclusive integer bounds", () => {
  for (const interval of ["15", "86400"]) assert.equal(createSettingsPayload({ ...settingsValues, interval }).settings.check_interval_secs, Number(interval));
  for (const interval of ["", "14", "86401", "15.1", "15.0", "1e3", "0x10", "Infinity", "NaN", "-60", "9007199254740993"]) {
    assert.throws(() => createSettingsPayload({ ...settingsValues, interval }), /invalidInterval/, interval);
  }
});

test("unknown channels are never counted or filtered as offline", () => {
  assert.equal(channelState(channels[2]), "unknown");
  assert.deepEqual(channelCounts(channels), { all: 3, live: 1, offline: 1, unknown: 1 });
  assert.deepEqual(filterChannels(channels, "", "offline").map((channel) => channel.id), [firstIdentifier]);
  assert.deepEqual(filterChannels(channels, "", "live").map((channel) => channel.id), [secondIdentifier]);
});

test("filter searches names, IDs, titles, and categories without mutating source", () => {
  assert.deepEqual(filterChannels(channels).map((channel) => channel.id), [secondIdentifier, thirdIdentifier, firstIdentifier]);
  assert.equal(channels[0].id, firstIdentifier);
  assert.equal(filterChannels(channels, " 오늘의 ").length, 1);
  assert.equal(filterChannels(channels, "ADVENTURE").length, 1);
  assert.equal(filterChannels(channels, firstIdentifier).length, 1);
  assert.equal(filterChannels(channels, "확인 전", "offline").length, 0);
  assert.equal(filterChannels([], "missing").length, 0);
});

test("timestamp, viewer, and error formatting handle unavailable values", () => {
  assert.equal(formatTimestamp(null), "아직 확인하지 않음");
  assert.equal(formatTimestamp("not-a-date"), "확인 시간 없음");
  assert.match(formatTimestamp("2025-05-01T12:30:00Z"), /5/);
  assert.equal(formatViewerCount(1234), "1,234명 시청");
  assert.equal(formatViewerCount(0), "0명 시청");
  for (const value of [null, -1, Number.NaN, Infinity]) assert.equal(formatViewerCount(value), "시청자 수 미제공");
  assert.equal(errorText(new Error("native failure")), "native failure");
  assert.equal(errorText("D-Bus unavailable"), "D-Bus unavailable");
  assert.equal(errorText({ reason: "denied" }), '{"reason":"denied"}');
});

test("invalid stored themes fall back to system", () => {
  for (const theme of ["system", "light", "dark"]) assert.equal(normalizeTheme(theme), theme);
  for (const theme of [null, "", "sepia", undefined]) assert.equal(normalizeTheme(theme), "system");
});

test("every IPC command has the exact native command name, payload, and result", async () => {
  const calls: unknown[][] = [];
  const client = new TauriDesktopClient(async (command, ...argumentsValue) => {
    calls.push([command, ...argumentsValue]);
    return nativeResults[command];
  });
  assert.equal(await client.getDashboard(), dashboard);
  assert.equal(await client.addChannel(firstIdentifier, " 표시 이름 "), dashboard);
  assert.equal(await client.removeChannel(firstIdentifier), dashboard);
  assert.equal(await client.saveSettings(settingsValues), dashboard);
  assert.equal(await client.setAutoLaunch(true), dashboard);
  assert.equal(await client.refreshChannels(), undefined);
  assert.equal(await client.openChannel(firstIdentifier, true), undefined);
  assert.equal(await client.openChannel(firstIdentifier, false), undefined);
  assert.equal(await client.sendTestNotification(), undefined);
  assert.deepEqual(calls, [
    ["get_dashboard"],
    ["add_channel", { channelId: firstIdentifier, name: "표시 이름" }],
    ["remove_channel", { channelId: firstIdentifier }],
    ["save_settings", createSettingsPayload(settingsValues)],
    ["set_auto_launch", { enabled: true }],
    ["refresh_channels"],
    ["open_channel", { channelId: firstIdentifier, live: true }],
    ["open_channel", { channelId: firstIdentifier, live: false }],
    ["send_test_notification"],
  ]);
});

test("native requests are serialized and rejection does not poison subsequent requests", async () => {
  let active = 0;
  let maximumActive = 0;
  const calls: NativeCommand[] = [];
  const client = new TauriDesktopClient(async (command, ..._argumentsValue) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    calls.push(command);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    active -= 1;
    if (command === "get_dashboard") throw new Error("native error details");
    return nativeResults[command];
  });
  const failed = client.getDashboard();
  const next = client.refreshChannels();
  await assert.rejects(failed, /native error details/);
  assert.equal(await next, undefined);
  assert.equal(maximumActive, 1);
  assert.deepEqual(calls, ["get_dashboard", "refresh_channels"]);
});

test("invalid inputs never reach IPC", () => {
  let calls = 0;
  const client = new TauriDesktopClient(async () => {
    calls += 1;
    throw new Error("Invalid input reached the native bridge.");
  });
  assert.throws(() => client.addChannel("invalid", null), /invalidChannelInput/);
  assert.throws(() => client.saveSettings({ ...settingsValues, interval: 1 }), /invalidInterval/);
  assert.equal(calls, 0);
});

test("missing native bridge fails honestly rather than generating fixture data", async () => {
  const client = new TauriDesktopClient(undefined);
  assert.equal(client.available, false);
  await assert.rejects(client.getDashboard(), BridgeUnavailableError);
  await assert.rejects(client.sendTestNotification(), /bridgeUnavailable/);
});
