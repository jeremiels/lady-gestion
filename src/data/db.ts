import Dexie, { liveQuery, type Table } from "dexie";
import { nowISO } from "./dates.ts";
import {
  quantityField,
  seedEventTypeDefs,
  SCHEMA_V9_NESTINGS,
} from "./event-types.ts";
import {
  migrateEventToCustomFields,
  type FollowUpInterval,
  type LegacyEventColumns,
  type WorkActivity,
} from "./events.ts";
import { newId } from "./ids.ts";
import { seasonFromLegacyFlag, type RationSeason } from "./seasons.ts";
import type {
  ActivityItem,
  DocumentBlob,
  EventTypeDef,
  Horse,
  HorseEvent,
  MetaEntry,
  RationItem,
  StoredDocument,
} from "./types.ts";

/**
 * The only module in the app that imports `dexie`.
 *
 * Everything above this line talks to `src/data/repositories/*`, which take
 * and return plain domain objects. That boundary is what makes swapping
 * IndexedDB for a hosted database later a change to five repository files
 * rather than a rewrite of every view.
 */

/**
 * Bumped whenever the shape of a table changes. Written into backup files so
 * a restore can tell how to read them; see `backup/snapshot.ts`.
 *
 * Bumping this means writing **two** migrations that must agree: a
 * `this.version(n).upgrade()` below for databases already on the device, and a
 * step in `migrateSnapshot` for backup files exported by an older build.
 *
 * - v1 — initial schema.
 * - v2 — `RationItem.seasonal: boolean` → `RationItem.season: RationSeason | null`.
 * - v3 — `HorseEvent` gains `vendor` and `followUpInterval`, both nullable.
 * - v4 — `HorseEvent` gains `activity`, nullable.
 * - v5 — new `activities` table: the work activities the user added themselves.
 * - v6 — new `eventTypes` table: event types stop being a closed, compile-time
 *   union and become user-visible data. `HorseEvent` loses `providerName`,
 *   `vendor`, `followUpInterval`, `activity` and `amountCents` in favour of a
 *   generic `customFields` bag, keyed by the winning type's field ids.
 * - v7 — `alimentation`'s built-in `fields` gains a `quantity` entry. Unlike
 *   v6, no new table and no new column on `HorseEvent`: only the *content* of
 *   one already-seeded `eventTypes` row changes, so a fresh install and an
 *   upgraded device end up with the same row either way.
 * - v8 — `EventTypeDef` gains `parentId`, nullable: a type can be a variation
 *   of another one and inherit its presentation. `icon` and `theme` become
 *   nullable with it (`null` meaning "take my parent's"), which needs no
 *   rewrite — every existing row already carries both.
 * - v9 — the first built-ins to actually use v8's hierarchy: `cures` files
 *   under `alimentation`, `traitement` under `veto`. Like v7 and unlike v8, no
 *   new table and no new column — only the content of two already-seeded
 *   `eventTypes` rows changes, so a fresh install and an upgraded device end
 *   up with the same catalogue either way.
 */
export const SCHEMA_VERSION = 9;

/**
 * Only indexed fields are listed here — Dexie stores the whole object
 * regardless. Note what is deliberately *absent*: `deletedAt` and
 * `amountCents` are nullable, and IndexedDB drops records whose indexed value
 * is null or undefined out of the index entirely. Indexing them would silently
 * hide every live row. Repositories filter both in memory instead, which is
 * free at this data volume.
 *
 * `season` is likewise unindexed — it is nullable *and* an object, so it could
 * not be a key path at all. Seasonality is resolved in memory by `seasons.ts`.
 */
const STORES = {
  horses: "id, name, updatedAt",
  events:
    "id, horseId, date, type, status, [horseId+date], [horseId+type], updatedAt",
  documents: "id, horseId, eventId, category, [horseId+category], updatedAt",
  documentBlobs: "documentId",
  rationItems: "id, horseId, [horseId+sortOrder], updatedAt",
  meta: "key",
} as const;

