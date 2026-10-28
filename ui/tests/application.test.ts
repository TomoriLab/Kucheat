import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationController } from "../src/application/application-controller.ts";
import { DashboardState } from "../src/application/state/dashboard-state.ts";
import { Deferred, FakeDesktopClient, ManualScheduler, RecordingFeedback, RecordingScreen, RecordingView, flushPromises } from "./support/application-fakes.ts";
import { dashboard } from "./support/dashboard.ts";
import type { Dashboard } from "../src/domain/types.ts";

function application() {
  const client = new FakeDesktopClient();
  const state = new DashboardState();
  const view = new RecordingView();
  const feedback = new RecordingFeedback();
  const scheduler = new ManualScheduler();
  const screen = new RecordingScreen();
  const controller = new ApplicationController(client, state, view, feedback, scheduler, () => [screen]);
  return { client, state, view, feedback, scheduler, screen, controller };
}

test("application starts once, polls every three seconds, avoids overlapping polls, and disposes its children", async () => {
  const { controller, client, state, scheduler, screen, feedback } = application();
  controller.start();
  controller.start();
  assert.equal(client.requests.length, 1);
  assert.equal(state.loading, true);
  assert.equal(screen.starts, 1);
  client.requests[0]?.resolve(dashboard());
  await flushPromises();
  assert.equal(controller.ready, true);
  assert.equal(state.loading, false);
  assert.deepEqual([...scheduler.tasks.values()].map((task) => task.milliseconds), [3000]);
  scheduler.fire();
  await controller.poll();
  assert.equal(client.requests.length, 2);
  client.requests[1]?.resolve(dashboard(120));
  await flushPromises();
  assert.equal(state.dashboard?.settings.check_interval_secs, 120);
  assert.equal(scheduler.tasks.size, 1);
  controller.dispose();
  controller.dispose();
  assert.equal(scheduler.tasks.size, 0);
  assert.equal(screen.disposals, 1);
  assert.equal(feedback.disposals, 1);
  assert.equal(controller.ready, false);
});

test("unavailable desktop client never polls or executes native actions", async () => {
  const { controller, client, scheduler } = application();
  client.available = false;
  controller.start();
  let called = false;
  assert.equal(await controller.run("test", async () => { called = true; }), false);
  await controller.poll();
  assert.equal(called, false);
  assert.equal(client.requests.length, 0);
  assert.equal(scheduler.tasks.size, 0);
  controller.dispose();
});

test("poll failures retain the last dashboard and schedule recovery", async () => {
  const { controller, client, state, scheduler } = application();
  const original = dashboard();
  state.accept(original);
  controller.start();
  client.requests[0]?.reject(new Error("connection lost"));
  await flushPromises();
  assert.equal(state.dashboard, original);
  assert.equal(state.connectionError, "connection lost");
  scheduler.fire();
  client.requests[1]?.resolve(dashboard(300));
  await flushPromises();
  assert.equal(state.connectionError, null);
  assert.equal(state.dashboard?.settings.check_interval_secs, 300);
  controller.dispose();
});

test("mutations gate other actions and polling, reset drafts only after save, and restore focus after success", async () => {
  const { controller, client, state, scheduler, screen, view, feedback } = application();
  controller.start();
  client.requests[0]?.resolve(dashboard());
  await flushPromises();
  const save = new Deferred<Dashboard>();
  let succeeded = 0;
  const pending = controller.run("save", () => save.promise, {
    dashboard: true, success: "saved", errorTarget: "settings-error", onSuccess: () => { succeeded += 1; },
  });
  assert.equal(state.operation, "save");
  let blockedAction = false;
  assert.equal(await controller.run("delete", async () => { blockedAction = true; }), false);
  await controller.poll();
  assert.equal(blockedAction, false);
  assert.equal(client.requests.length, 1);
  save.resolve(dashboard(120));
  assert.equal(await pending, true);
  assert.equal(state.operation, null);
  assert.equal(screen.resets.at(-1), true);
  assert.equal(view.restoredFocus, 1);
  assert.equal(succeeded, 1);
  assert.deepEqual(feedback.cleared, ["settings-error"]);
  assert.deepEqual(feedback.messages, ["saved"]);
  assert.equal(scheduler.tasks.size, 1);
  await controller.run("auto-launch", async () => dashboard(180), { dashboard: true });
  assert.equal(screen.resets.at(-1), false);
  controller.dispose();
});

