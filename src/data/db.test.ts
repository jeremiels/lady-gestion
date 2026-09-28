import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeCategory,
  makeDocument,
  makeHorse,
  makePost,
  makeRation,
} from "./__tests__/factories.ts";
import { db, SCHEMA_VERSION } from "./db.ts";
import { watchDatabase } from "./index.ts";

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

/**
 * The stores v14 declared, as published on 27 Sep 2026: v13's, with the horse
 * indexed by `firstName`. Frozen like `V13_STORES`.
 */
const V14_STORES = { ...V13_STORES, horses: "id, firstName, updatedAt" };

/** A horse as v13 stored it: one `name`, split into two columns at v14. */
const { firstName: _firstName, lastName: _lastName, ...v14Horse } = makeHorse();
const V13_HORSE = { ...v14Horse, name: "Ladympala Coupe Chêne" };

/**
 * A document as v13 and v14 stored it — the first-run demo PDF, the only
 * document any install holds — filed by `category`, which v15 replaces with
 * folders.
 */
const {
  folderId: _folderId,
  driveModifiedAt: _driveModifiedAt,
  ...v14Document
} = makeDocument({ id: "doc-1", postId: "post-1" });
const V13_DOCUMENT = { ...v14Document, category: "compte-rendu" };

/** The stores v15 adds to a v13 or v14 device. */
const V15_NEW_STORES = ["documentFolders"];

const rows = {
  horses: [V13_HORSE],
  posts: [makePost({ id: "post-1", categoryKey: "veto" })],
  documents: [V13_DOCUMENT],
  rationItems: [makeRation()],
  categories: [makeCategory({ id: "veto", key: "veto" })],
  meta: [{ key: "activeHorseId", value: "horse-1" }],
};

/** Writes a database exactly as a v13 device holds it, then closes it. */
const writeV13Database = () => writeDatabase(13, V13_STORES, rows);

/** The same data on a device that took the published v14. */
const writeV14Database = () =>
  writeDatabase(14, V14_STORES, { ...rows, horses: [makeHorse()] });

const writeDatabase = async (
  version: number,
  stores: Record<string, string>,
  tables: Record<string, unknown[]>,
) => {
  const device = new Dexie(DB_NAME);
  device.version(version).stores(stores);
  await device.open();
  for (const [table, values] of Object.entries(tables)) {
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
      [...Object.keys(V13_STORES), ...V15_NEW_STORES].sort(),
    );
    expect(await db.horses.toArray()).toEqual([
      makeHorse({ firstName: "Ladympala", lastName: "Coupe Chêne" }),
    ]);
    expect(await db.posts.toArray()).toEqual(rows.posts);
    expect(await db.rationItems.toArray()).toEqual(rows.rationItems);
    expect(await db.categories.toArray()).toEqual(rows.categories);
    expect(await db.meta.toArray()).toEqual(rows.meta);
  });

  it("drops the demo document and its bytes, and nothing else", async () => {
    await writeV13Database();

    await db.open();

    expect(await db.documents.count()).toBe(0);
    expect(await db.documentBlobs.count()).toBe(0);
    expect(await db.documentFolders.count()).toBe(0);
    // The post it hung off stays: it is her data, the PDF was the demo's.
    expect(await db.posts.get("post-1")).toEqual(rows.posts[0]);
  });

  it("answers the new document indexes", async () => {
    await writeV13Database();

    await db.open();
    await db.documents.add(makeDocument({ id: "doc-2", folderId: "osteo" }));

    expect(await db.documents.where("folderId").equals("osteo").count()).toBe(
      1,
    );
  });

  it("splits the horse's name without restamping the row", async () => {
    await writeV13Database();

    await db.open();

    const [horse] = await db.horses.toArray();
    expect(horse).not.toHaveProperty("name");
    expect(horse).toMatchObject({
      firstName: "Ladympala",
      lastName: "Coupe Chêne",
      updatedAt: V13_HORSE.updatedAt,
    });
    // `horsesRepo.list` orders by the index the upgrade builds.
    expect(await db.horses.orderBy("firstName").count()).toBe(1);
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

describe("opening a database a v14 device already holds", () => {
  it("drops the demo document and its bytes, and keeps every other row", async () => {
    await writeV14Database();

    await db.open();

    expect(db.verno).toBe(SCHEMA_VERSION);
    expect([...db.backendDB().objectStoreNames].sort()).toEqual(
      [...Object.keys(V14_STORES), ...V15_NEW_STORES].sort(),
    );
    expect(await db.horses.toArray()).toEqual([makeHorse()]);
    expect(await db.posts.toArray()).toEqual(rows.posts);
    expect(await db.rationItems.toArray()).toEqual(rows.rationItems);
    expect(await db.categories.toArray()).toEqual(rows.categories);
    expect(await db.meta.toArray()).toEqual(rows.meta);
    expect(await db.documents.count()).toBe(0);
    expect(await db.documentBlobs.count()).toBe(0);
  });
});

describe("a fresh install", () => {
  it("opens at the version the backup envelope advertises", async () => {
    await db.open();

    expect(db.verno).toBe(SCHEMA_VERSION);
    expect([...db.backendDB().objectStoreNames].sort()).toEqual(
      [...Object.keys(V13_STORES), ...V15_NEW_STORES].sort(),
    );
  });
});

describe("another tab upgrading the schema", () => {
  it("reports this tab as superseded and fails its reads", async () => {
    await db.open();
    const superseded = vi.fn();
    watchDatabase({ blocked: () => {}, superseded });

    const newer = new Dexie(DB_NAME);
    newer.version(SCHEMA_VERSION + 1).stores(V13_STORES);
    await newer.open();
    newer.close();

    expect(superseded).toHaveBeenCalledOnce();
    await expect(db.horses.count()).rejects.toThrow();
  });
});