/**
 * v5 adds one store; the versions above keep the set they shipped with.
 *
 * Spread rather than appended to `STORES`, so v1..v4 keep declaring the schema
 * they actually declared. Backdating the new table into them would make
 * `db.test.ts` — which writes a database at each old version and then opens
 * this one — exercise the upgrade against a store that version never had.
 *
 * `horseId` alone rather than a compound index: the catalogue is read whole,
 * for one horse, and ordered in memory by `createdAt` so a new chip lands at
 * the end. There is no `sortOrder` to pair it with because nothing reorders it.
 */
const STORES_V5 = { ...STORES, activities: "id, horseId, updatedAt" } as const;

/**
 * v6 adds the event-type catalogue, spread from `STORES_V5` for the same
 * reason that one was spread from `STORES`.
 *
 * `key` and `order` are indexed: `key` is what `HorseEvent.type` joins
 * against, and `order` is what the budget donut sorts by — both read often
 * enough, over what will stay a small table, to be worth a dedicated index
 * rather than an in-memory sort every time.
 */
const STORES_V6 = {
  ...STORES_V5,
  eventTypes: "id, key, order, archived, updatedAt",
} as const;

/** A v1 ration row, mid-upgrade: the old flag is still there, the window is not. */
type LegacyRationItem = {
  seasonal?: boolean;
  season?: RationSeason | null;
};

/** A pre-v3 event row: the two new columns are simply absent. */
type LegacyHorseEvent = {
  vendor?: string | null;
  followUpInterval?: FollowUpInterval | null;
};

/** A pre-v4 event row: no `activity`. */
type LegacyWorkEvent = {
  activity?: WorkActivity | null;
};

/**
 * A pre-v6 event row, mid-upgrade: the five columns `customFields` replaces
 * are still there, and `type` is loosened to a bare `string` because a row may
 * still carry the misspelled `"coucours"` key `migrateEventToCustomFields`
 * corrects. `customFields` itself is declared optional purely so this type can
 * be assigned it during the upgrade — a pre-v6 row has no such key at all.
 */
type LegacyEventRow = { type: string } & Partial<LegacyEventColumns> & {
    customFields?: HorseEvent["customFields"];
  };

/** A pre-v8 event-type row: no `parentId`. */
type LegacyEventTypeRow = {
  parentId?: string | null;
};

export class LadyGestionDb extends Dexie {
  horses!: Table<Horse, string>;
  events!: Table<HorseEvent, string>;
  documents!: Table<StoredDocument, string>;
  documentBlobs!: Table<DocumentBlob, string>;
  rationItems!: Table<RationItem, string>;
  activities!: Table<ActivityItem, string>;
  eventTypes!: Table<EventTypeDef, string>;
  meta!: Table<MetaEntry, string>;

