import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import realV13ExportRaw from "../__tests__/fixtures/real-v13-export.json?raw";
import { db, SCHEMA_VERSION, type RecordTableName } from "../db.ts";
import { BUILT_IN_CATEGORIES, seedCategories } from "../categories.ts";
import { followUpValue } from "../posts.ts";
import { getOwnerId } from "../owner.ts";
import { seedIfEmpty } from "../seed.ts";
import type { Category, Post } from "../types.ts";
import { exportBackup, importBackup, type BackupSnapshot } from "./snapshot.ts";
import {
  categoryRows,
  horse,
  LOCAL_OWNER,
  post,
  ration,
  REMOTE_OWNER,
  resetDatabase,
  snapshot,
  STAMP,
} from "./snapshot.fixtures.ts";

beforeEach(resetDatabase);

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

describe("importBackup — merge semantics", () => {
  it("writes rows that do not exist locally", async () => {
    const result = await importBackup(
      snapshot({
        tables: { horses: [horse()], rationItems: [ration()] },
      }),
    );

    expect(result).toEqual({ imported: 2, skipped: 0 });
    expect(await db.horses.get("horse-1")).toMatchObject({ name: "Ladympala" });
  });

  it("overwrites a local row when the snapshot is newer", async () => {
    await db.horses.put(
      horse({ name: "Ancien nom", updatedAt: "2026-01-01T00:00:00.000Z" }),
    );

    const result = await importBackup(
      snapshot({
        tables: {
          horses: [
            horse({
              name: "Nouveau nom",
              updatedAt: "2026-06-01T00:00:00.000Z",
            }),
          ],
        },
      }),
    );

    expect(result).toEqual({ imported: 1, skipped: 0 });
    expect(await db.horses.get("horse-1")).toMatchObject({
      name: "Nouveau nom",
    });
  });

  it("keeps a newer local edit when restoring an older backup", async () => {
    await db.horses.put(
      horse({ name: "Édité depuis", updatedAt: "2026-06-01T00:00:00.000Z" }),
    );

    const result = await importBackup(
      snapshot({
        tables: {
          horses: [
            horse({
              name: "Vieille sauvegarde",
              updatedAt: "2026-01-01T00:00:00.000Z",
            }),
          ],
        },
      }),
    );

    expect(result).toEqual({ imported: 0, skipped: 1 });
    expect(await db.horses.get("horse-1")).toMatchObject({
      name: "Édité depuis",
    });
  });

  it("is idempotent — importing the same file twice changes nothing", async () => {
    const file = snapshot({
      tables: { horses: [horse()], rationItems: [ration()] },
    });

    const first = await importBackup(structuredClone(file));
    const second = await importBackup(structuredClone(file));

    expect(first).toEqual({ imported: 2, skipped: 0 });
    expect(second).toEqual({ imported: 0, skipped: 2 });
    expect(await db.horses.count()).toBe(1);
    expect(await db.rationItems.count()).toBe(1);
  });

  it("skips a built-in category the file holds at the same version", async () => {
    await db.categories.bulkPut(deviceCategories());

    const result = await importBackup(
      snapshot({ tables: { categories: deviceCategories() } }),
    );

    expect(result).toEqual({
      imported: 0,
      skipped: BUILT_IN_CATEGORIES.length,
    });
  });

  it("counts every table, not just the first", async () => {
    const result = await importBackup(
      snapshot({
        tables: {
          horses: [horse({ id: "h1" }), horse({ id: "h2" })],
          rationItems: [
            ration({ id: "r1" }),
            ration({ id: "r2" }),
            ration({ id: "r3" }),
          ],
        },
      }),
    );

    expect(result).toEqual({ imported: 5, skipped: 0 });
  });
});

describe("importBackup — owner adoption", () => {
  it("adopts the snapshot's owner id so the database does not end up split", async () => {
    expect(getOwnerId()).toBe(LOCAL_OWNER);

    await importBackup(snapshot({ tables: { horses: [horse()] } }));

    expect(getOwnerId()).toBe(REMOTE_OWNER);
    expect(await db.meta.get("ownerId")).toMatchObject({ value: REMOTE_OWNER });
  });
});

/**
 * The built-ins as another device holds them: ids equal to keys, the way
 * `seedCategories` stamps them on every real install — unlike `categoryRows`,
 * whose `type-<key>` ids would never meet a seeded row.
 */
const deviceCategories = (
  over: Partial<Record<string, Partial<Category>>> = {},
): Category[] =>
  seedCategories(REMOTE_OWNER, STAMP).map((row) => ({
    ...row,
    ...over[row.key],
  }));

