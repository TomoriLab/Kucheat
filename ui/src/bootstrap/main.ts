import { StreamerSearchState } from "../application/state/streamer-search-state.ts";
import { StreamerSearchController } from "../presentation/controllers/streamer-search-controller.ts";
import { StreamerSearchView } from "../presentation/views/streamer-search-view.ts";
import { Localizer } from "../localization/localizer.ts";
import { ApplicationController } from "../application/application-controller.ts";
import { ChannelLibrary } from "../application/state/channel-library.ts";
import { DashboardState } from "../application/state/dashboard-state.ts";
import { SettingsDraft } from "../application/state/settings-draft.ts";
import { BrowserScheduler } from "../infrastructure/browser/scheduler.ts";
import { TauriDesktopClient } from "../infrastructure/tauri/desktop-client.ts";
import { ChannelsController } from "../presentation/controllers/channels-controller.ts";
import { FeedbackController } from "../presentation/controllers/feedback-controller.ts";
import { SettingsController } from "../presentation/controllers/settings-controller.ts";
import { ShellController } from "../presentation/controllers/shell-controller.ts";
import { ChannelDialogsView } from "../presentation/views/channel-dialogs-view.ts";
import { ChannelsView } from "../presentation/views/channels-view.ts";
import { FeedbackView } from "../presentation/views/feedback-view.ts";
import { SettingsView } from "../presentation/views/settings-view.ts";
import { ShellView } from "../presentation/views/shell-view.ts";

const localizer = new Localizer("system", () => navigator.languages, () => navigator.language);
const client = new TauriDesktopClient(window.__TAURI__?.core?.invoke);
const state = new DashboardState();
const scheduler = new BrowserScheduler();
const shell = new ShellView(document, window, state, client.available, localizer);
const feedback = new FeedbackController(new FeedbackView(document, localizer), scheduler);
const application = new ApplicationController(client, state, shell, feedback, scheduler, (actions) => {
  const dialogs = new ChannelDialogsView(document, localizer);
  const search = new StreamerSearchController(new StreamerSearchView(document, localizer),
    new StreamerSearchState(), state, client, actions, localizer, () => dialogs.close("add-dialog"));
  return [
    new ShellController(shell, window, actions),
    new ChannelsController(new ChannelsView(document, localizer), dialogs,
      new ChannelLibrary(), state, client, actions, feedback, localizer, search),
    new SettingsController(new SettingsView(document, localizer), new SettingsDraft(), state, client, actions, feedback, localizer),
  ];
}, localizer);

window.addEventListener("pagehide", () => application.dispose());
window.addEventListener("pageshow", () => application.start());
application.start();