  constructor() {
    super("lady-gestion");

    this.version(1).stores(STORES);

    // No index changed, so the stores are repeated verbatim — this version
    // exists purely to rewrite the rows. `seasonal` is dropped rather than left
    // alongside `season`: a stale duplicate is what the next reader trusts by
    // mistake, and the backup export copies whatever is on the row.
    this.version(2)
      .stores(STORES)
      .upgrade((transaction) =>
        transaction
          .table<LegacyRationItem>("rationItems")
          .toCollection()
          .modify((item) => {
            item.season = seasonFromLegacyFlag(item.seasonal);
            delete item.seasonal;
          }),
      );

    // Adding a nullable column still needs an upgrade: an absent key reads back
    // as `undefined`, not `null`, which contradicts the declared type and is
    // dropped entirely by `JSON.stringify` when the row is exported to a backup.
    // `??=` so a row that somehow already has a value keeps it.
    this.version(3)
      .stores(STORES)
      .upgrade((transaction) =>
        transaction
          .table<LegacyHorseEvent>("events")
          .toCollection()
          .modify((event) => {
            event.vendor ??= null;
            event.followUpInterval ??= null;
          }),
      );

    // Same shape as v3, and for the same reason: an absent key reads back as
    // `undefined`, which contradicts the declared type and is dropped by
    // `JSON.stringify` on export. Unindexed — it is nullable, and IndexedDB
    // drops a record whose indexed value is null out of the index entirely.
    this.version(4)
      .stores(STORES)
      .upgrade((transaction) =>
        transaction
          .table<LegacyWorkEvent>("events")
          .toCollection()
          .modify((event) => {
            event.activity ??= null;
          }),
      );

    // A brand-new store, so there is no row to rewrite and no `.upgrade()` to
    // write — but the version still has to exist, or Dexie never creates it.
    // Nothing seeds it either: the six built-in activities are code, not rows,
    // and this table holds only what the user adds on top of them.
    this.version(5).stores(STORES_V5);

    // Unlike v5, this store *is* seeded — a type an event's `type` can point
    // at has to exist before that event can be read meaningfully, so an empty
    // table here is not an option the way it was for `activities`.
    this.version(6)
      .stores(STORES_V6)
      .upgrade(async (transaction) => {
        // A fresh install runs every version up to this one in the same
        // `db.open()`, before `initOwnerId()` (`owner.ts`) has ever run — so
        // the owner id cannot be read through its usual cache and is resolved
        // here exactly the way that function would, against the same `meta`
        // row, so whichever runs first (this upgrade, or a later
        // `initOwnerId()` on an existing device) leaves the other a no-op.
        const metaTable = transaction.table<{ key: string; value: unknown }>(
          "meta",
        );
        const existingOwner = await metaTable.get("ownerId");
        const ownerId =
          typeof existingOwner?.value === "string"
            ? existingOwner.value
            : newId();
        if (!existingOwner) {
          await metaTable.put({ key: "ownerId", value: ownerId });
        }

        const types = seedEventTypeDefs(ownerId, nowISO());
        await transaction.table<EventTypeDef>("eventTypes").bulkAdd(types);

        await transaction
          .table<LegacyEventRow>("events")
          .toCollection()
          .modify((event) => {
            const { type, customFields } = migrateEventToCustomFields(
              {
                type: event.type,
                providerName: event.providerName ?? null,
                vendor: event.vendor ?? null,
                followUpInterval: event.followUpInterval ?? null,
                activity: event.activity ?? null,
                amountCents: event.amountCents ?? null,
              },
              types,
            );
            event.type = type;
            event.customFields = customFields;
            delete event.providerName;
            delete event.vendor;
            delete event.followUpInterval;
            delete event.activity;
            delete event.amountCents;
          });
      });

    // No index changed and no new table, so the stores are repeated verbatim
    // — same reason v2's comment gives. `alimentation` is addressed by `key`,
    // the stable slug `findEventType` and every other lookup in this app
    // already resolves a type by — not `id`, which happens to equal it for a
    // freshly-seeded built-in (`seedEventTypeDefs`) but is not the field
    // anything else here treats as the type's identity. A device with no such
    // row (the type was since deleted) or one already carrying a `quantity`
    // field (seeded fresh, past this version) simply sees `.modify()` match
    // nothing or add a harmless duplicate — guarded against below all the
    // same, since a backup restore can replay this row.
    this.version(7)
      .stores(STORES_V6)
      .upgrade((transaction) =>
        transaction
          .table<EventTypeDef>("eventTypes")
          .where("key")
          .equals("alimentation")
          .modify((type) => {
            if (!type.fields.some((field) => field.id === "quantity")) {
              type.fields = [...type.fields, quantityField()];
            }
          }),
      );

    // No index changed, so the stores are repeated verbatim once more.
    // `parentId` is deliberately *not* indexed even though it is what the tree
    // is walked by: it is nullable, and IndexedDB drops a record whose indexed
    // value is null out of the index entirely — every root, which is the whole
    // catalogue, would vanish from it. Same reason `deletedAt` is absent from
    // every store string above. The catalogue is read whole anyway.
    //
    // `icon` and `theme` widen to nullable in the same version and need no
    // rewrite: every row already has a real value, and `null` is a state only
    // the type editor ever writes. `??=` so replaying this — a backup restored
    // onto a device already past v8 — leaves a real parent alone.
    this.version(8)
      .stores(STORES_V6)
      .upgrade((transaction) =>
        transaction
          .table<LegacyEventTypeRow>("eventTypes")
          .toCollection()
          .modify((type) => {
            type.parentId ??= null;
          }),
      );

    // No index changed once more, so the stores are repeated verbatim again.
    //
    // The parent's `id` is looked up from the table rather than assumed equal
    // to its `key`. That equality holds for a row `seedEventTypeDefs` wrote,
    // and `SCHEMA_V9_NESTINGS` is keyed by `key` precisely so this does not
    // have to rely on it: a file restored from a build that generated ids
    // differently would otherwise get a `parentId` pointing at nothing, which
    // `resolveCatalogue` quietly reads back as "root" — the nesting would
    // simply not happen, with nothing to show for it.
    //
    // Guarded on the row still being a root, so replaying this is a no-op:
    // a device upgraded live, backed up, then restored onto itself runs it
    // twice, and a parent link the user chose themselves must survive it.
    // `updatedAt` is deliberately left alone, as in v7 — it is what a restore
    // arbitrates last-write-wins by, and a migration every device runs is not
    // an edit that should win that argument.
    this.version(9)
      .stores(STORES_V6)
      .upgrade(async (transaction) => {
        const table = transaction.table<EventTypeDef>("eventTypes");
        const rows = await table.toArray();

        for (const { key, parentKey } of SCHEMA_V9_NESTINGS) {
          const child = rows.find((type) => type.key === key);
          const parent = rows.find((type) => type.key === parentKey);
          if (!child || !parent || child.parentId !== null) continue;

          await table.put({
            ...child,
            parentId: parent.id,
            icon: null,
            theme: null,
          });
        }
      });
  }
}