/** When the other device's user switched a category — after it was seeded. */
const EDITED = "2026-02-01T00:00:00.000Z";

/**
 * A new phone, then the backup restored onto it. `seedIfEmpty` runs first, the
 * way `initData()` does, so every built-in is already on the device — stamped
 * with this install's owner and time, which is newer than anything in the file.
 */
describe("importBackup — built-in categories over a fresh install", () => {
  it("keeps a category the file switched off switched off", async () => {
    await seedIfEmpty();

    await importBackup(
      snapshot({
        tables: {
          categories: deviceCategories({
            concours: { enabled: false, updatedAt: EDITED },
          }),
        },
      }),
    );

    expect((await db.categories.get("concours"))?.enabled).toBe(false);
  });

  it("takes the file's rows whole, so the database keeps one owner", async () => {
    await seedIfEmpty();

    await importBackup(
      snapshot({ tables: { categories: deviceCategories() } }),
    );

    const rows = await db.categories.toArray();
    expect(rows).toHaveLength(BUILT_IN_CATEGORIES.length);
    for (const row of rows) {
      expect(row).toMatchObject({
        ownerId: REMOTE_OWNER,
        createdAt: STAMP,
        updatedAt: STAMP,
      });
    }
    expect(getOwnerId()).toBe(REMOTE_OWNER);
  });

  it("still lets a category switched off on this device outvote an older file", async () => {
    await seedIfEmpty();
    // Backdated rather than written through `setEnabled`: a toggle landing in
    // the same millisecond as the seed would read as never touched.
    const seeded = (await db.categories.get("concours"))!;
    await db.categories.put({
      ...seeded,
      enabled: false,
      updatedAt: new Date(Date.parse(seeded.createdAt) + 1_000).toISOString(),
    });

    const result = await importBackup(
      snapshot({ tables: { categories: deviceCategories() } }),
    );

    expect((await db.categories.get("concours"))?.enabled).toBe(false);
    expect(result).toEqual({
      imported: BUILT_IN_CATEGORIES.length - 1,
      skipped: 1,
    });
  });

  it("brings the file's definitions up to what this build ships", async () => {
    await seedIfEmpty();

    await importBackup(
      snapshot({
        tables: {
          categories: deviceCategories({
            cures: {
              enabled: false,
              updatedAt: EDITED,
              fields: [
                {
                  id: "duration",
                  label: "Durée",
                  required: false,
                  control: "text",
                },
              ],
            },
          }),
        },
      }),
    );

    const cures = await db.categories.get("cures");
    expect(cures?.enabled).toBe(false);
    expect(cures?.fields).toEqual(
      BUILT_IN_CATEGORIES.find((type) => type.key === "cures")?.fields,
    );
  });
});

