import Dexie, { liveQuery, type Table } from "dexie";
import type {
  ActivityItem,
  DocumentBlob,
  DocumentFolder,
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
 * Bumped whenever the shape of a table changes. Written into backup files,
 * and a restore reads a file at this version only (`checkBackup`).
 *
 * Only this version is declared, with no `upgrade()`: every install in use is
 * on it. Bumping it means writing the upgrade for devices on the version
 * before, and a way to read that version's backup files — without one, the
 * backups already in her Drive stop restoring.
 */
export const SCHEMA_VERSION = 16;

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
 * The catalogue is read whole and filtered in memory, so the `key` and
 * `order` indexes serve no query today; like the unused `posts` indexes, they
 * are left for the next schema bump to drop.
 *
 * The document tables index nullable columns on purpose — `folderId`,
 * `driveFileId`, `driveFolderId`, `parentId` — because every query on them is
 * a lookup *by* a value (a folder's documents, the row a Drive id maps to),
 * never a search for the nulls a null-valued row would be missing from.
 *
 * `activities` is indexed on `horseId` alone rather than a compound: the
 * catalogue is read whole, for one horse, and ordered in memory by `createdAt`.
 * `profiles` holds one row in practice, so only the bookkeeping is indexed.
 */
const STORES = {
  horses: "id, firstName, updatedAt",
  posts:
    "id, horseId, date, categoryKey, status, [horseId+date], [horseId+categoryKey], updatedAt",
  documents: "id, horseId, postId, folderId, driveFileId, updatedAt",
  documentFolders: "id, driveFolderId, parentId, updatedAt",
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
  documentFolders!: Table<DocumentFolder, string>;
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
 * Every whole-database operation reads this one object — the export, the
 * restore, the snapshot validator, `isUntouchedSeed` — and `BackupTables`
 * below makes the snapshot's type follow. Add a table here and all of them
 * pick it up; a table one of them missed would be data that quietly does not
 * survive a restore.
 *
 * This is the rule `forms.ts` already states for form fields ("build the schema
 * and the field names from the same array"), applied to the schema itself.
 *
 * `documentBlobs` and `meta` are deliberately absent. Blobs are not in any
 * backup yet — see `backup/snapshot.ts` — and `meta` is device-local state
 * that is never exported; both are handled explicitly by the code that needs
 * them, which is the point of them not being in this list.
 */
export const RECORD_TABLES = {
  horses: db.horses,
  posts: db.posts,
  documents: db.documents,
  documentFolders: db.documentFolders,
  rationItems: db.rationItems,
  activities: db.activities,
  categories: db.categories,
  profiles: db.profiles,
} as const;

export type RecordTableName = keyof typeof RECORD_TABLES;

/** `RECORD_TABLES`' names, as the one list everything iterating them reads. */
export const RECORD_TABLE_NAMES = Object.keys(
  RECORD_TABLES,
) as RecordTableName[];

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

// There is deliberately no `clearAllTables()`. The one whole-database wipe is
// `importBackup`'s, inside the transaction that writes the file back, so
// nothing can empty the database without refilling it.
