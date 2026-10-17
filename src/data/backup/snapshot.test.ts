import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, RECORD_TABLE_NAMES, SCHEMA_VERSION } from "../db.ts";
import { getOwnerId } from "../owner.ts";
import { seedIfEmpty } from "../seed.ts";
import * as horsesRepo from "../repositories/horses.repo.ts";
import type { BaseRecord } from "../types.ts";
import { exportBackup } from "./export.ts";
import { downloadBackup } from "./file.ts";
import { importBackup, planRestore, runRestore } from "./restore.ts";
import type { BackupSnapshot } from "./snapshot.ts";
import { checkBackup } from "./validate.ts";
import { makeDocument, makeDocumentFolder } from "../__tests__/factories.ts";
import { pending } from "../drive-mirror.ts";
import {
  categoryRows,
  checked,
  dismissed,
  horse,
  LOCAL_OWNER,
  pickedFile,
  post,
  ration,
  REMOTE_OWNER,
  resetDatabase,
  snapshot,
  STAMP,
  stubShare,
} from "./snapshot.fixtures.ts";

beforeEach(resetDatabase);

const byId = (rows: readonly BaseRecord[]) =>
  Object.fromEntries(rows.map((row) => [row.id, row]));

describe("exportBackup", () => {
  it("writes an envelope carrying the schema version and owner", async () => {
    const backup = await exportBackup();

    expect(backup.app).toBe("lady-gestion");
    expect(backup.schemaVersion).toBe(SCHEMA_VERSION);
    expect(backup.ownerId).toBe(LOCAL_OWNER);
    // Spelled out rather than derived from `RECORD_TABLES`: this is the
    // assertion that a table added to the schema is actually exported, and one
    // that reads its expectation from the same constant asserts nothing.
    expect(Object.keys(backup.tables).sort()).toEqual([
      "activities",
      "categories",
      "documentFolders",
      "documents",
      "horses",
      "posts",
      "profiles",
      "rationItems",
    ]);
  });

  it("includes tombstones — a deletion has to be able to propagate", async () => {
    await db.horses.put(
      horse({ id: "gone", deletedAt: "2026-02-01T00:00:00.000Z" }),
    );

    const backup = await exportBackup();

    expect(backup.tables.horses.map((row) => row.id)).toContain("gone");
  });
});

describe("importBackup — replace semantics", () => {
  it("writes the file's rows into an empty database", async () => {
    await importBackup(
      checked({
        tables: { horses: [horse()], rationItems: [ration()] },
      }),
    );

    expect(await db.horses.get("horse-1")).toMatchObject({
      firstName: "Ladympala",
    });
    expect(await db.rationItems.get("ration-1")).toBeDefined();
  });

  it("leaves every table as the file holds it, and nothing the device held", async () => {
    // A phone in use: the demo seeded, and a post of hers on its horse.
    await seedIfEmpty();
    const demo = await horsesRepo.getActive();
    await db.posts.put(post({ id: "mine", horseId: demo!.id }));
    const backup = checked({
      tables: {
        horses: [horse()],
        posts: [post()],
        categories: categoryRows,
      },
    });

    await importBackup(backup);

    const { tables } = await exportBackup();
    for (const name of RECORD_TABLE_NAMES) {
      expect(byId(tables[name]), `table ${name}`).toStrictEqual(
        byId(backup.tables[name]),
      );
    }
    // The demo rows it listed went with everything else.
    expect(await db.meta.get("seedRecordIds")).toBeUndefined();
  });

  it("restores Drive rows in step with the Drive: a change not sent yet is not replayed", async () => {
    const sent = "2026-06-01T00:00:00.000Z";
    const renamed = "2026-06-02T00:00:00.000Z";
    await importBackup(
      checked({
        tables: {
          documents: [
            makeDocument({
              id: "renamed",
              driveFileId: "drive-renamed",
              driveSyncedAt: sent,
              updatedAt: renamed,
              driveChanges: ["name"],
            }),
            makeDocument({
              id: "deleted",
              driveFileId: "drive-deleted",
              driveSyncedAt: sent,
              updatedAt: renamed,
              deletedAt: renamed,
            }),
          ],
          documentFolders: [
            makeDocumentFolder({ id: "made-here", updatedAt: renamed }),
          ],
        },
      }),
    );

    for (const id of ["renamed", "deleted"]) {
      expect(pending((await db.documents.get(id))!)).toBe(false);
    }
    // Never in the Drive: still the sync's to create there.
    expect(await db.documentFolders.get("made-here")).toMatchObject({
      driveFolderId: null,
      driveSyncedAt: null,
    });
  });

  it("keeps the bytes of a document the file brings back, and only those", async () => {
    await db.documents.bulkPut([
      makeDocument({ id: "kept" }),
      makeDocument({ id: "gone" }),
      makeDocument({ id: "deleted-in-file" }),
    ]);
    await db.documentBlobs.bulkPut(
      ["kept", "gone", "deleted-in-file"].map((documentId) => ({
        documentId,
        blob: new Blob(["%PDF"]),
      })),
    );

    await importBackup(
      checked({
        tables: {
          documents: [
            makeDocument({ id: "kept" }),
            makeDocument({ id: "deleted-in-file", deletedAt: STAMP }),
          ],
        },
      }),
    );

    expect(await db.documentBlobs.toCollection().primaryKeys()).toEqual([
      "kept",
    ]);
  });

  it("keeps what belongs to the device: the Drive sign-in and folder", async () => {
    const account = {
      email: "elle@example.com",
      sessionToken: "t",
      scope: "s",
    };
    await db.meta.bulkPut([
      { key: "googleAccount", value: account },
      { key: "driveFolder", value: { id: "drive-root", name: "Ladympala" } },
      { key: "notificationsEnabled", value: false },
    ]);

    await importBackup(checked({ tables: { horses: [horse()] } }));

    expect((await db.meta.get("googleAccount"))?.value).toEqual(account);
    expect((await db.meta.get("driveFolder"))?.value).toEqual({
      id: "drive-root",
      name: "Ladympala",
    });
    expect((await db.meta.get("notificationsEnabled"))?.value).toBe(false);
  });

  it("gives the same database however many times the same file is restored", async () => {
    const file = checked({
      tables: { horses: [horse()], rationItems: [ration()] },
    });

    await importBackup(structuredClone(file));
    const after = await exportBackup();
    await importBackup(structuredClone(file));

    expect((await exportBackup()).tables).toStrictEqual(after.tables);
  });

  it("does not count as a backup — reading a file is not keeping one", async () => {
    await importBackup(checked({ tables: { horses: [horse()] } }));

    expect(await db.meta.get("lastBackupAt")).toBeUndefined();
  });
});

