import * as driveAuth from "./drive-auth.ts";
import { homePage, privacyPage } from "./pages.ts";
import { parseReminderList, splitDue, type Reminder } from "./reminders.ts";
import { sendPush, type VapidConfig } from "./web-push.ts";

/**
 * lady-gestion's server: the push scheduler, and the Google Drive sign-in
 * (`drive-auth.ts`) — the two things the app cannot do on its own.
 *
 * The app sends each device's whole reminder list (`PUT /reminders`) whenever
 * it changes; a cron every minute sends whatever has fallen due. It holds no
 * posts — only what each notification shows, until it has been shown — and
 * IndexedDB on the phone stays the source of truth: losing this database
 * loses nothing the next sync does not rewrite.
 */

interface Env extends driveAuth.DriveEnv {
  DB: D1Database;
  /** The VAPID private key, as a JWK — `npm run vapid` prints it. Secret. */
  VAPID_PRIVATE_KEY: string;
  /** Who push services contact about this server: a `mailto:` or an `https:` URL. */
  VAPID_SUBJECT: string;
  /** Comma-separated origins allowed to call the API, besides localhost. */
  ALLOWED_ORIGINS: string;
}

/** One row per subscribed device. */
type SubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
  reminders: string;
  next_fire_at: number | null;
};

const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const corsHeaders = (request: Request, env: Env): Record<string, string> => {
  const origin = request.headers.get("Origin") ?? "";
  const allowed =
    LOCALHOST.test(origin) ||
    env.ALLOWED_ORIGINS.split(",").some((one) => one.trim() === origin);
  return allowed
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "PUT, POST",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      }
    : { Vary: "Origin" };
};

/**
 * Replaces this device's list with the one sent. Whole-list rather than per
 * reminder, so a post deleted or unticked on the phone cannot linger here.
 */
const putReminders = async (request: Request, env: Env): Promise<number> => {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return 400;
  }
  const list = parseReminderList(input, Date.now());
  if (!list) return 400;

  await env.DB.prepare(
    `INSERT INTO subscriptions (endpoint, p256dh, auth, reminders, next_fire_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT (endpoint) DO UPDATE SET
       p256dh = ?2, auth = ?3, reminders = ?4, next_fire_at = ?5, updated_at = ?6`,
  )
    .bind(
      list.target.endpoint,
      list.target.keys.p256dh,
      list.target.keys.auth,
      JSON.stringify(list.reminders),
      list.reminders[0]?.fireAt ?? null,
      Date.now(),
    )
    .run();
  return 204;
};

/**
 * Sends every reminder that has fallen due, device by device.
 *
 * The row is rewritten only if it still holds the list this run read: a
 * `PUT` landing mid-run wins, and since `parseReminderList` drops anything
 * already due, the new list cannot bring back what was just sent.
 */
const sendDue = async (env: Env, now: number): Promise<void> => {
  const { results } = await env.DB.prepare(
    "SELECT * FROM subscriptions WHERE next_fire_at <= ?1",
  )
    .bind(now)
    .all<SubscriptionRow>();

  const vapid: VapidConfig = {
    subject: env.VAPID_SUBJECT,
    privateJwk: JSON.parse(env.VAPID_PRIVATE_KEY) as JsonWebKey,
  };

  for (const row of results) {
    const { due, later } = splitDue(
      JSON.parse(row.reminders) as Reminder[],
      now,
    );
    const target = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    };

    let gone = false;
    const retry: Reminder[] = [];
    for (const reminder of due) {
      const response = await sendPush(target, reminder, vapid, now).catch(
        () => null,
      );
      if (response?.status === 404 || response?.status === 410) {
        gone = true;
        break;
      }
      // Throttled or a server error: tried again next minute, until too late.
      if (!response || response.status === 429 || response.status >= 500) {
        retry.push(reminder);
      } else if (!response.ok) {
        console.warn("push refused", response.status, await response.text());
      }
    }

    if (gone) {
      await env.DB.prepare("DELETE FROM subscriptions WHERE endpoint = ?1")
        .bind(row.endpoint)
        .run();
      continue;
    }

    const remaining = [...retry, ...later];
    await env.DB.prepare(
      `UPDATE subscriptions SET reminders = ?1, next_fire_at = ?2
       WHERE endpoint = ?3 AND reminders = ?4`,
    )
      .bind(
        JSON.stringify(remaining),
        remaining.length > 0
          ? Math.min(...remaining.map((reminder) => reminder.fireAt))
          : null,
        row.endpoint,
        row.reminders,
      )
      .run();
  }
};

type ApiRoute = {
  method: string;
  handle: (request: Request, env: Env, cors: HeadersInit) => Promise<Response>;
};

/** The app's API: called with `fetch`, so CORS applies. */
const API = new Map<string, ApiRoute>([
  [
    "/reminders",
    {
      method: "PUT",
      handle: async (request, env, cors) =>
        new Response(null, {
          status: await putReminders(request, env),
          headers: cors,
        }),
    },
  ],
  ["/auth/claim", { method: "POST", handle: driveAuth.claim }],
  ["/drive/token", { method: "POST", handle: driveAuth.token }],
  ["/auth/logout", { method: "POST", handle: driveAuth.logout }],
]);

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // The two public pages Google's consent screen links to.
    if (request.method === "GET" && pathname === "/") return homePage();
    if (request.method === "GET" && pathname === "/confidentialite") {
      return privacyPage();
    }

    // Navigations in the sign-in's Safari sheet, not API calls: no CORS.
    if (request.method === "GET" && pathname === "/auth/google/start") {
      return driveAuth.start(request, env);
    }
    if (request.method === "GET" && pathname === "/auth/google/callback") {
      return driveAuth.callback(request, env);
    }

    const cors = corsHeaders(request, env);
    const route = API.get(pathname);
    if (!route) {
      return new Response(null, { status: 404, headers: cors });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== route.method) {
      return new Response(null, { status: 405, headers: cors });
    }
    return route.handle(request, env, cors);
  },

  async scheduled(_controller, env): Promise<void> {
    // Now rather than `scheduledTime`, the top of the minute: a reminder due a
    // few seconds into it goes out on this run, not the next.
    const now = Date.now();
    await sendDue(env, now);
    await driveAuth.dropExpiredClaims(env, now);
  },
} satisfies ExportedHandler<Env>;
