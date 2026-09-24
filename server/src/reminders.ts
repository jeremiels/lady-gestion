import type { PushTarget } from "./web-push.ts";

/**
 * One reminder as the app sends it (`Reminder`, `src/data/reminders.ts`) —
 * and, unchanged, the push payload the service worker shows.
 */
export type Reminder = {
  postId: string;
  fireAt: number;
  title: string;
  body: string;
};

export type ReminderList = { target: PushTarget; reminders: Reminder[] };

/**
 * Push services this Worker will post to. Anything else is refused: the
 * endpoint is a URL a stranger can hand in, and without this list the cron
 * would make requests to wherever it was told.
 */
const PUSH_HOSTS = [
  /^web\.push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

/** Far more than one horse's cures and treatments ever hold at once. */
const MAX_REMINDERS = 100;

const isString = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

const isPushEndpoint = (value: unknown): value is string => {
  if (!isString(value, 1024)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      PUSH_HOSTS.some((host) => host.test(url.hostname))
    );
  } catch {
    return false;
  }
};

const parseReminder = (value: unknown): Reminder | null => {
  if (typeof value !== "object" || value === null) return null;
  const { postId, fireAt, title, body } = value as Record<string, unknown>;
  if (
    !isString(postId, 64) ||
    typeof fireAt !== "number" ||
    !Number.isSafeInteger(fireAt) ||
    !isString(title, 200) ||
    typeof body !== "string" ||
    body.length > 300
  ) {
    return null;
  }
  return { postId, fireAt, title, body };
};

/**
 * Reads a `PUT /reminders` body, or `null` when any of it is malformed.
 *
 * Reminders already due at `now` are dropped here, not sent: the app's list
 * can be a few minutes stale, and one the cron has just sent would otherwise
 * come back in it and go out twice.
 */
export const parseReminderList = (
  input: unknown,
  now: number,
): ReminderList | null => {
  if (typeof input !== "object" || input === null) return null;
  const { subscription, reminders } = input as Record<string, unknown>;

  if (typeof subscription !== "object" || subscription === null) return null;
  const { endpoint, keys } = subscription as Record<string, unknown>;
  if (!isPushEndpoint(endpoint)) return null;
  if (typeof keys !== "object" || keys === null) return null;
  const { p256dh, auth } = keys as Record<string, unknown>;
  if (!isString(p256dh, 128) || !isString(auth, 64)) return null;

  if (!Array.isArray(reminders) || reminders.length > MAX_REMINDERS) {
    return null;
  }
  const parsed = reminders.map(parseReminder);
  if (parsed.some((reminder) => reminder === null)) return null;

  return {
    target: { endpoint, keys: { p256dh, auth } },
    reminders: (parsed as Reminder[])
      .filter((reminder) => reminder.fireAt > now)
      .sort((a, b) => a.fireAt - b.fireAt),
  };
};

/** A reminder this late is dropped rather than sent: the moment has passed. */
export const LATE_LIMIT_MS = 60 * 60 * 1000;

/**
 * What the cron does with one device's list at `now`: the reminders to send,
 * and the ones to keep for later. Anything due but past `LATE_LIMIT_MS` is in
 * neither — after an outage, a burst of stale reminders helps nobody.
 */
export const splitDue = (
  reminders: Reminder[],
  now: number,
): { due: Reminder[]; later: Reminder[] } => ({
  due: reminders.filter(
    (reminder) =>
      reminder.fireAt <= now && now - reminder.fireAt <= LATE_LIMIT_MS,
  ),
  later: reminders.filter((reminder) => reminder.fireAt > now),
});