describe("importBackup — rejects bad input", () => {
  it("rejects a file that is not a Ladympala.cc backup", async () => {
    await expect(importBackup({ app: "autre-chose" })).rejects.toThrow(
      "Ce fichier n'est pas une sauvegarde Ladympala.cc.",
    );
    await expect(importBackup(null)).rejects.toThrow(/sauvegarde Ladympala.cc/);
  });

  it("rejects a file with no header", async () => {
    await expect(importBackup({ app: "lady-gestion" })).rejects.toThrow(
      "Sauvegarde illisible : en-tête manquant.",
    );
  });

  it("rejects a backup written by a newer build", async () => {
    await expect(
      importBackup(snapshot({ schemaVersion: SCHEMA_VERSION + 1 })),
    ).rejects.toThrow(/version plus récente/);
  });

  it("rejects a backup written by an older build, writing nothing", async () => {
    // No file below the current version is known to exist — the one install in
    // use exports v13 and cannot go back — so `migrate.ts` registers no step
    // to read one with. Refusing is right: merging rows this build misreads is
    // the outcome that loses data. The seam is there for the *next* bump, when
    // a v13 file will need a step to reach v14.
    const old = snapshot({
      schemaVersion: SCHEMA_VERSION - 1,
      tables: { horses: [horse()] },
    });

    await expect(importBackup(old)).rejects.toThrow(/version trop ancienne/);
    expect(await db.horses.count()).toBe(0);
  });

  it("rejects an empty tables object with a readable message, not a TypeError", async () => {
    // Regression: `assertSnapshot` used to check only that `tables` existed, so
    // this reached the merge and threw "undefined is not iterable".
    const broken = { ...snapshot(), tables: {} };

    await expect(importBackup(broken)).rejects.toThrow(
      /la table « horses » est absente/,
    );
  });

  it("rejects a table that is not an array", async () => {
    const broken = {
      ...snapshot(),
      tables: { ...snapshot().tables, posts: "nope" },
    };

    await expect(importBackup(broken)).rejects.toThrow(
      /la table « posts » est absente/,
    );
  });

  it("rejects rows missing the fields the merge relies on", async () => {
    const broken = {
      ...snapshot(),
      tables: { ...snapshot().tables, horses: [{ name: "Sans id" }] },
    };

    await expect(importBackup(broken)).rejects.toThrow(
      /« horses » contient des enregistrements invalides/,
    );
  });

  it("keeps the customFields values a current-version snapshot carries", async () => {
    const current = post({
      customFields: {
        counterparty: "google",
        followUp: followUpValue({ amount: 6, unit: "week" }),
        activity: "longe",
      },
    });

    await importBackup({
      ...snapshot(),
      tables: { ...snapshot().tables, posts: [current] },
    });

    const stored = await db.posts.get("event-1");
    expect(stored?.customFields.counterparty).toBe("google");
    expect(stored?.customFields.followUp).toBe("6w");
    expect(stored?.customFields.activity).toBe("longe");
  });

  it("leaves a current-version snapshot untouched", async () => {
    const seasonal = ration({ season: { from: 11, to: 3 } });

    await importBackup({
      ...snapshot(),
      tables: { ...snapshot().tables, rationItems: [seasonal] },
    });

    expect((await db.rationItems.get("ration-1"))?.season).toEqual({
      from: 11,
      to: 3,
    });
  });

  it("still rejects a table missing from a current-version file", async () => {
    // Every table is required: an older file, the only one that could
    // legitimately lack a newer table, is refused before this is reached.
    const { activities: _activities, ...incomplete } = snapshot().tables;

    await expect(
      importBackup({ ...snapshot(), tables: incomplete }),
    ).rejects.toThrow(/la table « activities » est absente/);
  });

  it("carries a current-version file's own categories rows through untouched", async () => {
    const result = await importBackup({
      ...snapshot(),
      tables: { ...snapshot().tables, categories: categoryRows },
    });

    expect(result).toEqual({ imported: 14, skipped: 0 });
    expect(await db.categories.count()).toBe(14);
  });

  it("writes nothing at all when validation fails", async () => {
    const broken = {
      ...snapshot(),
      tables: {
        ...snapshot().tables,
        rationItems: [{ label: "sans id" }],
        horses: [horse()],
      },
    };

    await expect(importBackup(broken)).rejects.toThrow(/rationItems/);
    // The valid horse must not have landed: validation runs before the
    // transaction opens, so a bad file is rejected whole.
    expect(await db.horses.count()).toBe(0);
  });
});

/**
 * Léa's own database, exported at schema v13 on 2026-09-17 — the day her
 * install was confirmed past every migration — and scrubbed of names: owner,
 * horse identity, practitioners, merchants, the coach and every note. Ids,
 * dates, amounts, titles and category rows are exactly what the phone wrote.
 *
 * Every other test on this file builds the row it wants, which means every one
 * of them tests what its author was already thinking about. This one is the
 * shape that actually exists on a phone: 124 posts across twelve categories,
 * 12 tombstones, courses with an end date and a dose, and the user's own
 * activities.
 *
 * Pulled in with Vite's `?raw` suffix and parsed here, rather than imported
 * as a module: `resolveJsonModule` is off, and turning it on to type one
 * fixture would let any JSON become an importable module. `types` in
 * `tsconfig.json` is `["vite/client"]` on purpose — browser only — so reading
 * it through `node:fs` was not an option either; that would have meant
 * admitting Node's globals into the app's ambient types to serve a test.
 *
 * The totals below were computed from the file before it was scrubbed, and
 * scrubbing touched no amount. If a change makes one of them move, that is
 * money leaving a real ledger — not a fixture needing an update.
 */
const REAL_V13_EXPORT = JSON.parse(realV13ExportRaw) as BackupSnapshot;

const REAL_V13_POST_COUNT = 124;
const REAL_V13_TOMBSTONES = 12;
/** Cents across every post in the fixture, tombstones included. */
const REAL_V13_TOTAL_CENTS = 1_593_101;

const realV13Export = (): BackupSnapshot => structuredClone(REAL_V13_EXPORT);

const REAL_V13_TABLES = Object.keys(
  REAL_V13_EXPORT.tables,
) as RecordTableName[];

