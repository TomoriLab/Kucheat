import test from "node:test";
import assert from "node:assert/strict";

import { profileImageUrl } from "../src/domain/rules.ts";
import { ChannelAvatarView } from "../src/presentation/views/channel-avatar-view.ts";
import { AvatarDocument } from "./support/avatar-dom.ts";
import { channel } from "./support/dashboard.ts";

const imageUrl = "https://nng-phinf.pstatic.net/profile.png?type=f120_120";

function fixture() {
  const document = new AvatarDocument();
  return { document, view: new ChannelAvatarView(document.asDocument()) };
}

test("profile images accept only HTTPS NAVER CDN URLs without credentials or custom ports", () => {
  for (const host of ["nng-phinf.pstatic.net", "profile-phinf.pstatic.net", "ssl.pstatic.net"]) {
    const url = `https://${host}/profile.png`;
    assert.equal(profileImageUrl(url), url);
  }
  for (const value of [
    null, undefined, "", " ", 1, {}, "/profile.png", "javascript:alert(1)",
    "data:image/png;base64,a", "file:///etc/passwd", "blob:https://nng-phinf.pstatic.net/id",
    "http://nng-phinf.pstatic.net/profile.png", "https://pstatic.net/profile.png",
    "https://pstatic.net.evil.example/profile.png", "https://evilpstatic.net/profile.png",
    "https://user:secret@nng-phinf.pstatic.net/profile.png", "https://nng-phinf.pstatic.net:444/profile.png",
  ]) assert.equal(profileImageUrl(value), null, String(value));
});

test("missing or untrusted profile images retain the existing Unicode initial fallback", () => {
  const { document, view } = fixture();
  const streamer = { ...channel(), name: "한글 스트리머" };
  view.render(streamer);
  assert.equal(document.fallback.textContent, "한");
  assert.equal(document.fallback.hidden, false);
  assert.equal(document.root.attributes.get("aria-hidden"), "true");
  view.render({ ...streamer, name: "", channel_image_url: "https://evil.example/profile.png" });
  assert.equal(document.fallback.textContent, "A");
  assert.equal(document.images.length, 0);
});

test("profile loading preserves the fallback until success and avoids reloading on dashboard polls", () => {
  const { document, view } = fixture();
  const streamer = { ...channel(), channel_image_url: imageUrl };
  view.render(streamer);
  const image = document.images[0]!;
  assert.equal(image.src, imageUrl);
  assert.equal(image.loading, "lazy");
  assert.equal(image.decoding, "async");
  assert.equal(image.referrerPolicy, "no-referrer");
  assert.equal(image.alt, "");
  assert.equal(image.hidden, false);
  assert.equal(image.className, "channel-avatar-image");
  assert.equal(document.fallback.hidden, false);
  image.dispatchEvent(new Event("load"));
  assert.equal(image.hidden, false);
  assert.equal(document.fallback.hidden, true);
  for (let index = 0; index < 5; index += 1) view.render(streamer);
  assert.equal(document.images.length, 1);
  assert.equal(image.className, "channel-avatar-image is-loaded");
});

test("failed images fall back to initials without retrying on every poll", () => {
  const { document, view } = fixture();
  const streamer = { ...channel(), name: "Streamer", channel_image_url: imageUrl };
  view.render(streamer);
  const image = document.images[0]!;
  image.dispatchEvent(new Event("error"));
  assert.equal(image.className, "channel-avatar-image");
  assert.equal(document.fallback.hidden, false);
  view.render({ ...streamer, name: "Renamed" });
  assert.equal(document.fallback.textContent, "R");
  assert.equal(document.images.length, 1);
});

test("changed profile URLs replace the image and ignore stale load or error events", () => {
  const { document, view } = fixture();
  const streamer = { ...channel(), channel_image_url: imageUrl };
  view.render(streamer);
  const previous = document.images[0]!;
  const changedUrl = "https://profile-phinf.pstatic.net/replacement.jpg";
  view.render({ ...streamer, channel_image_url: changedUrl });
  const replacement = document.images[1]!;
  assert.equal(previous.parent, undefined);
  assert.equal(previous.src, "");
  assert.equal(replacement.src, changedUrl);
  previous.dispatchEvent(new Event("load"));
  assert.equal(document.fallback.hidden, false);
  replacement.dispatchEvent(new Event("load"));
  previous.dispatchEvent(new Event("error"));
  assert.equal(document.fallback.hidden, true);
  assert.equal(replacement.className, "channel-avatar-image is-loaded");
});

test("removed profile URLs clear the previous image and prevent late responses from hiding the fallback", () => {
  const { document, view } = fixture();
  const streamer = { ...channel(), channel_image_url: imageUrl };
  view.render(streamer);
  const previous = document.images[0]!;
  view.render({ ...streamer, channel_image_url: null });
  previous.dispatchEvent(new Event("load"));
  assert.equal(document.root.children.length, 1);
  assert.equal(document.fallback.hidden, false);
});
