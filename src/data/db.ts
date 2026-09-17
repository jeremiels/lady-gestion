import Dexie, { liveQuery, type Table } from "dexie";
import type {
  ActivityItem,
  DocumentBlob,
  Category,
  Horse,
  MetaEntry,
  Post,
  RationItem,
  StoredDocument,
  UserProfile,
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
 * a restore can tell what it is reading; see `backup/snapshot.ts`.
 *
 * Only the current version is declared. v1 to v13 each had their own
 * `this.version(n).upgrade()` here; the chain was dropped on 2026-09-17, once
 * the one install in use was confirmed at v13 by a backup it exported, and the
 * history is in git up to b210ede. The cost is deliberate: a database still
 * below v13 can no longer be upgraded — Dexie deletes a store the declared
 * schema does not list, so it would open with `posts` and `categories` empty.
 *
 * Bumping this means declaring the new version below with an `upgrade()` for
 * databases already on a device, and deciding what a backup file from the
 * previous version becomes in `backup/snapshot.ts`.
 */
export const SCHEMA_VERSION = 13;

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
 *
 * `Category.parentId` is unindexed for the same null reason, even though it is
 * what the tree is walked by: every root, which is most of the catalogue,
 * would vanish from the index. `Category.enabled` is unindexed because a
 * boolean is not a valid IndexedDB key, so that index would never hold a row.
 * The catalogue is read whole and filtered in memory. `key` and `order` are
 * indexed: `key` is what `Post.categoryKey` joins against, `order` is what the
 * budget donut sorts by.
 *
 * `activities` is indexed on `horseId` alone rather than a compound: the
 * catalogue is read whole, for one horse, and ordered in memory by `createdAt`.
 * `profiles` holds one row in practice, so only the bookkeeping is indexed.
 */
const STORES = {
  horses: "id, name, updatedAt",
  posts:
    "id, horseId, date, categoryKey, status, [horseId+date], [horseId+categoryKey], updatedAt",
  documents: "id, horseId, postId, category, [horseId+category], updatedAt",
  documentBlobs: "documentId",
  rationItems: "id, horseId, [horseId+sortOrder], updatedAt",
  activities: "id, horseId, updatedAt",
  categories: "id, key, order, updatedAt",
  profiles: "id, updatedAt",
  meta: "key",
} as const;

export class LadyGestionDb extends Dexie {
  horses!: Table<Horse, string>;
  posts!: Table<Post, string>;
  documents!: Table<StoredDocument, string>;
  documentBlobs!: Table<DocumentBlob, string>;
  rationItems!: Table<RationItem, string>;
  activities!: Table<ActivityItem, string>;
  categories!: Table<Category, string>;
  profiles!: Table<UserProfile, string>;
  meta!: Table<MetaEntry, string>;

  constructor() {
    super("lady-gestion");

    this.version(SCHEMA_VERSION).stores(STORES);
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
  posts: db.posts,
  documents: db.documents,
  rationItems: db.rationItems,
  activities: db.activities,
  categories: db.categories,
  profiles: db.profiles,
} as const;

export type RecordTableName = keyof typeof RECORD_TABLES;

/** `{ horses: Horse[], posts: Post[], … }`, derived rather than restated. */
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
