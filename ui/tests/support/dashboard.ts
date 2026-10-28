import type { Channel, Dashboard } from "../../src/domain/types.ts";

export function channel(identifier = "a".repeat(32), live: boolean | null = null): Channel {
  return {
    id: identifier, name: identifier, is_live: live, live_title: null, category: null,
    channel_image_url: null,
    viewer_count: null, last_checked: null, went_live_at: null,
  };
}

export function dashboard(interval = 60): Dashboard {
  return {
    channels: [channel()],
    settings: { check_interval_secs: interval, notify_offline: true },
    api: { client_id: "client-id", has_client_secret: true },
    auto_launch: false, auto_launch_error: null,
    monitor: { running: true, checking: false, last_error: null, last_checked: null, host: null },
    session_type: "wayland", version: "test",
  };
}
