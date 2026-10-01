import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, mock, test } from "node:test";
import {
  callback,
  claim,
  CLAIM_TTL_MS,
  dropExpiredClaims,
  dropIdleSessions,
  grantsDrive,
  logout,
  SESSION_IDLE_MS,
  start,
  token,
  type DriveEnv,
} from "./drive-auth.ts";
import { sha256Hex } from "./drive-crypto.ts";

const DRIVE = "https://www.googleapis.com/auth/drive";
const WORKER = "https://lady-gestion-push.example.workers.dev";

/**
 * D1 as far as `drive-auth.ts` uses it — `prepare`, `bind`, `run`, `first` —
 * over an in-memory SQLite holding the real migrations: the SQL under test is
 * the SQL that runs, `DELETE … RETURNING` included.
 */
const d1 = (sqlite: DatabaseSync): D1Database => {
  const prepare = (sql: string) => {
    const statement = sqlite.prepare(sql);
    const bound = (params: (string | number | null)[]) => ({
      bind: (...next: (string | number | null)[]) => bound(next),
      run: async () => {
        statement.run(...params);
        return { success: true };
      },
      first: async () => {
        const row = statement.get(...params);
        return row ? { ...row } : null;
      },
    });
    return bound([]);
  };
  return { prepare } as unknown as D1Database;
};

let sqlite: DatabaseSync;
let env: DriveEnv;
/** What the pretend Google token endpoint answers, per `grant_type`. */
let google: Record<string, Record<string, unknown>>;
/** Refresh tokens sent to Google's revoke endpoint. */
let revoked: string[];

/** An ID token as Google's token endpoint returns it; the signature is not read. */
const idToken = (email: string) =>
  `h.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.s`;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").sort()) {
    sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  }
  env = {
    DB: d1(sqlite),
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret",
    DRIVE_SECRET: "drive-secret",
  };
  google = {
    authorization_code: {
      refresh_token: "refresh-1",
      access_token: "ya29.first",
      scope: `openid email ${DRIVE}`,
      id_token: idToken("lea@example.com"),
    },
    refresh_token: { access_token: "ya29.fresh", expires_in: 3599 },
  };
  revoked = [];
  mock.restoreAll();
  mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const body = new URLSearchParams(String(init.body));
    if (input === "https://oauth2.googleapis.com/revoke") {
      revoked.push(body.get("token")!);
      return new Response(null);
    }
    return Response.json(google[body.get("grant_type")!]);
  });
});

/** The app's side: a claim secret, and the sign-in link it opens. */
const signIn = async () => {
  const secret = "c".repeat(43);
  const response = await start(
    new Request(
      `${WORKER}/auth/google/start?claim_hash=${await sha256Hex(secret)}`,
    ),
    env,
  );
  return { secret, google: new URL(response.headers.get("Location")!) };
};

/** Google's redirect back once she has consented. */
const consent = async (googleUrl: URL) =>
  callback(
    new Request(
      `${WORKER}/auth/google/callback?code=code-1&state=${googleUrl.searchParams.get("state")}`,
    ),
    env,
  );

const post = (path: string, init: { body?: unknown; session?: string } = {}) =>
  new Request(`${WORKER}${path}`, {
    method: "POST",
    headers: init.session ? { Authorization: `Bearer ${init.session}` } : {},
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

/** Signed in all the way: the session token the app keeps. */
const session = async (): Promise<string> => {
  const { secret, google: url } = await signIn();
  await consent(url);
  const response = await claim(
    post("/auth/claim", { body: { claim: secret } }),
    env,
    {},
  );
  return ((await response.json()) as { sessionToken: string }).sessionToken;
};

const count = (table: string) =>
  (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number })
    .n;

test("counts a sign-in as Drive only when the Drive box was ticked", () => {
  assert.equal(
    grantsDrive(
      "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive",
    ),
    true,
  );
  // The consent screen's boxes left unticked: a sign-in that reads no file.
  assert.equal(
    grantsDrive("openid https://www.googleapis.com/auth/userinfo.email"),
    false,
  );
  // A narrower Drive scope is not the one the app needs.
  assert.equal(
    grantsDrive("https://www.googleapis.com/auth/drive.file"),
    false,
  );
  assert.equal(grantsDrive(undefined), false);
});

test("sends the sign-in to Google with Drive, a refresh token and PKCE", async () => {
  const { google: url } = await signIn();

  assert.equal(
    url.origin + url.pathname,
    "https://accounts.google.com/o/oauth2/v2/auth",
  );
  assert.equal(url.searchParams.get("scope"), `openid email ${DRIVE}`);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    `${WORKER}/auth/google/callback`,
  );
});

test("refuses a sign-in link without a proper claim hash", async () => {
  const response = await start(
    new Request(`${WORKER}/auth/google/start?claim_hash=nope`),
    env,
  );
  assert.equal(response.status, 400);
});

test("refuses a callback whose state was not signed here", async () => {
  const { google: url } = await signIn();
  url.searchParams.set("state", `${url.searchParams.get("state")}x`);

  assert.equal((await consent(url)).status, 400);
  assert.equal(count("drive_claims"), 0);
});

