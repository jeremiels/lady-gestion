import {
  RECORD_TABLES,
  RECORD_TABLE_NAMES,
  SCHEMA_VERSION,
  db,
  type BackupTables,
  type RecordTableName,
} from "../db.ts";
import type { IsoTimestamp } from "../dates.ts";
import { newerOf } from "../record.ts";
import { setOwnerId } from "../owner.ts";
import { clearUntouchedSeedData, reconcileCategories } from "../seed.ts";
import { migrateTables, type MigratingTables } from "./migrate.ts";
import { assertRows, assertSnapshot } from "./validate.ts";
import type {
  BaseRecord,
  Category,
  DocumentFolder,
  StoredDocument,
} from "../types.ts";

/**
 * Whole-database snapshot, used today for manual file export/import and
 * later as the payload pushed to Google Drive's hidden appDataFolder.
 *
 * The envelope carries `schemaVersion` so a restore can tell what shape it is
 * reading. Records keep their original UUIDs, so importing a snapshot into a
 * database that already has data merges rather than duplicates.
 *
 * Document *bytes* are not included — only metadata. A document in her Drive
 * gets them back from there once the sync mirrors its restored row again
 * (`src/drive/sync.ts`); one joined in the app and not yet uploaded when the
 * backup was made comes back as a row with no file. Embedding scanned PDFs as
 * base64 would bloat the file by a third and make every backup a full
 * re-upload.
 */

export type BackupSnapshot = {
  app: "lady-gestion";
  schemaVersion: number;
  exportedAt: IsoTimestamp;
  ownerId: string;
  /** Derived from `RECORD_TABLES`, so a new table lands here without an edit. */
  tables: BackupTables;
};

export type ImportResult = {
  imported: number;
  skipped: number;
};

/**
 * Whether a local row counts as absent against the file's copy of it: a row
 * this device *seeded* and the user has never touched, when the file holds a
 * different version of it.
 *
 * The built-in categories (`reconcileCategories` in `seed.ts`) are seeded
 * independently on every install. On a new phone those stamps are newer than
 * every edit in the backup, so plain last-write-wins kept the fresh seed: a
 * category switched off came back on, and every seeded row stayed under the
 * new install's owner while the rest of the database adopted the file's. **An install is not a choice, and must not
 * outvote one.**
 *
 * "Never touched" is `createdAt === updatedAt`, the same test
 * `clearUntouchedSeedData` reads: every user write goes through `touch` or
 * `softDelete`, and seeding leaves `updatedAt` equal to `createdAt`. A row at
 * the same version — a device's own backup restored onto itself — is still
 * skipped, so the counts do not report rows restored where nothing changed.
 *
 * Stated per table rather than as one `name === "categories"` branch inside the
 * merge, so adding a table that seeds itself means adding a rule here rather
 * than remembering to widen a condition somewhere else.
 */
const untouchedSeed = (local: BaseRecord, incoming: BaseRecord): boolean =>
  local.createdAt === local.updatedAt &&
  (local.updatedAt !== incoming.updatedAt ||
    local.ownerId !== incoming.ownerId);

const YIELDS_TO_FILE: Partial<
  Record<RecordTableName, (local: BaseRecord, incoming: BaseRecord) => boolean>
> = {
  // Only a *built-in* category is ours to overwrite; one the user created is
  // theirs, and is merged on its stamps like any other row.
  categories: (local, incoming) =>
    (local as Category).isBuiltIn && untouchedSeed(local, incoming),
};

/**
 * A document or folder of her Drive as a restore writes it: in step with the
 * Drive. A change the exporting device had not sent yet — a rename, a
 * deletion — is not replayed: a restore never writes to her Drive, and the
 * next walk shows what the Drive says now. A row never sent at all keeps its
 * state, and a folder she made in the app is still created there.
 */
const inStepWithDrive = (row: BaseRecord): BaseRecord => {
  const drive = row as DocumentFolder | StoredDocument;
  if (drive.driveSyncedAt === null) return row;
  const restored: DocumentFolder | StoredDocument = {
    ...drive,
    driveSyncedAt: drive.updatedAt,
  };
  return restored;
};

const AS_RESTORED: Partial<
  Record<RecordTableName, (row: BaseRecord) => BaseRecord>
> = {
  documents: inStepWithDrive,
  documentFolders: inStepWithDrive,
};

