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