test("hands the session over once, to the app holding the claim secret", async () => {
  const { secret, google: url } = await signIn();

  // Still on Google's screen: nothing to claim yet.
  const early = await claim(
    post("/auth/claim", { body: { claim: secret } }),
    env,
    {},
  );
  assert.equal(early.status, 404);

  assert.equal((await consent(url)).status, 200);
  // Parked encrypted, never as Google sent it.
  const parked = sqlite
    .prepare("SELECT refresh_token FROM drive_claims")
    .get() as {
    refresh_token: string;
  };
  assert.notEqual(parked.refresh_token, "refresh-1");

  const wrong = await claim(
    post("/auth/claim", { body: { claim: "d".repeat(43) } }),
    env,
    {},
  );
  assert.equal(wrong.status, 404);

  const claimed = await claim(
    post("/auth/claim", { body: { claim: secret } }),
    env,
    {},
  );
  assert.equal(claimed.status, 200);
  const account = (await claimed.json()) as Record<string, string>;
  assert.equal(account.email, "lea@example.com");
  assert.equal(account.scope, `openid email ${DRIVE}`);
  assert.equal(count("drive_claims"), 0);
  // Stored by its hash only.
  const stored = sqlite.prepare("SELECT id FROM drive_sessions").get() as {
    id: string;
  };
  assert.equal(stored.id, await sha256Hex(account.sessionToken!));

  const again = await claim(
    post("/auth/claim", { body: { claim: secret } }),
    env,
    {},
  );
  assert.equal(again.status, 404);
});

test("lets a finished sign-in be claimed for ten minutes, not after", async () => {
  const { secret, google: url } = await signIn();
  await consent(url);
  const later = Date.now() + CLAIM_TTL_MS + 1;
  mock.method(Date, "now", () => later);

  const response = await claim(
    post("/auth/claim", { body: { claim: secret } }),
    env,
    {},
  );
  assert.equal(response.status, 404);

  await dropExpiredClaims(env, later);
  assert.equal(count("drive_claims"), 0);
});

test("undoes a sign-in with the Drive box unticked, and keeps nothing", async () => {
  google.authorization_code!.scope = "openid email";
  const { google: url } = await signIn();

  const response = await consent(url);

  assert.match(await response.text(), /Accès à Google Drive non autorisé/);
  assert.deepEqual(revoked, ["refresh-1"]);
  assert.equal(count("drive_claims"), 0);
});

test("trades the session for an access token, and records the use", async () => {
  const sessionToken = await session();
  sqlite.prepare("UPDATE drive_sessions SET last_used_at = 0").run();

  const response = await token(
    post("/drive/token", { session: sessionToken }),
    env,
    {},
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    accessToken: string;
    expiresAt: number;
  };
  assert.equal(body.accessToken, "ya29.fresh");
  assert.ok(body.expiresAt > Date.now());
  const row = sqlite
    .prepare("SELECT last_used_at FROM drive_sessions")
    .get() as {
    last_used_at: number;
  };
  assert.ok(row.last_used_at > 0);
});

test("answers 401 to a session it does not know", async () => {
  await session();
  const response = await token(
    post("/drive/token", { session: "unknown" }),
    env,
    {},
  );
  assert.equal(response.status, 401);
  const none = await token(post("/drive/token"), env, {});
  assert.equal(none.status, 401);
});

test("forgets a session Google has revoked, and answers 401", async () => {
  const sessionToken = await session();
  google.refresh_token = { error: "invalid_grant" };

  const response = await token(
    post("/drive/token", { session: sessionToken }),
    env,
    {},
  );

  assert.equal(response.status, 401);
  assert.equal(count("drive_sessions"), 0);
});

test("drops a session its secret no longer opens, and answers 401", async () => {
  const sessionToken = await session();
  env.DRIVE_SECRET = "rotated-secret";

  const response = await token(
    post("/drive/token", { session: sessionToken }),
    env,
    {},
  );

  assert.equal(response.status, 401);
  assert.equal(count("drive_sessions"), 0);
});

test("keeps the session through a Google hiccup, answering 502", async () => {
  const sessionToken = await session();
  google.refresh_token = { error: "temporarily_unavailable" };

  const response = await token(
    post("/drive/token", { session: sessionToken }),
    env,
    {},
  );

  assert.equal(response.status, 502);
  assert.equal(count("drive_sessions"), 1);
});

test("signs out: revoked at Google, forgotten here", async () => {
  const sessionToken = await session();

  const response = await logout(
    post("/auth/logout", { session: sessionToken }),
    env,
    {},
  );

  assert.equal(response.status, 204);
  assert.deepEqual(revoked, ["refresh-1"]);
  assert.equal(count("drive_sessions"), 0);
  const after = await token(
    post("/drive/token", { session: sessionToken }),
    env,
    {},
  );
  assert.equal(after.status, 401);
});

test("drops a session left unused for Google's six months, and only that one", async () => {
  await session();
  await session();
  const now = Date.now();
  sqlite
    .prepare("UPDATE drive_sessions SET last_used_at = ?1 WHERE rowid = 1")
    .run(now - SESSION_IDLE_MS);

  await dropIdleSessions(env, now);

  assert.equal(count("drive_sessions"), 1);
});
