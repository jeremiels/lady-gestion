import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../__tests__/factories.ts";
import * as metaRepo from "./meta.repo.ts";

/**
 * `meta` is local app state, not an entity. Beyond the key-value round trip,
 * the part worth guarding is the derived read the profile screen renders: the
 * notifications default, which has a defined answer when nothing has ever
 * been written.
 */

beforeEach(resetDb);

describe("get / set", () => {
  it("round-trips a value", async () => {
    await metaRepo.set("driveFolderId", "folder-123");

    expect(await metaRepo.get<string>("driveFolderId")).toBe("folder-123");
  });

  it("round-trips a non-scalar, which is why the column is unknown", async () => {
    await metaRepo.set("seedRecordIds", ["a", "b"]);

    expect(await metaRepo.get<string[]>("seedRecordIds")).toEqual(["a", "b"]);
  });

  it("returns undefined for a key never written", async () => {
    expect(await metaRepo.get("driveFolderId")).toBeUndefined();
  });

  it("overwrites rather than appending", async () => {
    await metaRepo.set("driveFolderId", "first");
    await metaRepo.set("driveFolderId", "second");

    expect(await metaRepo.get<string>("driveFolderId")).toBe("second");
  });

  it("removes a key", async () => {
    await metaRepo.set("driveFolderId", "gone");
    await metaRepo.remove("driveFolderId");

    expect(await metaRepo.get("driveFolderId")).toBeUndefined();
  });
});

describe("getNotificationsEnabled", () => {
  it("defaults to on before the user has ever touched the switch", async () => {
    // The default lives in the repository so the view cannot drift from it.
    expect(await metaRepo.getNotificationsEnabled()).toBe(true);
  });

  it("honours an explicit false", async () => {
    await metaRepo.setNotificationsEnabled(false);

    expect(await metaRepo.getNotificationsEnabled()).toBe(false);
  });
});