/**
 * Merges a snapshot into the local database, last-write-wins per record.
 *
 * Restoring a three-week-old backup must not throw away edits made since, so
 * each incoming row is only written when its `updatedAt` is newer than the
 * local copy's. That also makes import safe to run twice. The one exception is
 * a built-in category this device never edited, which the file's copy replaces
 * whatever the stamps say — see `yieldsToFile`.
 */
export const importBackup = async (
  snapshot: unknown,
): Promise<ImportResult> => {
  const envelope = assertSnapshot(snapshot);
  // Migrate first, validate the rows second: the tables only have today's
  // field names once `migrateTables` has run.
  const tables = assertRows(
    migrateTables(
      envelope.tables as unknown as MigratingTables,
      envelope.schemaVersion,
    ),
  );
  const backup: BackupSnapshot = {
    ...envelope,
    schemaVersion: SCHEMA_VERSION,
    tables,
  };

  // Everything from here is **one transaction**: a failure part-way would
  // leave the demo horse deleted, some rows merged and the owner not adopted,
  // and for an app whose only copy of the user's data is this database a
  // restore has to be all-or-nothing. `documentBlobs` and `meta` are in scope
  // so the seed purge and the owner write join rather than open their own;
  // Dexie makes a nested `db.transaction` over a subset reuse this one.
  //
  // `lastBackupAt` is deliberately not stamped. Restoring reads a file rather
  // than writing one, and the merge keeps local edits newer than the file —
  // edits no file holds. Only `downloadBackup` makes the data safe.
  //
  // The counters live inside the callback on purpose: Dexie may retry a
  // transaction, and outer-scope counters would keep the tally from the
  // abandoned attempt on top of the successful one.
  const result = await db.transaction(
    "rw",
    [
      ...RECORD_TABLE_NAMES.map((name) => RECORD_TABLES[name]),
      db.documentBlobs,
      db.meta,
    ],
    async () => {
      let imported = 0;
      let skipped = 0;

      // A restore almost always happens on a fresh install, where the
      // first-run seed has just written a demo horse. Clear it first or the
      // user ends up with two.
      await clearUntouchedSeedData();

      const merge = async <T extends BaseRecord>(
        table: {
          get(id: string): Promise<T | undefined>;
          put(row: T): Promise<unknown>;
        },
        rows: T[],
        yields?: (local: T, incoming: T) => boolean,
        asRestored: (row: T) => T = (row) => row,
      ) => {
        for (const row of rows) {
          const existing = await table.get(row.id);
          const local =
            existing && yields?.(existing, row) ? undefined : existing;
          if (newerOf(local, row) === row) {
            await table.put(asRestored(row));
            imported += 1;
          } else {
            skipped += 1;
          }
        }
      };

      for (const name of RECORD_TABLE_NAMES) {
        await merge<BaseRecord>(
          RECORD_TABLES[name],
          backup.tables[name],
          YIELDS_TO_FILE[name],
          AS_RESTORED[name],
        );
      }

      // The restored rows carry the exporting device's `ownerId`. Adopt it,
      // or the database ends up split between two owners — old rows under
      // the snapshot's, anything created afterwards under this install's.
      // Invisible today; a data integrity bug the day these rows reach a
      // server.
      //
      // The *row* is written here so it commits or rolls back with everything
      // else. The module-level cache in `owner.ts` is deliberately not touched
      // until after the commit: it is the one piece of state a rollback could
      // not undo, and a failed restore must not leave the session stamping new
      // records with an owner the database never adopted.
      if (backup.ownerId) {
        await db.meta.put({ key: "ownerId", value: backup.ownerId });
      }

      // A built-in the file won carries its label, icon and fields as the
      // build that exported it shipped them. Reconciling writes this build's
      // back over them now — keeping what the file decided: owner, stamps,
      // `enabled` — rather than leaving an older form in place until the next
      // launch. Handed the file's owner explicitly, because the cache above
      // has deliberately not adopted it yet and a built-in this device lacks
      // entirely has to be stamped with the owner the rest of the restore
      // just used.
      await reconcileCategories(backup.ownerId || undefined);

      return { imported, skipped };
    },
  );

  // Only now, with the transaction committed, does the in-memory owner catch
  // up with the row written inside it. A re-put of the value already there,
  // for the one line of it that is not in the database.
  if (backup.ownerId) await setOwnerId(backup.ownerId);

  return result;
};
