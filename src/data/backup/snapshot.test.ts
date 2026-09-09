import { beforeEach, describe, expect, it } from "vitest";
import { db, SCHEMA_VERSION, type BackupTables } from "../db.ts";
import { BUILT_IN_EVENT_TYPES } from "../event-types.ts";
import { followUpValue } from "../events.ts";
import { getOwnerId, setOwnerId } from "../owner.ts";
import { DEFAULT_SEASON } from "../seasons.ts";
import type { EventTypeDef, Horse, HorseEvent, RationItem } from "../types.ts";
import {
  exportBackup,
  importBackup,
  migrateSnapshot,
  type BackupSnapshot,
} from "./snapshot.ts";

const LOCAL_OWNER = "owner-local";
const REMOTE_OWNER = "owner-remote";

const horse = (over: Partial<Horse> = {}): Horse => ({
  id: "horse-1",
  ownerId: REMOTE_OWNER,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  name: "Ladympala",
  sex: "jument",
  birthDate: "2021-05-01",
  breed: null,
  coat: null,
  sireNumber: null,
  sireName: null,
  damName: null,
  photoDocumentId: null,
  archivedAt: null,
  ...over,
});

const ration = (over: Partial<RationItem> = {}): RationItem => ({
  id: "ration-1",
  ownerId: REMOTE_OWNER,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  horseId: "horse-1",
  label: "Fib & fib",
  quantity: 2,
  unit: "kg",
  season: null,
  sortOrder: 0,
  ...over,
});

const event = (over: Partial<HorseEvent> = {}): HorseEvent => ({
  id: "event-1",
  ownerId: REMOTE_OWNER,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  horseId: "horse-1",
  type: "veto",
  title: "Contrôle œil",
  date: "2026-06-15",
  time: null,
  status: "planned",
  currency: "EUR",
  location: null,
  notes: null,
  recurrenceId: null,
  customFields: {},
  ...over,
});

const STAMP = "2026-01-01T00:00:00.000Z";

/** The 13 built-in types, stamped — what a current-schema snapshot carries. */
const eventTypeRows: EventTypeDef[] = BUILT_IN_EVENT_TYPES.map((def) => ({
  ...def,
  id: `type-${def.key}`,
  ownerId: REMOTE_OWNER,
  createdAt: STAMP,
  updatedAt: STAMP,
  deletedAt: null,
}));

/**
 * A well-formed snapshot, overridden where a test cares.
 *
 * `tables` merges rather than replaces, so a case names only the table it is
 * about. Every case used to restate all four to satisfy `BackupTables`, which
 * meant adding a table to the schema broke seven literals that were never the
 * point of their own test.
 */
const snapshot = (
  over: Partial<Omit<BackupSnapshot, "tables">> & {
    tables?: Partial<BackupTables>;
  } = {},
): BackupSnapshot => ({
  app: "lady-gestion",
  schemaVersion: SCHEMA_VERSION,
  exportedAt: "2026-08-11T00:00:00.000Z",
  ownerId: REMOTE_OWNER,
  ...over,
  tables: {
    horses: [],
    events: [],
    documents: [],
    rationItems: [],
    activities: [],
    eventTypes: [],
    ...over.tables,
  },
});

beforeEach(async () => {
  await db.open();
  await Promise.all([
    db.horses.clear(),
    db.events.clear(),
    db.documents.clear(),
    db.documentBlobs.clear(),
    db.rationItems.clear(),
    db.activities.clear(),
    db.eventTypes.clear(),
    db.meta.clear(),
  ]);
  await setOwnerId(LOCAL_OWNER);
});

