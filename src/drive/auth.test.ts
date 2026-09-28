import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metaRepo } from "../data/index.ts";
import { resetDb } from "../data/__tests__/factories.ts";
import {
  accessToken,
  claimSession,
  DriveSignedOutError,
  getAccount,
  prepareSignIn,
  signOut,
} from "./auth.ts";
import { DRIVE_AUTH_URL } from "./drive-config.ts";

const NOW = Date.UTC(2026, 8, 28, 12);
const MINUTE = 60 * 1000;
const ACCOUNT = {
  email: "lea@example.com",
  sessionToken: "session-token",
  scope: "openid https://www.googleapis.com/auth/drive",
};

const sha256Hex = async (text: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const respond = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await resetDb();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("prepareSignIn", () => {
  it("sends only the hash of a secret it keeps", async () => {
    const href = await prepareSignIn(NOW);

    const pending = await metaRepo.get<{ claim: string }>("driveClaim");
    expect(href).toBe(
      `${DRIVE_AUTH_URL}/auth/google/start?claim_hash=${await sha256Hex(pending!.claim)}`,
    );
    expect(href).not.toContain(pending!.claim);
  });

  it("keeps the same secret while a sign-in can still be claimed", async () => {
    const first = await prepareSignIn(NOW);

    expect(await prepareSignIn(NOW + 30 * MINUTE)).toBe(first);
  });

  it("starts over once the last one can no longer be claimed", async () => {
    const first = await prepareSignIn(NOW);

    expect(await prepareSignIn(NOW + 41 * MINUTE)).not.toBe(first);
  });
});

describe("claimSession", () => {
  it("asks nothing when no sign-in was started", async () => {
    expect(await claimSession(NOW)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps waiting while the sign-in is still on Google's side", async () => {
    await prepareSignIn(NOW);
    fetchMock.mockResolvedValue(respond(404, { error: "not_found" }));

    expect(await claimSession(NOW)).toBe(false);
    expect(await metaRepo.get("driveClaim")).toBeDefined();
    expect(await metaRepo.get("googleAccount")).toBeUndefined();
  });

  it("stores the account and spends the claim once the sign-in is done", async () => {
    await prepareSignIn(NOW);
    const { claim } = (await metaRepo.get<{ claim: string }>("driveClaim"))!;
    fetchMock.mockResolvedValue(respond(200, ACCOUNT));

    expect(await claimSession(NOW)).toBe(true);
    expect(await metaRepo.get("googleAccount")).toEqual(ACCOUNT);
    expect(await metaRepo.get("driveClaim")).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${DRIVE_AUTH_URL}/auth/claim`);
    expect(JSON.parse(init.body as string)).toEqual({ claim });
  });

  it("does not count a sign-in with the Drive box unticked", async () => {
    await prepareSignIn(NOW);
    fetchMock.mockResolvedValue(
      respond(200, { ...ACCOUNT, scope: "openid email" }),
    );

    expect(await claimSession(NOW)).toBe(false);
    expect(await getAccount()).toBeUndefined();
  });

  it("sends one request for calls that overlap: a claim is single-use", async () => {
    await prepareSignIn(NOW);
    fetchMock.mockResolvedValue(respond(200, ACCOUNT));

    const results = await Promise.all([claimSession(NOW), claimSession(NOW)]);

    expect(results).toEqual([true, true]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("drops a sign-in too old to claim, without asking", async () => {
    await prepareSignIn(NOW);

    expect(await claimSession(NOW + 41 * MINUTE)).toBe(false);
    expect(await metaRepo.get("driveClaim")).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waits for the next try when the Worker is unreachable", async () => {
    await prepareSignIn(NOW);
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    expect(await claimSession(NOW)).toBe(false);
    expect(await metaRepo.get("driveClaim")).toBeDefined();
  });
});

describe("accessToken", () => {
  it("refuses when Drive is not connected", async () => {
    await expect(accessToken(NOW)).rejects.toBeInstanceOf(DriveSignedOutError);
  });

  it("asks the Worker once, then reuses the token while it has time left", async () => {
    await metaRepo.set("googleAccount", ACCOUNT);
    fetchMock.mockResolvedValue(
      respond(200, { accessToken: "ya29.a", expiresAt: NOW + 60 * MINUTE }),
    );

    expect(await accessToken(NOW)).toBe("ya29.a");
    expect(await accessToken(NOW + 58 * MINUTE)).toBe("ya29.a");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![1].headers).toEqual({
      Authorization: "Bearer session-token",
    });
  });

  it("signs out when the Worker no longer knows the session", async () => {
    // Its own session: the one above left a token in the in-memory cache.
    await metaRepo.set("googleAccount", {
      ...ACCOUNT,
      sessionToken: "revoked",
    });
    fetchMock.mockResolvedValue(respond(401, { error: "unauthorized" }));

    await expect(accessToken(NOW)).rejects.toBeInstanceOf(DriveSignedOutError);
    expect(await metaRepo.get("googleAccount")).toBeUndefined();
  });
});

describe("signOut", () => {
  it("forgets the account even with the Worker unreachable, and keeps the folder", async () => {
    await metaRepo.set("googleAccount", ACCOUNT);
    await metaRepo.set("driveFolder", { id: "folder-1", name: "PONEY" });
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await signOut();

    expect(await metaRepo.get("googleAccount")).toBeUndefined();
    expect(await metaRepo.get("driveFolder")).toEqual({
      id: "folder-1",
      name: "PONEY",
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(`${DRIVE_AUTH_URL}/auth/logout`);
  });
});
