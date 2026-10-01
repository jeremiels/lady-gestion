import {
  decrypt,
  deriveKeys,
  emailOfIdToken,
  encrypt,
  isClaimHash,
  packState,
  pkceChallenge,
  pkceVerifier,
  randomToken,
  sha256Hex,
  unpackState,
} from "./drive-crypto.ts";

/**
 * Google Drive sign-in: the token broker `docs/drive-spec.md` §7.2 describes.
 *
 * Google redirects here rather than to the app, because on an iPhone the
 * consent screen opens in a Safari sheet whose storage is not the home-screen
 * app's. The app then *claims* the session with a secret only it holds, and
 * from then on trades its session token for one-hour access tokens. The
 * refresh token never leaves this Worker, and is stored encrypted; files go
 * between the phone and Drive directly and never pass through here.
 */

export interface DriveEnv {
  DB: D1Database;
  /** Public: the OAuth client this Worker signs in as. Empty until set up. */
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** Random string; the AES and HMAC keys are derived from it. Secret. */
  DRIVE_SECRET: string;
}

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

/** `drive` (docs/drive-spec.md D10), plus the address shown as "connected as". */
const SCOPE = `openid email ${DRIVE_SCOPE}`;

/**
 * Whether Google granted Drive itself. Its consent screen has one box per
 * permission, and an unticked Drive box still comes back as a successful
 * sign-in — one that can read no file.
 */
export const grantsDrive = (scope: string | undefined): boolean =>
  (scope ?? "").split(" ").includes(DRIVE_SCOPE);

/** How long the app has to come back and claim a finished sign-in. */
export const CLAIM_TTL_MS = 10 * 60 * 1000;
/** How long the consent screen may stay open. */
const STATE_TTL_MS = 30 * 60 * 1000;
/**
 * How long a session may go unused before it is dropped: Google's own limit
 * for a refresh token nobody uses, past which it answers `invalid_grant`
 * anyway. A lost phone's session goes then, refresh token and all, rather
 * than sitting here encrypted for ever.
 */
export const SESSION_IDLE_MS = 180 * 24 * 60 * 60 * 1000;

const json = (body: unknown, status: number, headers: HeadersInit): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