export const db = new LadyGestionDb();

/**
 * The record tables, as one value.
 *
 * Every whole-database operation used to enumerate these by hand, and each did
 * it separately: `exportBackup` read four tables, `importBackup` merged four,
 * `assertSnapshot` validated a fifth list of four names, `BackupSnapshot`
 * declared the shape a sixth time, and `clearUntouchedSeedData` purged its own
 * four. Adding a table meant finding all of them, and the one you miss fails
 * silently — a table absent from the export is data that quietly does not
 * survive a restore.
 *
 * This is the rule `forms.ts` already states for form fields ("build the schema
 * and the field names from the same array"), applied to the schema itself. Add
 * a table here and the export, the merge, the validator and the seed purge all
 * pick it up; `BackupTables` below makes the snapshot's type follow too.
 *
 * `documentBlobs` and `meta` are deliberately absent. Blobs travel separately
 * from the snapshot (see `backup/snapshot.ts`) and `meta` is device-local state
 * that is never exported — both are handled explicitly by the code that needs
 * them, which is the point of them not being in this list.
 */
export const RECORD_TABLES = {
  horses: db.horses,
  events: db.events,
  documents: db.documents,
  rationItems: db.rationItems,
  activities: db.activities,
  eventTypes: db.eventTypes,
} as const;

export type RecordTableName = keyof typeof RECORD_TABLES;

/** `{ horses: Horse[], events: HorseEvent[], … }`, derived rather than restated. */
export type BackupTables = {
  [K in RecordTableName]: (typeof RECORD_TABLES)[K] extends Table<
    infer T,
    string
  >
    ? T[]
    : never;
};

// Re-exported so `live.ts` gets reactivity without importing dexie itself.
export { liveQuery };

// There is deliberately no `clearAllTables()`. One existed, documented as used
// by backup restore — but `importBackup` *merges* (last-write-wins) rather than
// replacing, and nothing else called it. A wipe helper that no code path uses
// is a loaded gun; add it back with its caller, not before.
