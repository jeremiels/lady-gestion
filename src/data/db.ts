import Dexie, { liveQuery, type Table } from 'dexie';
import { seasonFromLegacyFlag, type RationSeason } from './seasons.ts';
import type { FollowUpInterval, WorkActivity } from './events.ts';
import type {
  ActivityItem,
  DocumentBlob,
  Horse,
  HorseEvent,
  MetaEntry,
  RationItem,
  StoredDocument,
} from './types.ts';

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
 */
export const SCHEMA_VERSION = 5;

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
  horses: 'id, name, updatedAt',
  events: 'id, horseId, date, type, status, [horseId+date], [horseId+type], updatedAt',
  documents: 'id, horseId, eventId, category, [horseId+category], updatedAt',
  documentBlobs: 'documentId',
  rationItems: 'id, horseId, [horseId+sortOrder], updatedAt',
  meta: 'key',
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
const STORES_V5 = { ...STORES, activities: 'id, horseId, updatedAt' } as const;

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

export class LadyGestionDb extends Dexie {
  horses!: Table<Horse, string>;
  events!: Table<HorseEvent, string>;
  documents!: Table<StoredDocument, string>;
  documentBlobs!: Table<DocumentBlob, string>;
  rationItems!: Table<RationItem, string>;
  activities!: Table<ActivityItem, string>;
  meta!: Table<MetaEntry, string>;

  constructor() {
    super('lady-gestion');

    this.version(1).stores(STORES);

    // No index changed, so the stores are repeated verbatim — this version
    // exists purely to rewrite the rows. `seasonal` is dropped rather than left
    // alongside `season`: a stale duplicate is what the next reader trusts by
    // mistake, and the backup export copies whatever is on the row.
    this.version(2)
      .stores(STORES)
      .upgrade((transaction) =>
        transaction
          .table<LegacyRationItem>('rationItems')
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
          .table<LegacyHorseEvent>('events')
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
          .table<LegacyWorkEvent>('events')
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
} as const;

export type RecordTableName = keyof typeof RECORD_TABLES;

/** `{ horses: Horse[], events: HorseEvent[], … }`, derived rather than restated. */
export type BackupTables = {
  [K in RecordTableName]: (typeof RECORD_TABLES)[K] extends Table<infer T, string> ? T[] : never;
};

// Re-exported so `live.ts` gets reactivity without importing dexie itself.
export { liveQuery };

// There is deliberately no `clearAllTables()`. One existed, documented as used
// by backup restore — but `importBackup` *merges* (last-write-wins) rather than
// replacing, and nothing else called it. A wipe helper that no code path uses
// is a loaded gun; add it back with its caller, not before.