const totalCents = (posts: Post[]) =>
  posts.reduce(
    (sum, entry) => sum + (Number(entry.customFields?.amountCents) || 0),
    0,
  );

const byId = (rows: readonly { id: string }[]) =>
  [...rows].sort((a, b) => a.id.localeCompare(b.id));

/**
 * What a restore takes from the file for a category. Its definition — label,
 * icon, fields — is whatever this build ships, reapplied after the merge.
 */
const decidedByFile = ({
  id,
  key,
  ownerId,
  createdAt,
  updatedAt,
  deletedAt,
  enabled,
}: Category) => ({
  id,
  key,
  ownerId,
  createdAt,
  updatedAt,
  deletedAt,
  enabled,
});

describe("importBackup — a real v13 export", () => {
  it("restores into an empty database with every row written", async () => {
    const result = await importBackup(realV13Export());

    const rowCount = REAL_V13_TABLES.reduce(
      (sum, name) => sum + REAL_V13_EXPORT.tables[name].length,
      0,
    );
    expect(result).toEqual({ imported: rowCount, skipped: 0 });
    expect(await db.posts.count()).toBe(REAL_V13_POST_COUNT);
  });

  it("does not lose a cent", async () => {
    expect(totalCents(REAL_V13_EXPORT.tables.posts)).toBe(REAL_V13_TOTAL_CENTS);

    await importBackup(realV13Export());

    expect(totalCents(await db.posts.toArray())).toBe(REAL_V13_TOTAL_CENTS);
  });

  it("keeps the 12 tombstones, so the deletions survive the restore", async () => {
    await importBackup(realV13Export());

    const posts = await db.posts.toArray();
    expect(posts.filter((row) => row.deletedAt !== null)).toHaveLength(
      REAL_V13_TOMBSTONES,
    );
  });

  it("leaves every post on a category and every document on a post", async () => {
    await importBackup(realV13Export());

    const keys = new Set((await db.categories.toArray()).map((row) => row.key));
    const posts = await db.posts.toArray();
    for (const row of posts) expect(keys.has(row.categoryKey)).toBe(true);

    const postIds = new Set(posts.map((row) => row.id));
    for (const row of await db.documents.toArray()) {
      if (row.postId !== null) expect(postIds.has(row.postId)).toBe(true);
    }
  });

  it("exports back exactly what it restored", async () => {
    await importBackup(realV13Export());

    const exported = await exportBackup();

    expect(exported.schemaVersion).toBe(REAL_V13_EXPORT.schemaVersion);
    expect(exported.ownerId).toBe(REAL_V13_EXPORT.ownerId);
    for (const name of REAL_V13_TABLES) {
      if (name === "categories") continue;
      expect(byId(exported.tables[name])).toStrictEqual(
        byId(REAL_V13_EXPORT.tables[name]),
      );
    }
    expect(byId(exported.tables.categories.map(decidedByFile))).toStrictEqual(
      byId(REAL_V13_EXPORT.tables.categories.map(decidedByFile)),
    );
  });

  it("restores its categories over a freshly seeded install", async () => {
    await seedIfEmpty();

    await importBackup(realV13Export());

    const restored = await db.categories.toArray();
    expect(byId(restored.map(decidedByFile))).toStrictEqual(
      byId(REAL_V13_EXPORT.tables.categories.map(decidedByFile)),
    );
  });
});

describe("importBackup — atomicity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rolls the whole restore back when a write fails partway", async () => {
    // The restore used to run as five separate transactions, so a failure here
    // — after the seed purge and after two tables had merged — left the demo
    // horse deleted and half the file written, with nothing able to report or
    // repair it. `categories` is merged sixth of seven, so by the time this
    // throws, `horses` and `posts` have already been put.
    await seedIfEmpty();
    const seededHorses = await db.horses.count();
    const seededPosts = await db.posts.count();
    expect(seededHorses).toBeGreaterThan(0);

    vi.spyOn(db.categories, "put").mockRejectedValueOnce(
      new Error("disque plein"),
    );

    await expect(
      importBackup(
        snapshot({
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

    vi.spyOn(db.categories, "put").mockRejectedValueOnce(
      new Error("disque plein"),
    );

    await expect(
      importBackup(snapshot({ tables: { categories: categoryRows } })),
    ).rejects.toThrow();

    expect(getOwnerId()).toBe(LOCAL_OWNER);
    expect((await db.meta.get("ownerId"))?.value).toBe(LOCAL_OWNER);
  });
});
