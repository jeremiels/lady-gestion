import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db.ts";
import type { Category, StoredDocument } from "../types.ts";
import { importBackup, migrateSnapshot } from "./snapshot.ts";
import {
  categoryRows,
  document,
  event,
  resetDatabase,
  snapshot,
} from "./snapshot.fixtures.ts";

/**
 * Schema v13's rename, as a restore applies it to a pre-v13 file. Split from
 * `snapshot.test.ts`, which covers every earlier step.
 */

beforeEach(resetDatabase);

describe("migrateSnapshot — v12 -> v13", () => {
  it("renames a pre-v13 file's events and eventTypes tables", () => {
    const archived = {
      ...categoryRows[0]!,
      enabled: undefined,
      archived: true,
    };

    const migrated = migrateSnapshot(
      snapshot({
        schemaVersion: 12,
        tables: {
          events: [event({ type: "cours" })],
          eventTypes: [archived as unknown as Category],
        },
      }),
    );

    expect(migrated.tables).not.toHaveProperty("events");
    expect(migrated.tables).not.toHaveProperty("eventTypes");
    expect(migrated.tables.posts[0]).toMatchObject({ categoryKey: "cours" });
    expect(migrated.tables.posts[0]).not.toHaveProperty("type");
    expect(migrated.tables.categories[0]).toMatchObject({ enabled: false });
    expect(migrated.tables.categories[0]).not.toHaveProperty("archived");
  });

  it("renames a pre-v13 document's eventId to postId", () => {
    const { postId: _postId, ...rest } = document();
    const migrated = migrateSnapshot(
      snapshot({
        schemaVersion: 12,
        tables: {
          documents: [
            { ...rest, eventId: "event-1" } as unknown as StoredDocument,
          ],
        },
      }),
    );

    expect(migrated.tables.documents[0]).toMatchObject({ postId: "event-1" });
    expect(migrated.tables.documents[0]).not.toHaveProperty("eventId");
  });

  it("restores a pre-v13 file into the renamed tables", async () => {
    const result = await importBackup(
      snapshot({
        schemaVersion: 12,
        tables: { events: [event()], eventTypes: categoryRows },
      }),
    );

    expect(result).toEqual({ imported: 15, skipped: 0 });
    expect(await db.posts.get("event-1")).toMatchObject({
      categoryKey: "veto",
    });
    expect(await db.categories.count()).toBe(14);
  });
});
