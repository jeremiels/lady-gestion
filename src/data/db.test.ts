import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  makeCategory,
  makeDocument,
  makeHorse,
  makePost,
  makeRation,
} from "./__tests__/factories.ts";
import { db, SCHEMA_VERSION } from "./db.ts";

/**
 * Opening a database that is already on the device.
 *
 * This is the only code path in the app that runs on an install already holding
 * the user's data, and it gets exactly one chance: if it throws, or if the
 * declared schema disagrees with the stores that exist, Dexie leaves the
 * database unopenable — or deletes a store — and the app boots to an empty
 * screen with the only copy of the data gone.
 */

const DB_NAME = "lady-gestion";

/**
 * The stores a real v13 device's IndexedDB has — the version its upgrade chain
 * ended on, and the one every install in use was on when `db.ts` stopped
 * declaring that chain. **Do not** update this to track `STORES`, or the test
 * ends up comparing the schema against itself.
 */
const V13_STORES = {
  horses: "id, name, updatedAt",
  documentBlobs: "documentId",
  rationItems: "id, horseId, [horseId+sortOrder], updatedAt",
  meta: "key",
  activities: "id, horseId, updatedAt",
  profiles: "id, updatedAt",
  posts:
    "id, horseId, date, categoryKey, status, [horseId+date], [horseId+categoryKey], updatedAt",
  documents: "id, horseId, postId, category, [horseId+category], updatedAt",
  categories: "id, key, order, updatedAt",
};

const rows = {
  horses: [makeHorse()],
  posts: [makePost({ id: "post-1", categoryKey: "veto" })],
  documents: [makeDocument({ id: "doc-1", postId: "post-1" })],
  rationItems: [makeRation()],
  categories: [makeCategory({ id: "veto", key: "veto" })],
  meta: [{ key: "activeHorseId", value: "horse-1" }],
};

/** Writes a database exactly as a v13 device holds it, then closes it. */
const writeV13Database = async () => {
  const device = new Dexie(DB_NAME);
  device.version(13).stores(V13_STORES);
  await device.open();
  for (const [table, values] of Object.entries(rows)) {
    await device.table(table).bulkAdd(values);
  }
  await device
    .table("documentBlobs")
    .add({ documentId: "doc-1", blob: new Blob(["%PDF"]) });
  device.close();
};

beforeEach(async () => {
  // Every test starts from no database at all, so opening `db` afterwards
  // meets whatever the test wrote rather than a store left by the last one.
  db.close();
  await Dexie.delete(DB_NAME);
});

afterEach(async () => {
  db.close();
  await Dexie.delete(DB_NAME);
});

describe("opening a database a v13 device already holds", () => {
  it("keeps every store and every row as it was", async () => {
    await writeV13Database();

    await db.open();

    expect([...db.backendDB().objectStoreNames].sort()).toEqual(
      Object.keys(V13_STORES).sort(),
    );
    expect(await db.horses.toArray()).toEqual(rows.horses);
    expect(await db.posts.toArray()).toEqual(rows.posts);
    expect(await db.documents.toArray()).toEqual(rows.documents);
    expect(await db.rationItems.toArray()).toEqual(rows.rationItems);
    expect(await db.categories.toArray()).toEqual(rows.categories);
    expect(await db.meta.toArray()).toEqual(rows.meta);
    expect(await db.documentBlobs.count()).toBe(1);
  });

  it("still answers the compound index queries the repositories run", async () => {
    await writeV13Database();

    await db.open();

    expect(
      await db.posts
        .where("[horseId+date]")
        .between(["horse-1", Dexie.minKey], ["horse-1", Dexie.maxKey])
        .count(),
    ).toBe(1);
    expect(
      await db.posts
        .where("[horseId+categoryKey]")
        .equals(["horse-1", "veto"])
        .count(),
    ).toBe(1);
  });

  it("opens at the version the backup envelope advertises", async () => {
    await writeV13Database();

    await db.open();

    // `exportBackup` stamps `SCHEMA_VERSION` onto every file it writes; if the
    // constant and the live database drift, a restore reads the wrong shape.
    expect(db.verno).toBe(SCHEMA_VERSION);
  });
});

describe("a fresh install", () => {
  it("opens at the version the backup envelope advertises", async () => {
    await db.open();

    expect(db.verno).toBe(SCHEMA_VERSION);
    expect([...db.backendDB().objectStoreNames].sort()).toEqual(
      Object.keys(V13_STORES).sort(),
    );
  });
});
