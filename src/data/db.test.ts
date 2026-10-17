import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, SCHEMA_VERSION } from "./db.ts";
import { watchDatabase } from "./index.ts";

/**
 * Opening the database: on a fresh install, and under another tab that moves
 * it to a newer schema.
 */

const DB_NAME = "lady-gestion";

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

describe("a fresh install", () => {
  it("opens at the version the backup envelope advertises", async () => {
    await db.open();

    expect(db.verno).toBe(SCHEMA_VERSION);
    // Spelled out rather than read from `db.ts`, or the test would compare
    // the schema against itself.
    expect([...db.backendDB().objectStoreNames].sort()).toEqual([
      "activities",
      "categories",
      "documentBlobs",
      "documentFolders",
      "documents",
      "horses",
      "meta",
      "posts",
      "profiles",
      "rationItems",
    ]);
  });
});

describe("another tab upgrading the schema", () => {
  it("reports this tab as superseded and fails its reads", async () => {
    await db.open();
    const superseded = vi.fn();
    watchDatabase({ blocked: () => {}, superseded });

    const newer = new Dexie(DB_NAME);
    newer.version(SCHEMA_VERSION + 1).stores({ meta: "key" });
    await newer.open();
    newer.close();

    expect(superseded).toHaveBeenCalledOnce();
    await expect(db.horses.count()).rejects.toThrow();
  });
});