describe("planRestore", () => {
  const file = () =>
    pickedFile(snapshot({ tables: { horses: [horse()], posts: [post()] } }));

  it("asks for no copy on a fresh install, where every row is the seed", async () => {
    await seedIfEmpty();

    const plan = await planRestore(file());

    expect(plan.backup.tables.horses.map((row) => row.id)).toEqual(["horse-1"]);
    expect(plan.copy).toBeNull();
    expect(plan.unsentFiles).toBe(0);
  });

  it("copies her data as soon as one row is hers, whatever the file holds", async () => {
    // The file holds these very rows: a copy is taken all the same, by the
    // test that keeps the demo out of her Drive backups (`isUntouchedSeed`).
    await seedIfEmpty();
    await db.horses.put(horse());
    await db.posts.put(post());

    const { copy } = await planRestore(file());

    // Everything on the device, demo rows included.
    expect(copy?.tables).toStrictEqual((await exportBackup()).tables);
  });

  it("counts a file joined here whose bytes are not in the Drive yet", async () => {
    await db.documents.bulkPut([
      makeDocument({ id: "only-here" }),
      makeDocument({ id: "in-the-drive", driveFileId: "drive-1" }),
      // A row a backup brought back without its file: no bytes to lose.
      makeDocument({ id: "no-bytes" }),
    ]);
    await db.documentBlobs.bulkPut(
      ["only-here", "in-the-drive"].map((documentId) => ({
        documentId,
        blob: new Blob(["%PDF"]),
      })),
    );

    expect((await planRestore(file())).unsentFiles).toBe(1);
  });
});

describe("runRestore", () => {
  const plan = () =>
    planRestore(pickedFile(snapshot({ tables: { horses: [horse()] } })));

  const horseIds = async () => (await db.horses.toArray()).map((row) => row.id);

  it("hands over a copy of what is here, then replaces it", async () => {
    await db.horses.put(horse({ id: "here" }));
    const shared = stubShare();

    expect(await runRestore(await plan())).toEqual({
      copy: "shared",
      restored: 1,
    });
    const copy = JSON.parse(await shared[0]!.text()) as BackupSnapshot;
    expect(copy.tables.horses.map((row) => row.id)).toEqual(["here"]);
    expect(await horseIds()).toEqual(["horse-1"]);
  });

  it("opens the share sheet before it awaits anything, inside the tap's activation", async () => {
    await db.horses.put(horse({ id: "here" }));
    const ready = await plan();
    const shared = stubShare();

    const running = runRestore(ready);

    expect(shared).toHaveLength(1);
    await running;
  });

  it("replaces nothing when the copy is dismissed", async () => {
    await db.horses.put(horse({ id: "here" }));
    stubShare(dismissed);

    expect(await runRestore(await plan())).toBe("cancelled");
    expect(await horseIds()).toEqual(["here"]);
  });

  it("asks for no copy on a fresh install", async () => {
    await seedIfEmpty();
    const shared = stubShare();

    expect(await runRestore(await plan())).toEqual({
      copy: null,
      restored: 1,
    });
    expect(shared).toHaveLength(0);
    expect(await horseIds()).toEqual(["horse-1"]);
  });
});