describe("exportBackup", () => {
  it("writes an envelope carrying the schema version and owner", async () => {
    const backup = await exportBackup();

    expect(backup.app).toBe("lady-gestion");
    expect(backup.schemaVersion).toBe(SCHEMA_VERSION);
    expect(backup.ownerId).toBe(LOCAL_OWNER);
    // Spelled out rather than derived from `RECORD_TABLES`: this is the
    // assertion that a table added to the schema is actually exported, and one
    // that reads its expectation from the same constant asserts nothing.
    // `Array#sort()` is case-sensitive ASCII order — "eventTypes" (uppercase
    // T) sorts before "events" (lowercase s).
    expect(Object.keys(backup.tables).sort()).toEqual([
      "activities",
      "documents",
      "eventTypes",
      "events",
      "horses",
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

describe("migrateSnapshot", () => {
  // Only the v7 step gets a dedicated test here — the others predate a test
  // for `migrateSnapshot` on its own and are otherwise covered through
  // `importBackup`.
  it("adds alimentation's quantity field to a pre-v7 file", () => {
    const current = eventTypeRows.find((type) => type.key === "alimentation")!;
    const preV7 = {
      ...current,
      fields: current.fields.filter((field) => field.id !== "quantity"),
    };

    const migrated = migrateSnapshot(
      snapshot({ schemaVersion: 6, tables: { eventTypes: [preV7] } }),
    );

    const alimentation = migrated.tables.eventTypes.find(
      (type) => type.id === preV7.id,
    )!;
    expect(alimentation.fields.map((field) => field.id).sort()).toEqual([
      "amountCents",
      "counterparty",
      "quantity",
    ]);
  });

  it("does not duplicate the field on an already-migrated row", () => {
    const current = eventTypeRows.find((type) => type.key === "alimentation")!;

    const migrated = migrateSnapshot(
      snapshot({ schemaVersion: 6, tables: { eventTypes: [current] } }),
    );

    const alimentation = migrated.tables.eventTypes.find(
      (type) => type.id === current.id,
    )!;
    expect(alimentation.fields).toEqual(current.fields);
  });

  it("gives a pre-v8 file's event types an explicit null parent", () => {
    // A v7 file has no such key at all, and `undefined` is not `null` — the
    // merge would write a row contradicting the declared type, and the next
    // export would drop the key again.
    const { parentId: _parentId, ...preV8 } = eventTypeRows[0]!;

    const migrated = migrateSnapshot(
      snapshot({
        schemaVersion: 7,
        tables: { eventTypes: [preV8 as EventTypeDef] },
      }),
    );

    expect(migrated.tables.eventTypes[0]).toHaveProperty("parentId", null);
  });

  it("keeps a parent a pre-v8 file somehow already carries", () => {
    const nested = { ...eventTypeRows[0]!, parentId: "soins" };

    const migrated = migrateSnapshot(
      snapshot({ schemaVersion: 7, tables: { eventTypes: [nested] } }),
    );

    expect(migrated.tables.eventTypes[0]?.parentId).toBe("soins");
  });

  /**
   * The four rows v9 cares about, as a v8 file carried them: all roots, each
   * with the presentation it owned before nesting.
   *
   * The ids are deliberately not the keys. A seeded built-in has `id === key`,
   * so a fixture that repeated that would pass whether the step resolved the
   * parent's id out of the file or simply assumed the key was one — and a file
   * written by another build is exactly where that assumption breaks.
   */
  const preV9Types = (): EventTypeDef[] => {
    const row = (key: string, over: Partial<EventTypeDef> = {}) => ({
      ...eventTypeRows.find((type) => type.key === key)!,
      id: `type-${key}`,
      parentId: null,
      ...over,
    });

    return [
      row("alimentation"),
      row("veto"),
      row("cures", { icon: "pawPrint", theme: "purple" }),
      row("traitement", { icon: "info", theme: "orange" }),
    ];
  };

  it("files a pre-v9 file's cures and traitement under their parent", () => {
    const migrated = migrateSnapshot(
      snapshot({ schemaVersion: 8, tables: { eventTypes: preV9Types() } }),
    );

    const byId = new Map(migrated.tables.eventTypes.map((t) => [t.id, t]));
    expect(byId.get("type-cures")).toMatchObject({
      parentId: "type-alimentation",
      icon: null,
      theme: null,
    });
    expect(byId.get("type-traitement")).toMatchObject({
      parentId: "type-veto",
      icon: null,
      theme: null,
    });
    // The parents keep everything: they gained a child, not a parent.
    expect(byId.get("type-alimentation")).toMatchObject({
      parentId: null,
      icon: "carrot",
      theme: "yellow",
    });
  });

  it("keeps a parent the file already carries", () => {
    const types = preV9Types().map((type) =>
      type.key === "cures" ? { ...type, parentId: "type-veto" } : type,
    );

    const migrated = migrateSnapshot(
      snapshot({ schemaVersion: 8, tables: { eventTypes: types } }),
    );

    const cures = migrated.tables.eventTypes.find((t) => t.id === "type-cures");
    expect(cures).toMatchObject({ parentId: "type-veto", theme: "purple" });
  });

  it("leaves a child alone when its parent is not in the file", () => {
    // The parent type was deleted on the device that wrote this backup.
    // Writing the link anyway would point at nothing, which `resolveCatalogue`
    // reads back as "root" — the same outcome, reached by an accident rather
    // than a rule.
    const types = preV9Types().filter((type) => type.key !== "alimentation");

    const migrated = migrateSnapshot(
      snapshot({ schemaVersion: 8, tables: { eventTypes: types } }),
    );

    expect(
      migrated.tables.eventTypes.find((t) => t.id === "type-cures"),
    ).toMatchObject({ parentId: null, icon: "pawPrint", theme: "purple" });
  });

  it("stamps the file up to the current schema version", () => {
    const migrated = migrateSnapshot(snapshot({ schemaVersion: 7 }));

    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
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
      tables: { ...snapshot().tables, events: "nope" },
    };

    await expect(importBackup(broken)).rejects.toThrow(
      /la table « events » est absente/,
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

  it("upgrades a v1 ration row, turning the seasonal flag into a window", async () => {
    // A v1 export predates `season` entirely and carries `seasonal` instead.
    const { season: _season, ...rest } = ration();
    const legacy = { ...rest, seasonal: true };

    await importBackup({
      ...snapshot(),
      schemaVersion: 1,
      tables: { ...snapshot().tables, rationItems: [legacy] },
    });

    const stored = await db.rationItems.get("ration-1");
    expect(stored?.season).toEqual(DEFAULT_SEASON);
    // The old flag must not survive alongside the new field — a stale duplicate
    // is what the next reader trusts by mistake.
    expect(stored).not.toHaveProperty("seasonal");
  });

  it("reads a v1 non-seasonal row as fed all year", async () => {
    const { season: _season, ...rest } = ration();

    await importBackup({
      ...snapshot(),
      schemaVersion: 1,
      tables: {
        ...snapshot().tables,
        rationItems: [{ ...rest, seasonal: false }],
      },
    });

    expect((await db.rationItems.get("ration-1"))?.season).toBe(null);
  });

  it("folds a pre-v3 event's absent vendor/followUpInterval into customFields as null", async () => {
    // A v2 export has no `vendor` and no `followUpInterval` at all, and
    // neither is observable on its own after `importBackup` returns — the
    // v5 -> v6 step below runs in the same call and absorbs both into
    // `customFields`. `event().type` is `veto`, which has both fields.
    //
    // `eventTypes` is omitted entirely, not defaulted to `[]`: a genuinely
    // old file has no such key at all, and `[]` would (wrongly) tell the fold
    // "no built-ins to seed" instead of "none of this file's own".
    const { eventTypes: _eventTypes, ...tables } = snapshot().tables;
    const legacy = event();

    await importBackup({
      ...snapshot(),
      schemaVersion: 2,
      tables: { ...tables, events: [legacy] },
    });

    const stored = await db.events.get("event-1");
    expect(stored?.customFields).toHaveProperty("counterparty", null);
    expect(stored?.customFields).toHaveProperty("followUp", null);
  });

  it("folds a pre-v4 event's absent activity into customFields as null", async () => {
    // A v3 export has no `activity` at all. `travail` is the type that keeps
    // it, unlike `event()`'s default `veto`.
    const { eventTypes: _eventTypes, ...tables } = snapshot().tables;
    const legacy = event({ type: "travail" });

    await importBackup({
      ...snapshot(),
      schemaVersion: 3,
      tables: { ...tables, events: [legacy] },
    });

    expect(await db.events.get("event-1")).toHaveProperty(
      "customFields.activity",
      null,
    );
  });

  it("keeps the customFields values a current-version snapshot carries", async () => {
    const current = event({
      customFields: {
        counterparty: "google",
        followUp: followUpValue({ amount: 6, unit: "week" }),
        activity: "longe",
      },
    });

    await importBackup({
      ...snapshot(),
      tables: { ...snapshot().tables, events: [current] },
    });

    const stored = await db.events.get("event-1");
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

  it("accepts a pre-v5 file that predates the activities and eventTypes tables", async () => {
    // Regression, and the expensive kind: `assertSnapshot` requires every table
    // in `RECORD_TABLES` to be present, so adding one made every backup ever
    // exported unrestorable — on the one feature that exists to stop data being
    // lost. A v4 file simply has neither key.
    const {
      activities: _activities,
      eventTypes: _eventTypes,
      ...v4Tables
    } = snapshot().tables;

    const result = await importBackup({
      ...snapshot(),
      schemaVersion: 4,
      tables: { ...v4Tables, horses: [horse()] },
    });

    // The horse, plus the 13 built-in types the v5 -> v6 step seeds in the
    // same call — a v4 file has neither activities nor a type catalogue.
    expect(result).toEqual({ imported: 14, skipped: 0 });
    expect(await db.activities.count()).toBe(0);
    expect(await db.eventTypes.count()).toBe(13);
  });

  it("still rejects a table missing from a current-version file", async () => {
    // The allowance above is for *older* files only: a file claiming the
    // current schema and missing a table is corrupt, not merely old.
    const { activities: _activities, ...incomplete } = snapshot().tables;

    await expect(
      importBackup({ ...snapshot(), tables: incomplete }),
    ).rejects.toThrow(/la table « activities » est absente/);
  });

  it("carries a current-version file's own eventTypes rows through untouched", async () => {
    const result = await importBackup({
      ...snapshot(),
      tables: { ...snapshot().tables, eventTypes: eventTypeRows },
    });

    expect(result).toEqual({ imported: 13, skipped: 0 });
    expect(await db.eventTypes.count()).toBe(13);
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