/** The page the Safari sheet shows at the end; French, like the app. */
const page = (title: string, message: string, status = 200): Response =>
  new Response(
    `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:17px/1.4 system-ui,sans-serif;padding:24px"><h1 style="font-size:22px">${title}</h1><p>${message}</p></body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );

const redirectUri = (request: Request): string =>
  `${new URL(request.url).origin}/auth/google/callback`;

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
};

const tokenRequest = async (
  body: Record<string, string>,
): Promise<TokenResponse> => {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  return (await response.json()) as TokenResponse;
};

/** GET /auth/google/start?claim_hash=… — on to Google's consent screen. */
export const start = async (
  request: Request,
  env: DriveEnv,
): Promise<Response> => {
  if (!env.GOOGLE_CLIENT_ID) {
    return page(
      "Indisponible",
      "La connexion à Google Drive n'est pas encore configurée.",
      503,
    );
  }
  const claimHash = new URL(request.url).searchParams.get("claim_hash") ?? "";
  if (!isClaimHash(claimHash)) {
    return page("Lien invalide", "Recommencez depuis l'application.", 400);
  }

  const keys = await deriveKeys(env.DRIVE_SECRET);
  const nonce = randomToken();
  const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(request),
    response_type: "code",
    scope: SCOPE,
    // A refresh token, every time: without `prompt=consent` Google sends one
    // only on the first grant, and a second sign-in would come back without.
    access_type: "offline",
    prompt: "consent",
    code_challenge: await pkceChallenge(await pkceVerifier(keys, nonce)),
    code_challenge_method: "S256",
    state: await packState(keys, {
      claimHash,
      nonce,
      expiresAt: Date.now() + STATE_TTL_MS,
    }),
  }).toString();
  return Response.redirect(google.toString(), 302);
};

/**
 * GET /auth/google/callback — exchanges the code and parks the refresh token,
 * encrypted, under the claim hash until the app comes back for it.
 *
 * The session itself is only created by the claim: a sign-in the app never
 * returns to leaves a row the cron deletes, not a live session nobody holds.
 */
export const callback = async (
  request: Request,
  env: DriveEnv,
): Promise<Response> => {
  const params = new URL(request.url).searchParams;
  if (params.get("error")) {
    return page("Connexion annulée", "Revenez à l'application pour réessayer.");
  }

  const keys = await deriveKeys(env.DRIVE_SECRET);
  const state = await unpackState(keys, params.get("state") ?? "", Date.now());
  if (!state) {
    return page("Lien expiré", "Recommencez depuis l'application.", 400);
  }

  const tokens = await tokenRequest({
    code: params.get("code") ?? "",
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri(request),
    grant_type: "authorization_code",
    code_verifier: await pkceVerifier(keys, state.nonce),
  });
  const email = tokens.id_token ? emailOfIdToken(tokens.id_token) : null;
  if (tokens.refresh_token && !grantsDrive(tokens.scope)) {
    // Undone rather than kept: the next consent screen then asks afresh, with
    // the Drive box shown again.
    await revoke(tokens.refresh_token);
    return page(
      "Accès à Google Drive non autorisé",
      "Revenez à l'application et recommencez : sur l'écran de Google, cochez la case qui donne accès à vos fichiers Google Drive.",
    );
  }
  if (!tokens.refresh_token || !email) {
    console.warn("drive token exchange refused", tokens.error);
    return page(
      "Connexion impossible",
      "Google a refusé la connexion. Recommencez depuis l'application.",
      502,
    );
  }

  await env.DB.prepare(
    `INSERT OR REPLACE INTO drive_claims (claim_hash, refresh_token, email, scope, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(
      state.claimHash,
      await encrypt(keys, tokens.refresh_token),
      email,
      tokens.scope ?? "",
      Date.now() + CLAIM_TTL_MS,
    )
    .run();

  return page(
    "C'est fait",
    "Google Drive est connecté. Fermez cette fenêtre et revenez à l'application.",
  );
};

/**
 * POST /auth/claim {claim} → {sessionToken, email, scope}, once.
 *
 * 404 while the sign-in is still on Google's side: the app asks again each
 * time it comes back to the foreground, and "not yet" is the normal answer.
 */
export const claim = async (
  request: Request,
  env: DriveEnv,
  cors: HeadersInit,
): Promise<Response> => {
  let body: { claim?: unknown };
  try {
    body = (await request.json()) as { claim?: unknown };
  } catch {
    return json({ error: "bad_request" }, 400, cors);
  }
  if (typeof body.claim !== "string" || body.claim.length < 32) {
    return json({ error: "bad_request" }, 400, cors);
  }

  const row = await env.DB.prepare(
    `DELETE FROM drive_claims WHERE claim_hash = ?1 AND expires_at > ?2
     RETURNING refresh_token, email, scope`,
  )
    .bind(await sha256Hex(body.claim), Date.now())
    .first<{ refresh_token: string; email: string; scope: string }>();
  if (!row) return json({ error: "not_found" }, 404, cors);

  const sessionToken = randomToken();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO drive_sessions (id, refresh_token, email, scope, created_at, last_used_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
  )
    .bind(
      await sha256Hex(sessionToken),
      row.refresh_token,
      row.email,
      row.scope,
      now,
    )
    .run();

  return json({ sessionToken, email: row.email, scope: row.scope }, 200, cors);
};

/**
 * The session a request's bearer token names, `null` when there is none. One
 * whose refresh token no longer opens — `DRIVE_SECRET` was changed — is
 * dropped and reads as none: the app is then asked to connect again, where
 * an error would leave it failing on every sync with nothing to act on.
 */
const sessionOf = async (request: Request, env: DriveEnv) => {
  const token =
    request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
  if (!token) return null;
  const id = await sha256Hex(token);
  const row = await env.DB.prepare(
    "SELECT refresh_token FROM drive_sessions WHERE id = ?1",
  )
    .bind(id)
    .first<{ refresh_token: string }>();
  if (!row) return null;
  const keys = await deriveKeys(env.DRIVE_SECRET);
  try {
    return { id, refreshToken: await decrypt(keys, row.refresh_token) };
  } catch {
    await env.DB.prepare("DELETE FROM drive_sessions WHERE id = ?1")
      .bind(id)
      .run();
    return null;
  }
};

/**
 * POST /drive/token (Bearer session) → {accessToken, expiresAt, scope}.
 *
 * 401 means signed out for good — unknown session, or Google revoked the grant
 * (`invalid_grant`, e.g. access removed from the Google account page) — and
 * the app shows "Connecter Google Drive" again. Anything else is transient.
 */
export const token = async (
  request: Request,
  env: DriveEnv,
  cors: HeadersInit,
): Promise<Response> => {
  const session = await sessionOf(request, env);
  if (!session) return json({ error: "unauthorized" }, 401, cors);

  const tokens = await tokenRequest({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: session.refreshToken,
    grant_type: "refresh_token",
  });
  if (tokens.error === "invalid_grant") {
    await env.DB.prepare("DELETE FROM drive_sessions WHERE id = ?1")
      .bind(session.id)
      .run();
    return json({ error: "unauthorized" }, 401, cors);
  }
  if (!tokens.access_token) return json({ error: "unavailable" }, 502, cors);

  await env.DB.prepare(
    "UPDATE drive_sessions SET last_used_at = ?1 WHERE id = ?2",
  )
    .bind(Date.now(), session.id)
    .run();
  return json(
    {
      accessToken: tokens.access_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      scope: tokens.scope ?? "",
    },
    200,
    cors,
  );
};

/**
 * POST /auth/logout (Bearer session) — revokes the grant at Google, then
 * forgets the session. Nothing in the user's Drive is touched.
 */
export const logout = async (
  request: Request,
  env: DriveEnv,
  cors: HeadersInit,
): Promise<Response> => {
  const session = await sessionOf(request, env);
  if (session) {
    await revoke(session.refreshToken);
    await env.DB.prepare("DELETE FROM drive_sessions WHERE id = ?1")
      .bind(session.id)
      .run();
  }
  return new Response(null, { status: 204, headers: cors });
};

/** Ends a grant at Google; best effort, since nothing here can retry it. */
const revoke = async (refreshToken: string): Promise<void> => {
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
  }).catch(() => null);
};

/** Sessions unused for `SESSION_IDLE_MS`, dropped by the cron with their refresh token. */
export const dropIdleSessions = async (
  env: DriveEnv,
  now: number,
): Promise<void> => {
  await env.DB.prepare("DELETE FROM drive_sessions WHERE last_used_at <= ?1")
    .bind(now - SESSION_IDLE_MS)
    .run();
};

/** Claims nobody came back for, dropped by the cron with their refresh token. */
export const dropExpiredClaims = async (
  env: DriveEnv,
  now: number,
): Promise<void> => {
  await env.DB.prepare("DELETE FROM drive_claims WHERE expires_at <= ?1")
    .bind(now)
    .run();
};