describe("importBackup — owner adoption", () => {
  it("adopts the snapshot's owner id so the database does not end up split", async () => {
    expect(getOwnerId()).toBe(LOCAL_OWNER);

    await importBackup(checked({ tables: { horses: [horse()] } }));

    expect(getOwnerId()).toBe(REMOTE_OWNER);
    expect(await db.meta.get("ownerId")).toMatchObject({ value: REMOTE_OWNER });
  });
});

describe("importBackup — the horse shown", () => {
  it("shows the file's horse on a phone used before the restore", async () => {
    // An event of her own on the demo horse — as the Drive mirror files its
    // documents under it once connected.
    await seedIfEmpty();
    const demo = await horsesRepo.getActive();
    await db.posts.put(
      post({ id: "event-local", horseId: demo!.id, ownerId: LOCAL_OWNER }),
    );

    await importBackup(checked({ tables: { horses: [horse()] } }));

    expect(await horsesRepo.get(demo!.id)).toBeUndefined();
    expect((await horsesRepo.getActive())?.id).toBe("horse-1");
  });

  it("does not show a horse the file holds archived", async () => {
    await seedIfEmpty();

    await importBackup(
      checked({
        tables: {
          horses: [horse({ archivedAt: "2026-03-01T00:00:00.000Z" })],
        },
      }),
    );

    expect(await horsesRepo.getActive()).toBeUndefined();
  });
});

describe("importBackup — atomicity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rolls the whole restore back when a write fails partway", async () => {
    // `categories` is written seventh of eight, so by the time this throws,
    // `horses` and `posts` have already been cleared and written: everything
    // that was there must come back.
    await seedIfEmpty();
    const seededHorses = await db.horses.count();
    const seededPosts = await db.posts.count();
    expect(seededHorses).toBeGreaterThan(0);

    vi.spyOn(db.categories, "bulkPut").mockRejectedValueOnce(
      new Error("disque plein"),
    );

    await expect(
      importBackup(
        checked({
          tables: {
            horses: [horse({ id: "horse-from-file" })],
            posts: [post({ id: "post-from-file" })],
            categories: categoryRows,
          },
        }),
      ),
    ).rejects.toThrow();

    // Nothing from the file landed...
    expect(await db.horses.get("horse-from-file")).toBeUndefined();
    expect(await db.posts.get("post-from-file")).toBeUndefined();
    // ...and nothing that was already there was lost.
    expect(await db.horses.count()).toBe(seededHorses);
    expect(await db.posts.count()).toBe(seededPosts);
  });

  it("does not adopt the file's owner when the restore fails", async () => {
    // `cachedOwnerId` lives in a module variable, so a rollback cannot undo it.
    // It is written only after the commit for exactly this reason: otherwise a
    // failed restore leaves the session stamping new records with an owner the
    // database never adopted.
    await seedIfEmpty();

    vi.spyOn(db.categories, "bulkPut").mockRejectedValueOnce(
      new Error("disque plein"),
    );

    await expect(
      importBackup(checked({ tables: { categories: categoryRows } })),
    ).rejects.toThrow();

    expect(getOwnerId()).toBe(LOCAL_OWNER);
    expect((await db.meta.get("ownerId"))?.value).toBe(LOCAL_OWNER);
  });
});

describe("downloadBackup — the share sheet", () => {
  it("stamps the backup only once the sheet confirms the file went somewhere", async () => {
    stubShare();

    expect(await downloadBackup()).toBe("shared");
    expect(await db.meta.get("lastBackupAt")).toBeDefined();
  });

  it("leaves the last backup as it was when the sheet is dismissed", async () => {
    stubShare(dismissed);

    expect(await downloadBackup()).toBe("cancelled");
    expect(await db.meta.get("lastBackupAt")).toBeUndefined();
  });

  it("still hands over a file when Dexie cannot open the database", async () => {
    await db.horses.put(horse());
    const shared = stubShare();
    db.close();

    expect(await downloadBackup()).toBe("shared");
    const file = JSON.parse(await shared[0]!.text()) as BackupSnapshot;
    expect(file.tables.horses.map((row) => row.id)).toEqual(["horse-1"]);
  });
});

describe("exportBackup — Dexie closed", () => {
  it("reads every table and the owner, as a file the restore takes back", async () => {
    await db.horses.put(horse());
    await db.posts.put(post());
    db.close();

    const raw = await exportBackup();

    expect(raw.schemaVersion).toBe(SCHEMA_VERSION);
    expect(raw.ownerId).toBe(LOCAL_OWNER);
    expect(raw.tables.posts.map((row) => row.id)).toEqual(["event-1"]);

    await resetDatabase();
    await importBackup(checkBackup(raw));
    expect(await db.horses.count()).toBe(1);
    expect(await db.posts.count()).toBe(1);
  });
});
