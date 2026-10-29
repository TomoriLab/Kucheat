import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ApplicationController } from "../src/application/application-controller.ts";
import { DashboardState } from "../src/application/state/dashboard-state.ts";
import { StreamerSearchState } from "../src/application/state/streamer-search-state.ts";
import type { Channel, ChannelSearchResults, Dashboard } from "../src/domain/types.ts";
import { StreamerSearchController } from "../src/presentation/controllers/streamer-search-controller.ts";
import { StreamerSearchView } from "../src/presentation/views/streamer-search-view.ts";
import { Localizer } from "../src/localization/localizer.ts";
import { catalogs } from "../src/localization/catalogs.ts";
import { locales } from "../src/localization/locale.ts";
import { Deferred, FakeDesktopClient, ManualScheduler, RecordingFeedback, RecordingView, flushPromises } from "./support/application-fakes.ts";
import { DiscoveryDocument, DiscoveryElement, SearchKeyEvent } from "./support/discovery-dom.ts";
import { searchResults, streamer } from "./support/channel-search.ts";
import { channel, dashboard } from "./support/dashboard.ts";

class DiscoveryClient extends FakeDesktopClient {
  readonly searches: { query: string; offset: number; result: Deferred<ChannelSearchResults> }[] = [];
  readonly additions: { input: string; name: string | null; result: Deferred<Dashboard> }[] = [];

  override searchChannels(query: string, offset = 0): Promise<ChannelSearchResults> {
    const result = new Deferred<ChannelSearchResults>();
    this.searches.push({ query, offset, result });
    return result.promise;
  }

  override addChannel(input: string, name: string | null, _channels?: readonly Pick<Channel, "id">[]): Promise<Dashboard> {
    const result = new Deferred<Dashboard>();
    this.additions.push({ input, name, result });
    return result.promise;
  }
}

async function fixture() {
  const document = new DiscoveryDocument();
  const localizer = new Localizer("en");
  const client = new DiscoveryClient();
  const dashboardState = new DashboardState();
  const searchState = new StreamerSearchState();
  const feedback = new RecordingFeedback();
  const view = new StreamerSearchView(document.asDocument(), localizer);
  let controller!: StreamerSearchController;
  const application = new ApplicationController(client, dashboardState, new RecordingView(), feedback, new ManualScheduler(), (actions) => {
    controller = new StreamerSearchController(view, searchState, dashboardState, client, actions, localizer, () => {
      document.node("add-dialog").close();
      controller.close();
    });
    return [{
      start: () => controller.start(), dispose: () => controller.dispose(),
      renderControls: () => controller.render(),
    }];
  }, localizer);
  application.start();
  client.requests[0]?.resolve(dashboard());
  await flushPromises();
  document.node("add-dialog").showModal();
  controller.open();
  const input = (query: string): void => {
    document.node("streamer-search").value = query;
    document.node("streamer-search").dispatchEvent(new Event("input"));
  };
  return { document, localizer, client, dashboardState, searchState, feedback, view, controller, application, input };
}

function resultRows(document: DiscoveryDocument): DiscoveryElement[] { return document.node("streamer-search-results").children; }
function nameText(row: DiscoveryElement): string { return row.children[1]!.children[0]!.children[0]!.textContent; }
function addButton(row: DiscoveryElement): DiscoveryElement { return row.children[2]!; }

// The view uses the browser's Element check only for delegated hit testing.
const previousElement = Object.getOwnPropertyDescriptor(globalThis, "Element");
Object.defineProperty(globalThis, "Element", { configurable: true, value: DiscoveryElement });
test.after(() => {
  if (previousElement) Object.defineProperty(globalThis, "Element", previousElement);
  else Reflect.deleteProperty(globalThis, "Element");
});

test("explicit button or Enter searches preserve manual ID/name drafts and never submit the add form", async () => {
  const context = await fixture();
  const { document, client, controller, application, input, dashboardState } = context;
  const original = dashboardState.dashboard;
  document.node("new-channel-id").value = "manual channel URL";
  document.node("new-channel-name").value = "My custom name";
  input("  이름  ");
  assert.equal(client.searches.length, 0);
  const composing = new SearchKeyEvent(true);
  document.node("streamer-search").dispatchEvent(composing);
  assert.equal(composing.defaultPrevented, true);
  assert.equal(client.searches.length, 0);
  const enter = new SearchKeyEvent();
  document.node("streamer-search").dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.equal(client.searches[0]?.query, "이름");
  assert.equal(document.node("streamer-search-results").getAttribute("aria-busy"), "true");
  assert.equal(document.node("streamer-search").disabled, false);
  await controller.search();
  assert.equal(client.searches.length, 1);
  client.searches[0]?.result.resolve(searchResults());
  await flushPromises();
  assert.equal(document.node("new-channel-id").value, "manual channel URL");
  assert.equal(document.node("new-channel-name").value, "My custom name");
  assert.equal(dashboardState.dashboard, original);
  assert.equal(client.additions.length, 0);
  assert.equal(document.node("add-dialog").open, true);
  assert.equal(document.node("streamer-search-results").getAttribute("aria-busy"), "false");
  input("button search");
  document.node("search-streamers").dispatchEvent(new Event("click"));
  assert.equal(client.searches[1]?.query, "button search");
  client.searches[1]?.result.resolve(searchResults([]));
  await flushPromises();
  application.dispose();
});