test("operation failures route inline, auto-launch, and action errors without discarding drafts", async () => {
  const { controller, client, state, feedback, screen } = application();
  controller.start();
  client.requests[0]?.resolve(dashboard());
  await flushPromises();
  const failure = async () => { throw new Error("denied"); };
  assert.equal(await controller.run("save", failure, { dashboard: true, errorTarget: "settings-error", context: "save failed" }), false);
  assert.equal(feedback.errors[0]?.target, "settings-error");
  assert.equal(feedback.errors[0]?.context, "save failed");
  assert.equal(screen.resets.includes(true), false);
  assert.equal(await controller.run("auto-launch", failure), false);
  assert.equal(state.autoLaunchError, "denied");
  assert.equal(await controller.run("open", failure, { context: "open failed" }), false);
  assert.equal(feedback.errors[1]?.target, null);
  assert.equal(feedback.errors[1]?.context, "open failed");
  assert.equal(state.operation, null);
  controller.dispose();
});

test("an older poll cannot overwrite a mutation dashboard or report a stale connection error", async () => {
  for (const fail of [false, true]) {
    const { controller, client, state } = application();
    state.accept(dashboard());
    controller.start();
    const updated = dashboard(300);
    await controller.run("save", async () => updated, { dashboard: true });
    if (fail) client.requests[0]?.reject(new Error("stale failure"));
    else client.requests[0]?.resolve(dashboard(15));
    await flushPromises();
    assert.equal(state.dashboard, updated);
    assert.equal(state.connectionError, null);
    controller.dispose();
  }
});

test("disposal ignores late poll results and restart cannot be affected by an earlier lifetime", async () => {
  const { controller, client, state, scheduler, view, screen } = application();
  const readDashboard = (): Dashboard | null => state.dashboard;
  controller.start();
  controller.dispose();
  const renderCount = view.renders;
  client.requests[0]?.resolve(dashboard(15));
  await flushPromises();
  assert.equal(readDashboard(), null);
  assert.equal(view.renders, renderCount);
  assert.equal(scheduler.tasks.size, 0);
  controller.start();
  assert.equal(screen.starts, 2);
  controller.dispose();
  controller.start();
  assert.equal(state.loading, true);
  client.requests[1]?.reject(new Error("previous lifetime"));
  await flushPromises();
  assert.equal(state.loading, true);
  assert.equal(state.connectionError, null);
  client.requests[2]?.resolve(dashboard(600));
  await flushPromises();
  assert.equal(state.dashboard?.settings.check_interval_secs, 600);
  assert.equal(state.loading, false);
  controller.dispose();
});

test("late mutation completion cannot render, toast, reset drafts, or release a new lifetime's operation", async () => {
  const { controller, client, state, feedback, screen, view } = application();
  state.accept(dashboard());
  controller.start();
  client.requests[0]?.resolve(dashboard());
  await flushPromises();
  const oldSave = new Deferred<Dashboard>();
  let completed = false;
  const oldOperation = controller.run("save", () => oldSave.promise, {
    dashboard: true, success: "stale success", onSuccess: () => { completed = true; },
  });
  controller.dispose();
  controller.start();
  const newSave = new Deferred<Dashboard>();
  const newOperation = controller.run("save", () => newSave.promise, { dashboard: true });
  const renderCount = view.renders;
  oldSave.resolve(dashboard(15));
  assert.equal(await oldOperation, false);
  assert.equal(state.operation, "save");
  assert.equal(view.renders, renderCount);
  assert.deepEqual(feedback.messages, []);
  assert.equal(screen.resets.includes(true), false);
  assert.equal(completed, false);
  newSave.resolve(dashboard(600));
  assert.equal(await newOperation, true);
  client.requests[1]?.resolve(dashboard(30));
  await flushPromises();
  assert.equal(state.dashboard?.settings.check_interval_secs, 600);
  controller.dispose();
});
