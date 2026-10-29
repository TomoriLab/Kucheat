import test from "node:test";
import assert from "node:assert/strict";
import { TauriDesktopClient } from "../src/infrastructure/tauri/desktop-client.ts";
import type { NativeCommand, NativeInvoke, NativeResults } from "../src/infrastructure/tauri/contracts.ts";
import { Deferred, flushPromises } from "./support/application-fakes.ts";
import { dashboard } from "./support/dashboard.ts";

class FakeTransport {
  readonly calls: NativeCommand[] = [];
  readonly gates: Deferred<void>[] = [];
  readonly #results: NativeResults = {
    get_dashboard: dashboard(), add_channel: dashboard(), remove_channel: dashboard(),
    save_settings: dashboard(), set_auto_launch: dashboard(), refresh_channels: undefined,
    open_channel: undefined, send_test_notification: undefined,
    search_channels: { channels: [], next_offset: null },
  };

  readonly invoke: NativeInvoke = async (command, ..._argumentsValue) => {
    this.calls.push(command);
    const gate = new Deferred<void>();
    this.gates.push(gate);
    await gate.promise;
    return this.#results[command];
  };
}

test("concurrent typed calls enter the transport in FIFO order and recover from an intervening rejection", async () => {
  const transport = new FakeTransport();
  const client = new TauriDesktopClient(transport.invoke);
  const first = client.getDashboard();
  const second = client.refreshChannels();
  const rejected = assert.rejects(second, /refresh denied/);
  const third = client.openChannel("a".repeat(32), true);
  const fourth = client.sendTestNotification();
  await flushPromises();
  assert.deepEqual(transport.calls, ["get_dashboard"]);
  transport.gates[0]?.resolve();
  assert.equal((await first).version, "test");
  await flushPromises();
  assert.deepEqual(transport.calls, ["get_dashboard", "refresh_channels"]);
  transport.gates[1]?.reject(new Error("refresh denied"));
  await rejected;
  await flushPromises();
  assert.deepEqual(transport.calls, ["get_dashboard", "refresh_channels", "open_channel"]);
  transport.gates[2]?.resolve();
  await third;
  await flushPromises();
  assert.equal(transport.calls.at(-1), "send_test_notification");
  transport.gates[3]?.resolve();
  await fourth;
});

test("client queues belong to individual instances rather than shared module state", async () => {
  const firstTransport = new FakeTransport();
  const secondTransport = new FakeTransport();
  const first = new TauriDesktopClient(firstTransport.invoke).getDashboard();
  const second = new TauriDesktopClient(secondTransport.invoke).refreshChannels();
  await flushPromises();
  assert.equal(firstTransport.calls.length, 1);
  assert.equal(secondTransport.calls.length, 1);
  secondTransport.gates[0]?.resolve();
  await second;
  firstTransport.gates[0]?.resolve();
  await first;
});

test("a synchronous transport throw also releases the queue for subsequent requests", async () => {
  let count = 0;
  const invoke: NativeInvoke = () => {
    count += 1;
    if (count === 1) throw new Error("synchronous bridge failure");
    return Promise.reject(new Error("next request reached transport"));
  };
  const client = new TauriDesktopClient(invoke);
  const first = client.getDashboard();
  const second = client.refreshChannels();
  await assert.rejects(first, /synchronous bridge failure/);
  await assert.rejects(second, /next request reached transport/);
  assert.equal(count, 2);
});

test("discovery bypasses pending dashboard requests and does not block the mutation FIFO", async () => {
  const transport = new FakeTransport();
  const client = new TauriDesktopClient(transport.invoke);
  const first = client.getDashboard();
  await flushPromises();
  const search = client.searchChannels("name");
  const mutation = client.removeChannel("a".repeat(32));
  const next = client.getDashboard();
  await flushPromises();
  assert.deepEqual(transport.calls, ["get_dashboard", "search_channels"]);
  transport.gates[0]?.resolve();
  await first;
  await flushPromises();
  assert.deepEqual(transport.calls, ["get_dashboard", "search_channels", "remove_channel"]);
  transport.gates[2]?.resolve();
  await mutation;
  await flushPromises();
  assert.equal(transport.calls.at(-1), "get_dashboard");
  transport.gates[3]?.resolve();
  await next;
  transport.gates[1]?.resolve();
  assert.deepEqual(await search, { channels: [], next_offset: null });
});

test("discovery rejects invalid inputs before invoking and safely handles absent or synchronously failing transports", async () => {
  const transport = new FakeTransport();
  const client = new TauriDesktopClient(transport.invoke);
  await assert.rejects(client.searchChannels(" "), { code: "invalidStreamerQuery" });
  await assert.rejects(client.searchChannels("name", 1001), { code: "invalidSearchOffset" });
  assert.deepEqual(transport.calls, []);
  await assert.rejects(new TauriDesktopClient(undefined).searchChannels("name"), { code: "bridgeUnavailable" });
  let calls = 0;
  const results: NativeResults = {
    get_dashboard: dashboard(), add_channel: dashboard(), remove_channel: dashboard(), save_settings: dashboard(),
    set_auto_launch: dashboard(), refresh_channels: undefined, open_channel: undefined, send_test_notification: undefined,
    search_channels: { channels: [], next_offset: null },
  };
  const recovering = new TauriDesktopClient((command, ..._argumentsValue) => {
    calls += 1;
    if (calls === 1) throw new Error("Synchronous search failure");
    return Promise.resolve(results[command]);
  });
  await assert.rejects(recovering.searchChannels("name"), /Synchronous search failure/);
  assert.equal((await recovering.getDashboard()).version, "test");
  assert.deepEqual(await recovering.searchChannels("name"), { channels: [], next_offset: null });
});

test("multiple discovery reads are independent and rejection never poisons other searches", async () => {
  const transport = new FakeTransport();
  const client = new TauriDesktopClient(transport.invoke);
  const first = client.searchChannels("old");
  const rejected = assert.rejects(first, /search unavailable/);
  const second = client.searchChannels("new");
  await flushPromises();
  assert.deepEqual(transport.calls, ["search_channels", "search_channels"]);
  transport.gates[1]?.resolve();
  await second;
  transport.gates[0]?.reject(new Error("search unavailable"));
  await rejected;
});