test("query changes clear results immediately and old responses cannot overwrite a newer search", async () => {
  const { document, client, controller, application, input, searchState } = await fixture();
  input("old");
  const old = controller.search();
  input("new");
  assert.deepEqual(resultRows(document), []);
  assert.equal(searchState.loading, false);
  const current = controller.search();
  client.searches[1]?.result.resolve(searchResults([streamer("c")]));
  await current;
  client.searches[0]?.result.resolve(searchResults([streamer("b")]));
  await old;
  assert.deepEqual(searchState.results.map((result) => result.id), ["c".repeat(32)]);
  assert.equal(resultRows(document)[0]?.dataset.channelId, "c".repeat(32));
  input("edited but not submitted");
  assert.equal(resultRows(document).length, 0);
  assert.equal(client.searches.length, 2);
  application.dispose();
});

test("closed dialogs, reopened dialogs, and disposed/restarted controllers ignore late successes and failures", async () => {
  for (const action of ["close", "reopen", "restart"] as const) {
    const { document, client, controller, application, input, searchState } = await fixture();
    input("old");
    const pending = controller.search();
    if (action === "restart") { application.dispose(); application.start(); }
    else {
      document.node("add-dialog").close();
      controller.close();
      if (action === "reopen") { document.node("add-dialog").showModal(); controller.open(); }
    }
    if (action !== "close") {
      assert.equal(document.node("streamer-search").value, "");
      input("fresh");
      const fresh = controller.search();
      client.searches[1]?.result.resolve(searchResults([streamer("d")]));
      await fresh;
    }
    client.searches[0]?.result.reject(new Error("stale failure"));
    await pending;
    assert.equal(searchState.error, null);
    assert.equal(searchState.results.length, action === "close" ? 0 : 1);
    assert.equal(document.node("add-dialog").open, action !== "close");
    application.dispose();
  }
});

test("disposal without restart never renders a late completion or mutates the dashboard", async () => {
  const { client, controller, application, input, document, searchState, dashboardState } = await fixture();
  input("old");
  const pending = controller.search();
  application.dispose();
  const original = dashboardState.dashboard;
  const status = document.node("streamer-search-status").textContent;
  client.searches[0]?.result.resolve(searchResults());
  await pending;
  assert.equal(document.node("streamer-search-status").textContent, status);
  assert.equal(searchState.results.length, 0);
  assert.equal(dashboardState.dashboard, original);
});

test("pagination deduplicates IDs, retains focused controls, and ignores old pages after a query change", async () => {
  const { document, client, controller, application, input } = await fixture();
  input("name");
  const first = controller.search();
  client.searches[0]?.result.resolve(searchResults([streamer()], 20));
  await first;
  const originalRow = resultRows(document)[0]!;
  const originalButton = addButton(originalRow);
  originalButton.focus();
  const more = controller.search(true);
  client.searches[1]?.result.resolve(searchResults([streamer("B"), streamer("c")], 40));
  await more;
  assert.equal(client.searches[1]?.offset, 20);
  assert.equal(resultRows(document).length, 2);
  assert.equal(resultRows(document)[0], originalRow);
  assert.equal(document.activeElement, originalButton);
  const stalePage = controller.search(true);
  input("another name");
  const next = controller.search();
  client.searches[3]?.result.resolve(searchResults([streamer("d")]));
  await next;
  client.searches[2]?.result.resolve(searchResults([streamer("e")]));
  await stalePage;
  assert.equal(resultRows(document).length, 1);
  assert.equal(resultRows(document)[0]?.dataset.channelId, "d".repeat(32));
  assert.equal(document.node("streamer-search-more").hidden, true);
  application.dispose();
});

