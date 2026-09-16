import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "./db.ts";

/**
 * Schema v13's upgrade — the `events`/`eventTypes` rename — against a database
 * really written by v12. Split from `db.test.ts`, which covers v1..v12 and
 * whose setup this restates.
 */

const DB_NAME = "lady-gestion";

const stamps = {
  ownerId: "owner-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

beforeEach(async () => {
  db.close();
  await Dexie.delete(DB_NAME);
});

afterEach(async () => {
  db.close();
  await Dexie.delete(DB_NAME);
});

/** The stores a real v12 device's IndexedDB actually has — the last schema
 * with `events` and `eventTypes`. Restated, not derived from `db.ts`, for
 * the reason `db.test.ts`'s `LEGACY_STORES` gives. */
const V12_STORES = {
  horses: "id, name, updatedAt",
  events:
    "id, horseId, date, type, status, [horseId+date], [horseId+type], updatedAt",
  documents: "id, horseId, eventId, category, [horseId+category], updatedAt",
  documentBlobs: "documentId",
  rationItems: "id, horseId, [horseId+sortOrder], updatedAt",
  meta: "key",
  activities: "id, horseId, updatedAt",
  eventTypes: "id, key, order, archived, updatedAt",
  profiles: "id, updatedAt",
};

/** A `travail` session as v12 wrote it: `type` where `categoryKey` is now. */
const v12Event = (id: string) => ({
  ...stamps,
  id,
  horseId: "horse-1",
  type: "travail",
  title: "Balade à pied",
  date: "2026-06-15",
  time: null,
  status: "done",
  currency: "EUR",
  location: null,
  notes: null,
  recurrenceId: null,
  customFields: { activity: "balade" },
});

/** A category row as v12 wrote it: `archived`, no `enabled`. */
const v12Category = (key: string, archived: boolean) => ({
  ...stamps,
  id: key,
  key,
  label: key,
  parentId: null,
  icon: "carrot",
  theme: "coral",
  isBuiltIn: true,
  isAppointment: false,
  tracksWork: false,
  archived,
  order: 0,
  fields: [],
});

/** A document row as v12 wrote it: `eventId`, no `postId`. */
const v12Document = (id: string, eventId: string | null) => ({
  ...stamps,
  id,
  horseId: "horse-1",
  eventId,
  category: "facture",
  name: `${id}.pdf`,
  mimeType: "application/pdf",
  size: 1,
  issuedAt: null,
  driveFileId: null,
  driveSyncedAt: null,
});

const writeV12Database = async (rows: {
  events?: unknown[];
  eventTypes?: unknown[];
  documents?: unknown[];
}) => {
  const legacy = new Dexie(DB_NAME);
  legacy.version(12).stores(V12_STORES);
  await legacy.open();
  if (rows.events?.length) await legacy.table("events").bulkAdd(rows.events);
  if (rows.eventTypes?.length) {
    await legacy.table("eventTypes").bulkAdd(rows.eventTypes);
  }
  if (rows.documents?.length) {
    await legacy.table("documents").bulkAdd(rows.documents);
  }
  legacy.close();
};

describe("v12 -> v13: events become posts, event types become categories", () => {
  it("moves every event into posts, renaming type to categoryKey", async () => {
    await writeV12Database({ events: [v12Event("event-1")] });

    await db.open();

    const post = await db.posts.get("event-1");
    expect(post).toMatchObject({
      categoryKey: "travail",
      customFields: { activity: "balade" },
      updatedAt: stamps.updatedAt,
    });
    expect(post).not.toHaveProperty("type");
    // Queryable through the renamed compound index, not just by id.
    expect(
      await db.posts
        .where("[horseId+categoryKey]")
        .equals(["horse-1", "travail"])
        .count(),
    ).toBe(1);
  });

  it("turns archived into its inverse, enabled", async () => {
    await writeV12Database({
      eventTypes: [v12Category("veto", false), v12Category("achat", true)],
    });

    await db.open();

    const veto = await db.categories.get("veto");
    expect(veto).toMatchObject({ enabled: true, updatedAt: stamps.updatedAt });
    expect(veto).not.toHaveProperty("archived");
    expect(await db.categories.get("achat")).toMatchObject({ enabled: false });
  });

  it("renames a document's eventId to postId", async () => {
    await writeV12Database({
      documents: [v12Document("doc-1", "event-1"), v12Document("doc-2", null)],
    });

    await db.open();

    const linked = await db.documents.get("doc-1");
    expect(linked).toMatchObject({ postId: "event-1" });
    expect(linked).not.toHaveProperty("eventId");
    expect(await db.documents.get("doc-2")).toMatchObject({ postId: null });
    expect(await db.documents.where("postId").equals("event-1").count()).toBe(
      1,
    );
  });

  it("drops the old stores", async () => {
    await writeV12Database({ events: [v12Event("event-1")] });

    await db.open();

    const names = db.tables.map((table) => table.name);
    expect(names).toContain("posts");
    expect(names).toContain("categories");
    expect(names).not.toContain("events");
    expect(names).not.toContain("eventTypes");
  });
});
