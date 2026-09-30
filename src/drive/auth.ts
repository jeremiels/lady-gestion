/**
 * Google Drive sign-in, as `docs/drive-spec.md` §7.2 lays it out.
 *
 * The consent screen opens in a Safari sheet whose storage is not the
 * home-screen app's, so Google hands the result to the Worker rather than to
 * the app. The app keeps a secret (`driveClaim`) whose hash it sent along, and
 * claims the session with it on its next return to the foreground. From then
 * on it trades the session token for one-hour access tokens, held in memory
 * only.
 *
 * Everything the rest of the app reacts to is in `meta` — `googleAccount`,
 * `driveFolder` — so views follow through `LiveQuery` like any other data.
 * With the Worker down, sign-in waits and nothing else changes.
 */

import { metaRepo } from "../data/index.ts";
import type { DriveMeta } from "../data/types.ts";
import { DRIVE_AUTH_URL } from "./drive-config.ts";

export type GoogleAccount = DriveMeta["googleAccount"];
type PendingClaim = DriveMeta["driveClaim"];

/**
 * How long a sign-in stays claimable from the app's side: the Worker's state
 * lives 30 minutes and a finished sign-in waits 10 more, so past this the
 * claim can only ever answer "not found".
 */
const CLAIM_LIFETIME_MS = 40 * 60 * 1000;

/** Thrown when Drive is not, or no longer, connected. */
export class DriveSignedOutError extends Error {
  constructor() {
    super("Google Drive n’est pas connecté.");
  }
}

const toBase64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const sha256Hex = async (text: string): Promise<string> =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const isFresh = (pending: PendingClaim | undefined, now: number) =>
  pending !== undefined && now - pending.createdAt < CLAIM_LIFETIME_MS;

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

/**
 * Whether Google granted Drive itself: its consent screen has one box per
 * permission, and a sign-in with the Drive box unticked reads no file. The
 * Worker refuses such a sign-in; this is the app's own check on top.
 */
const grantsDrive = (scope: string): boolean =>
  scope.split(" ").includes(DRIVE_SCOPE);

/** Signed in with Drive access, or `undefined`. */
export const getAccount = async (): Promise<GoogleAccount | undefined> => {
  const account = await metaRepo.get<GoogleAccount>("googleAccount");
  return account && grantsDrive(account.scope) ? account : undefined;
};

/**
 * The address "Connecter Google Drive" opens.
 *
 * Built before the tap, not in it: iOS opens a new window only from inside
 * the gesture, with nothing awaited first — so the view renders this as a
 * plain link. The claim secret is written here too, which is what lets the
 * app finish the sign-in whenever it comes back, even after a reload.
 */
export const prepareSignIn = async (now = Date.now()): Promise<string> => {
  let pending = await metaRepo.get<PendingClaim>("driveClaim");
  if (!isFresh(pending, now)) {
    pending = {
      claim: toBase64url(crypto.getRandomValues(new Uint8Array(32))),
      createdAt: now,
    };
    await metaRepo.set("driveClaim", pending);
  }
  const claimHash = await sha256Hex(pending!.claim);
  return `${DRIVE_AUTH_URL}/auth/google/start?claim_hash=${claimHash}`;
};

/**
 * Restarts the pending sign-in's clock from the tap, fire-and-forget from the
 * link's click: a link prepared when the page opened and tapped much later
 * must not come back to a claim the app has already given up on.
 */
export const markSignInStarted = async (now = Date.now()): Promise<void> => {
  const pending = await metaRepo.get<PendingClaim>("driveClaim");
  if (pending) await metaRepo.set("driveClaim", { ...pending, createdAt: now });
};

/** The general folder she picked, if any. */
export const getFolder = (): Promise<DriveMeta["driveFolder"] | undefined> =>
  metaRepo.get<DriveMeta["driveFolder"]>("driveFolder");

let claiming: Promise<boolean> | null = null;

/**
 * Collects the session a finished sign-in left on the Worker. Resolves `true`
 * once signed in, `false` when there is nothing (yet) to collect.
 *
 * "Not yet" is the normal answer — the user may still be on Google's screen —
 * so this is cheap to call on every return to the foreground. Concurrent calls
 * share one request: a claim is single-use, and a second one racing the first
 * would read a 404 and look like a failure.
 */
export const claimSession = (now = Date.now()): Promise<boolean> => {
  claiming ??= claim(now).finally(() => {
    claiming = null;
  });
  return claiming;
};

const claim = async (now: number): Promise<boolean> => {
  const pending = await metaRepo.get<PendingClaim>("driveClaim");
  if (!pending) return false;
  if (!isFresh(pending, now)) {
    await metaRepo.remove("driveClaim");
    return false;
  }

  let response: Response;
  try {
    response = await fetch(`${DRIVE_AUTH_URL}/auth/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim: pending.claim }),
    });
  } catch {
    return false;
  }
  if (!response.ok) return false;

  const account = (await response.json()) as Partial<GoogleAccount>;
  if (
    typeof account.email !== "string" ||
    typeof account.sessionToken !== "string" ||
    typeof account.scope !== "string" ||
    !grantsDrive(account.scope)
  ) {
    return false;
  }
  await metaRepo.set("googleAccount", {
    email: account.email,
    sessionToken: account.sessionToken,
    scope: account.scope,
  });
  await metaRepo.remove("driveClaim");
  return true;
};

let cached: { sessionToken: string; token: string; expiresAt: number } | null =
  null;

/**
 * An access token for Drive's API, from memory while it has more than a
 * minute left, from the Worker otherwise.
 *
 * A 401 from the Worker is a sign-out that happened elsewhere — the grant was
 * revoked from the Google account page, or the session is gone — so this
 * forgets the account, which puts "Connecter Google Drive" back on screen.
 */
export const accessToken = async (now = Date.now()): Promise<string> => {
  const account = await getAccount();
  if (!account) throw new DriveSignedOutError();
  if (
    cached?.sessionToken === account.sessionToken &&
    cached.expiresAt - 60_000 > now
  ) {
    return cached.token;
  }

  const response = await fetch(`${DRIVE_AUTH_URL}/drive/token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${account.sessionToken}` },
  });
  if (response.status === 401) {
    cached = null;
    await metaRepo.remove("googleAccount");
    throw new DriveSignedOutError();
  }
  if (!response.ok) throw new Error(`Drive indisponible (${response.status})`);

  const { accessToken: token, expiresAt } = (await response.json()) as {
    accessToken: string;
    expiresAt: number;
  };
  cached = { sessionToken: account.sessionToken, token, expiresAt };
  return token;
};

/**
 * Signs out: forgotten here first, so the app is signed out whether or not
 * the Worker is reachable, then revoked at Google through the Worker. The
 * folder choice stays, and nothing in the Drive or on the device is deleted.
 */
export const signOut = async (): Promise<void> => {
  const account = await getAccount();
  cached = null;
  await metaRepo.remove("googleAccount");
  if (!account) return;
  await fetch(`${DRIVE_AUTH_URL}/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${account.sessionToken}` },
  }).catch(() => null);
};

/**
 * Finishes a sign-in whenever the app comes back to the foreground or the
 * network returns — the moments a user closing Google's sheet lands on.
 * Called once, after the database is open.
 */
export function initDriveAuth() {
  const retry = () => void claimSession();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") retry();
  });
  window.addEventListener("focus", retry);
  window.addEventListener("online", retry);
  retry();
}
