import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../data/db.ts";
import { metaRepo } from "../data/index.ts";
import { makeHorse, resetDb } from "../data/__tests__/factories.ts";
import { initDriveSync, syncDrive } from "./sync.ts";

/**
 * When a sync runs, as `initDriveSync` sets it going. A file of its own:
 * once started, it follows every change to the sign-in for the rest of the
 * file, which would set syncs going in the middle of `sync.test.ts`.
 */

/** Requests for the general folder's listing: one per walk. */
let walks = 0;
/** Holds the walk until released — a sync still running. */
let gate: Promise<void> | null = null;

beforeAll(async () => {
  // `initDriveSync` listens on both; this project runs in Node.
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { visibilityState: "visible" }),
  );
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/drive/token")) {
        return Response.json({
          accessToken: "ya29.a",
          expiresAt: Date.now() + 3_600_000,
        });
      }
      if (url.searchParams.get("fields") === "id,trashed") {
        return Response.json({ id: "root", trashed: false });
      }
      if (url.searchParams.get("q")?.includes("'root' in parents")) {
        walks += 1;
        await gate;
      }
      return Response.json({ files: [] });
    }),
  );

  await resetDb();
  await db.horses.add(makeHorse());
  await metaRepo.set("googleAccount", {
    email: "lea@example.com",
    sessionToken: "session",
    scope: "openid https://www.googleapis.com/auth/drive",
  });
  await metaRepo.set("driveFolder", { id: "root", name: "Lady" });
  initDriveSync();
  // The sync the sign-in starts, once seen.
  await vi.waitFor(() => expect(walks).toBe(1));
  await syncDrive();
});

describe("syncDrive", () => {
  it("does not sync again on a foreground return soon after the last", async () => {
    await syncDrive();

    expect(walks).toBe(1);
  });

  it("follows a forced sync asked mid-run with one more pass", async () => {
    let release!: () => void;
    gate = new Promise((resolve) => {
      release = resolve;
    });
    const first = syncDrive(true);
    await vi.waitFor(() => expect(walks).toBe(2));

    // A file joined while that walk runs.
    void syncDrive(true);
    void syncDrive(true);
    release();
    gate = null;
    await first;
    await syncDrive();

    expect(walks).toBe(3);
  });
});
