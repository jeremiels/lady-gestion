import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../__tests__/factories.ts";
import * as metaRepo from "./meta.repo.ts";

/**
 * `meta` is local app state, not an entity. The parts worth guarding are the
 * two derived reads the profile screen renders: how stale the backup is, and
 * the notifications default — both of which have a defined answer when nothing
 * has ever been written.
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

describe("daysSinceBackup", () => {
  it("is Infinity when there has never been a backup", async () => {
    // The profile screen reads this as "Aucune sauvegarde", so it must be a
    // number the caller can test with Number.isFinite, not undefined.
    expect(await metaRepo.daysSinceBackup()).toBe(Infinity);
  });

  it("is 0 on the day of the backup", async () => {
    await metaRepo.markBackedUp();

    expect(await metaRepo.daysSinceBackup()).toBe(0);
  });

  it("counts whole elapsed days, not calendar days", async () => {
    // Backdating the stored timestamp rather than faking the clock: Dexie
    // resolves its promises on the real task queue, so `vi.useFakeTimers()`
    // deadlocks every query in this file.
    const hoursAgo = (hours: number) =>
      new Date(Date.now() - hours * 3_600_000).toISOString();

    // 47 hours is one whole elapsed day, not the two calendar days it spans.
    await metaRepo.set("lastBackupAt", hoursAgo(47));
    expect(await metaRepo.daysSinceBackup()).toBe(1);

    await metaRepo.set("lastBackupAt", hoursAgo(49));
    expect(await metaRepo.daysSinceBackup()).toBe(2);
  });
});