test("failures expose retry controls, preserve prior pages, and report empty results honestly", async () => {
  const { document, client, controller, application, input } = await fixture();
  input("name");
  const failed = controller.search();
  client.searches[0]?.result.reject(new Error("Network denied"));
  await failed;
  assert.equal(document.node("search-streamers").textContent, catalogs.en.streamerRetry);
  assert.ok(document.node("streamer-search-status").textContent.includes("Network denied"));
  const retry = controller.search();
  client.searches[1]?.result.resolve(searchResults([streamer()], 20));
  await retry;
  const page = controller.search(true);
  client.searches[2]?.result.reject(new Error("Next page denied"));
  await page;
  assert.equal(resultRows(document).length, 1);
  assert.equal(document.node("streamer-search-more").textContent, catalogs.en.streamerRetry);
  const pageRetry = controller.search(true);
  assert.equal(client.searches[3]?.offset, 20);
  client.searches[3]?.result.resolve(searchResults([streamer("c")]));
  await pageRetry;
  assert.equal(resultRows(document).length, 2);
  input("empty");
  const empty = controller.search();
  client.searches[4]?.result.resolve(searchResults([]));
  await empty;
  assert.equal(document.node("streamer-search-status").textContent, catalogs.en.streamerEmpty);
  application.dispose();
});

test("result additions use normalized ID and null name, gate global operations, and close only after dashboard success", async () => {
  const { document, client, controller, application, input, dashboardState, feedback } = await fixture();
  input("name");
  const pending = controller.search();
  client.searches[0]?.result.resolve(searchResults([streamer("B"), streamer("c", { registered: true })]));
  await pending;
  assert.equal(addButton(resultRows(document)[1]!).disabled, true);
  await controller.add("c".repeat(32));
  assert.equal(client.additions.length, 0);
  const add = controller.add("B".repeat(32));
  assert.equal(client.additions[0]?.input, "b".repeat(32));
  assert.equal(client.additions[0]?.name, null);
  assert.equal(document.node("streamer-search").disabled, true);
  assert.equal(document.node("add-dialog").open, true);
  await controller.add("b".repeat(32));
  await controller.search();
  assert.equal(client.additions.length, 1);
  assert.equal(client.searches.length, 1);
  const updated = dashboard();
  updated.channels.push(channel("b".repeat(32)));
  client.additions[0]?.result.resolve(updated);
  await add;
  assert.equal(dashboardState.dashboard, updated);
  assert.equal(document.node("add-dialog").open, false);
  assert.equal(feedback.messages.at(-1), catalogs.en.addSuccess);
  application.dispose();
});

test("failed result additions preserve the dialog and manual drafts, and newer dashboards update registered flags", async () => {
  const { document, client, controller, application, input, dashboardState, feedback } = await fixture();
  document.node("new-channel-id").value = "manual";
  document.node("new-channel-name").value = "custom";
  input("name");
  const pending = controller.search();
  client.searches[0]?.result.resolve(searchResults());
  await pending;
  const add = controller.add("b".repeat(32));
  client.additions[0]?.result.reject(new Error("Native add failed"));
  await add;
  assert.equal(document.node("add-dialog").open, true);
  assert.equal(document.node("new-channel-id").value, "manual");
  assert.equal(document.node("new-channel-name").value, "custom");
  assert.equal(feedback.errors.at(-1)?.target, "add-error");
  const changed = dashboard();
  changed.channels.push(channel("b".repeat(32)));
  dashboardState.accept(changed);
  controller.render();
  assert.equal(addButton(resultRows(document)[0]!).disabled, true);
  await controller.add("b".repeat(32));
  assert.equal(client.additions.length, 1);
  dashboardState.accept(dashboard());
  controller.render();
  assert.equal(addButton(resultRows(document)[0]!).disabled, false);
  dashboardState.beginOperation("save");
  controller.render();
  await controller.search();
  await controller.add("b".repeat(32));
  assert.equal(document.node("search-streamers").disabled, true);
  assert.equal(client.searches.length, 1);
  application.dispose();
});

test("localized result rows render supplied names as text and use safe profile photos with formatted followers", async () => {
  const { document, client, controller, application, input, localizer } = await fixture();
  input("name");
  const pending = controller.search();
  const name = "<img src=x> 日本語 한글";
  client.searches[0]?.result.resolve(searchResults([
    streamer("b", { name, channel_image_url: "https://nng-phinf.pstatic.net/profile.png", follower_count: 12345 }),
    streamer("c", { channel_image_url: "https://evil.example/profile.png", follower_count: null, is_live: false }),
  ]));
  await pending;
  const rows = resultRows(document);
  assert.equal(nameText(rows[0]!), name);
  const images = document.created.filter((node) => node.localName === "img");
  assert.equal(images.length, 1);
  assert.equal(images[0]?.src, "https://nng-phinf.pstatic.net/profile.png");
  assert.equal(images[0]?.referrerPolicy, "no-referrer");
  assert.equal(rows[1]?.children[1]?.children[1]?.hidden, true);
  for (const locale of locales) {
    localizer.setPreference(locale);
    controller.render();
    assert.equal(addButton(rows[0]!).getAttribute("aria-label"), localizer.t("streamerAddLabel", { name }));
    assert.equal(rows[0]?.children[1]?.children[1]?.textContent, localizer.t("streamerFollowers", { count: localizer.number(12345) }));
  }
  assert.equal(rows[0]?.className, "streamer-search-result");
  assert.equal(addButton(rows[0]!).dataset.searchAdd, "b".repeat(32));
  application.dispose();
});

