import { beforeEach, describe, expect, it } from "vitest";
import realV5ExportRaw from "../__tests__/fixtures/real-v5-export.json?raw";
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

/** The 14 built-in types, stamped — what a current-schema snapshot carries. */
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
      "date",
      "notes",
      "quantity",
      "title",
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
      theme: "coral",
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

  /**
   * The two rows v10 touches, as a v9 file carried them: `soins` and `osteo`,
   * both roots, `osteo` with the icon and theme it owned before nesting.
   *
   * Hand-derived from `eventTypeRows` the same way `preV9Types` is, for the
   * same reason: reading the nesting off the live rows would exercise the
   * upgrade against its own output.
   */
  const preV10Types = (): EventTypeDef[] => {
    const row = (key: string, over: Partial<EventTypeDef> = {}) => ({
      ...eventTypeRows.find((type) => type.key === key)!,
      id: `type-${key}`,
      parentId: null,
      ...over,
    });

    return [row("soins"), row("osteo", { icon: "pawPrint", theme: "orange" })];
  };

  it("files a pre-v10 file's osteo under soins, keeping its icon", () => {
    const migrated = migrateSnapshot(
      snapshot({ schemaVersion: 9, tables: { eventTypes: preV10Types() } }),
    );

    const byId = new Map(migrated.tables.eventTypes.map((t) => [t.id, t]));
    expect(byId.get("type-osteo")).toMatchObject({
      parentId: "type-soins",
      icon: "pawPrint",
      theme: null,
    });
    // Read off the shipped row: the parent gained a child, not a parent, so
    // what matters is that v10 left its presentation alone — not which colour
    // that presentation happens to be this week.
    const soins = eventTypeRows.find((type) => type.key === "soins")!;
    expect(byId.get("type-soins")).toMatchObject({
      parentId: null,
      icon: soins.icon,
      theme: soins.theme,
    });
  });

  it("keeps a parent the file already carries", () => {
    const types = preV10Types().map((type) =>
      type.key === "osteo" ? { ...type, parentId: "type-soins" } : type,
    );

    const migrated = migrateSnapshot(
      snapshot({ schemaVersion: 9, tables: { eventTypes: types } }),
    );

    const osteo = migrated.tables.eventTypes.find((t) => t.id === "type-osteo");
    expect(osteo).toMatchObject({ parentId: "type-soins", theme: "orange" });
  });

  it("leaves osteo alone when soins is not in the file", () => {
    const types = preV10Types().filter((type) => type.key !== "soins");

    const migrated = migrateSnapshot(
      snapshot({ schemaVersion: 9, tables: { eventTypes: types } }),
    );

    expect(
      migrated.tables.eventTypes.find((t) => t.id === "type-osteo"),
    ).toMatchObject({ parentId: null, icon: "pawPrint", theme: "orange" });
  });

  it("adds massage as a new child of soins to a pre-v10 file", () => {
    const migrated = migrateSnapshot(
      snapshot({ schemaVersion: 9, tables: { eventTypes: preV10Types() } }),
    );

    const soins = migrated.tables.eventTypes.find((t) => t.key === "soins")!;
    const massage = migrated.tables.eventTypes.find((t) => t.key === "massage");
    expect(massage).toMatchObject({ label: "Massage", parentId: soins.id });
  });

  it("does not duplicate massage when the file already carries it", () => {
    const massage = {
      ...eventTypeRows.find((type) => type.key === "massage")!,
      id: "type-massage",
      parentId: "type-soins",
    };

    const migrated = migrateSnapshot(
      snapshot({
        schemaVersion: 9,
        tables: { eventTypes: [...preV10Types(), massage] },
      }),
    );

    expect(
      migrated.tables.eventTypes.filter((t) => t.key === "massage"),
    ).toHaveLength(1);
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

    // The horse, plus the 14 built-in types the v5 -> v6 step seeds in the
    // same call — a v4 file has neither activities nor a type catalogue.
    expect(result).toEqual({ imported: 15, skipped: 0 });
    expect(await db.activities.count()).toBe(0);
    expect(await db.eventTypes.count()).toBe(14);
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

    expect(result).toEqual({ imported: 14, skipped: 0 });
    expect(await db.eventTypes.count()).toBe(14);
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
 * Léa's own database, exported at schema v5 and scrubbed of names.
 *
 * Every other migration test on this file builds the row it wants, which
 * means every one of them tests the step its author was already thinking
 * about. This one is the shape that actually exists on a phone: 111 events
 * across nine built-in types, 9 tombstones, 13 work sessions, practitioners
 * and merchants on the columns v6 folds away, and a five-version climb to
 * make — v5 is what the app wrote on 2026-09-07, and v6 landed the next day.
 *
 * Pulled in with Vite's `?raw` suffix and parsed here, rather than imported
 * as a module: `resolveJsonModule` is off, and turning it on to type one
 * fixture would let any JSON become an importable module. `types` in
 * `tsconfig.json` is `["vite/client"]` on purpose — browser only — so reading
 * it through `node:fs` was not an option either; that would have meant
 * admitting Node's globals into the app's ambient types to serve a test.
 *
 * The totals below were computed from the file before it was scrubbed, and
 * scrubbing touched no amount. If a change to the fold makes one of them
 * move, that is money leaving a real ledger — not a fixture needing an
 * update.
 */
const REAL_V5_EXPORT = JSON.parse(realV5ExportRaw) as BackupSnapshot;

/** Cents across every event in the fixture, tombstones included. */
const REAL_TOTAL_CENTS = 1_575_560;
const REAL_EVENT_COUNT = 111;

const realExport = (): BackupSnapshot =>
  structuredClone(REAL_V5_EXPORT) as BackupSnapshot;

const totalCents = (events: HorseEvent[]) =>
  events.reduce(
    (sum, entry) => sum + (Number(entry.customFields?.amountCents) || 0),
    0,
  );

describe("migrateSnapshot — a real v5 export", () => {
  it("carries every event across the five-version climb", () => {
    const migrated = migrateSnapshot(realExport());

    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.tables.events).toHaveLength(REAL_EVENT_COUNT);
  });

  it("does not lose a cent", () => {
    const before = realExport();
    const legacyTotal = before.tables.events.reduce(
      (sum, row) =>
        sum +
        ((row as unknown as { amountCents: number | null }).amountCents ?? 0),
      0,
    );
    expect(legacyTotal).toBe(REAL_TOTAL_CENTS);

    expect(totalCents(migrateSnapshot(before).tables.events)).toBe(
      REAL_TOTAL_CENTS,
    );
  });

  it("keeps the 9 tombstones, so the deletions survive the restore", () => {
    const migrated = migrateSnapshot(realExport());

    expect(
      migrated.tables.events.filter((row) => row.deletedAt !== null),
    ).toHaveLength(9);
  });

  it("folds every legacy column away and leaves none behind", () => {
    const migrated = migrateSnapshot(realExport());

    for (const row of migrated.tables.events) {
      expect(row.customFields).toBeDefined();
      expect(row).not.toHaveProperty("providerName");
      expect(row).not.toHaveProperty("vendor");
      expect(row).not.toHaveProperty("followUpInterval");
      expect(row).not.toHaveProperty("activity");
      expect(row).not.toHaveProperty("amountCents");
    }
  });

  it("keeps every practitioner and merchant, on the field their type carries", () => {
    const before = realExport();
    const named = before.tables.events.filter((candidate) => {
      const legacy = candidate as unknown as {
        providerName: string | null;
        vendor: string | null;
      };
      return legacy.providerName ?? legacy.vendor;
    });
    expect(named.length).toBeGreaterThan(0);

    const migrated = migrateSnapshot(before);
    const byId = new Map(migrated.tables.events.map((e) => [e.id, e]));

    for (const row of named) {
      expect(byId.get(row.id)?.customFields.counterparty).toBeTruthy();
    }
  });

  it("gives the file the 14 built-in types it was exported without", () => {
    const migrated = migrateSnapshot(realExport());

    expect(migrated.tables.eventTypes).toHaveLength(
      BUILT_IN_EVENT_TYPES.length,
    );
    // Every row's type still resolves against the seeded catalogue —
    // an row pointing at a key nothing carries renders untyped.
    const keys = new Set(migrated.tables.eventTypes.map((type) => type.key));
    for (const row of migrated.tables.events) {
      expect(keys.has(row.type)).toBe(true);
    }
  });

  it("restores into an empty database with every row written", async () => {
    const result = await importBackup(realExport());

    expect(result.imported).toBe(
      REAL_EVENT_COUNT +
        REAL_V5_EXPORT.tables.horses.length +
        REAL_V5_EXPORT.tables.documents.length +
        REAL_V5_EXPORT.tables.rationItems.length +
        REAL_V5_EXPORT.tables.activities.length +
        BUILT_IN_EVENT_TYPES.length,
    );
    expect(await db.events.count()).toBe(REAL_EVENT_COUNT);
    expect(totalCents(await db.events.toArray())).toBe(REAL_TOTAL_CENTS);
  });
});
