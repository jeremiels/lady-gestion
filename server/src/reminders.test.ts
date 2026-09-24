import assert from "node:assert/strict";
import { test } from "node:test";
import { LATE_LIMIT_MS, parseReminderList, splitDue } from "./reminders.ts";

const NOW = Date.UTC(2026, 8, 24, 12);

const request = (overrides: Record<string, unknown> = {}) => ({
  subscription: {
    endpoint: "https://web.push.apple.com/QGuQyavXutnMH",
    keys: { p256dh: "BCVxsr7N", auth: "BTBZMqHH" },
  },
  reminders: [
    { postId: "b", fireAt: NOW + 2000, title: "Vermifuge", body: "" },
    { postId: "a", fireAt: NOW + 1000, title: "Cure", body: "Cures · 8h00" },
  ],
  ...overrides,
});

test("reads a list, soonest first", () => {
  const list = parseReminderList(request(), NOW);
  assert.deepEqual(
    list?.reminders.map((reminder) => reminder.postId),
    ["a", "b"],
  );
  assert.equal(list?.target.keys.auth, "BTBZMqHH");
});

test("drops a reminder already due, so a sent one never comes back", () => {
  const list = parseReminderList(
    request({
      reminders: [{ postId: "a", fireAt: NOW, title: "Cure", body: "" }],
    }),
    NOW,
  );
  assert.deepEqual(list?.reminders, []);
});

test("refuses an endpoint that is not a known push service", () => {
  for (const endpoint of [
    "https://example.com/push",
    "http://web.push.apple.com/x",
    "https://web.push.apple.com.evil.test/x",
  ]) {
    const body = request();
    body.subscription.endpoint = endpoint;
    assert.equal(parseReminderList(body, NOW), null, endpoint);
  }
});

test("refuses a malformed reminder rather than keeping the rest", () => {
  const body = request({
    reminders: [{ postId: "a", fireAt: "tomorrow", title: "Cure", body: "" }],
  });
  assert.equal(parseReminderList(body, NOW), null);
});

test("sends what is due, keeps what is not, drops what is too late", () => {
  const at = (postId: string, fireAt: number) => ({
    postId,
    fireAt,
    title: postId,
    body: "",
  });
  const { due, later } = splitDue(
    [
      at("stale", NOW - LATE_LIMIT_MS - 1),
      at("due", NOW - 1000),
      at("later", NOW + 1000),
    ],
    NOW,
  );
  assert.deepEqual(
    due.map((reminder) => reminder.postId),
    ["due"],
  );
  assert.deepEqual(
    later.map((reminder) => reminder.postId),
    ["later"],
  );
});