test("delegated result Add hit testing rejects disabled and unrelated buttons", async () => {
  const { document, client, controller, application, input, view } = await fixture();
  input("name");
  const pending = controller.search();
  client.searches[0]?.result.resolve(searchResults());
  await pending;
  const button = addButton(resultRows(document)[0]!);
  let selected: string | null = null;
  button.addEventListener("click", (event) => { selected = view.selectedIdentifier(event); });
  button.dispatchEvent(new Event("click"));
  assert.equal(selected, "b".repeat(32));
  button.disabled = true;
  button.dispatchEvent(new Event("click"));
  assert.equal(selected, null);
  const unrelated = document.add("unrelated", "button");
  unrelated.dataset.searchAdd = "b".repeat(32);
  unrelated.addEventListener("click", (event) => { selected = view.selectedIdentifier(event); });
  unrelated.dispatchEvent(new Event("click"));
  assert.equal(selected, null);
  application.dispose();
});

test("discovery markup retains the manual workflow, uses non-submit buttons, and has no nested forms", () => {
  const html = readFileSync("ui/index.html", "utf8");
  const dialog = html.match(/<dialog id="add-dialog"[\s\S]*?<\/dialog>/)?.[0];
  assert.ok(dialog);
  assert.equal((dialog.match(/<form\b/g) ?? []).length, 1);
  for (const identifier of ["streamer-search", "search-streamers", "streamer-search-results", "streamer-search-status", "streamer-search-more", "new-channel-id", "new-channel-name", "confirm-add"]) {
    assert.ok(dialog.includes(`id="${identifier}"`), identifier);
  }
  for (const identifier of ["search-streamers", "streamer-search-more"]) assert.match(dialog, new RegExp(`id="${identifier}" type="button"`));
  assert.match(html, /id="channel-search" type="search"/);
});

test("invalid names focus the search field without transport calls and unavailable applications remain disabled", async () => {
  const { document, client, controller, application, input, searchState } = await fixture();
  input(" ");
  await controller.search();
  assert.equal(client.searches.length, 0);
  assert.equal(document.node("streamer-search").getAttribute("aria-invalid"), "true");
  assert.equal(document.activeElement, document.node("streamer-search"));
  assert.ok(document.node("streamer-search-status").textContent.includes(catalogs.en.invalidStreamerQuery));
  controller.render();
  assert.equal(document.node("streamer-search").getAttribute("aria-invalid"), "true");
  input("valid");
  assert.equal(searchState.error, null);
  client.available = false;
  controller.render();
  await controller.search();
  assert.equal(document.node("search-streamers").disabled, true);
  assert.equal(client.searches.length, 0);
  application.dispose();
});

test("pagination restores webview-blurred focus without stealing focus from manual fields", async () => {
  const { document, client, controller, application, input } = await fixture();
  input("name");
  const first = controller.search();
  client.searches[0]?.result.resolve(searchResults([streamer()], 20));
  await first;
  const moreButton = document.node("streamer-search-more");
  moreButton.focus();
  const more = controller.search(true);
  document.activeElement = document.body;
  client.searches[1]?.result.resolve(searchResults([streamer("c")], 40));
  await more;
  assert.equal(document.activeElement, moreButton);
  const last = controller.search(true);
  document.activeElement = document.body;
  client.searches[2]?.result.resolve(searchResults([streamer("d")]));
  await last;
  assert.equal(document.activeElement, document.node("streamer-search"));
  const repeat = controller.search();
  client.searches[3]?.result.resolve(searchResults([streamer()], 20));
  await repeat;
  moreButton.focus();
  const next = controller.search(true);
  document.node("new-channel-name").focus();
  client.searches[4]?.result.resolve(searchResults([streamer("c")]));
  await next;
  assert.equal(document.activeElement, document.node("new-channel-name"));
  application.dispose();
});

test("an old result-add completion cannot close a reopened dialog", async () => {
  const { document, client, controller, application, input } = await fixture();
  input("name");
  const first = controller.search();
  client.searches[0]?.result.resolve(searchResults());
  await first;
  const pending = controller.add("b".repeat(32));
  document.node("add-dialog").close();
  controller.close();
  document.node("add-dialog").showModal();
  controller.open();
  const snapshot = dashboard();
  snapshot.channels.push(channel("b".repeat(32)));
  client.additions[0]?.result.resolve(snapshot);
  await pending;
  assert.equal(document.node("add-dialog").open, true);
  assert.equal(document.node("streamer-search").value, "");
  assert.equal(resultRows(document).length, 0);
  application.dispose();
});
