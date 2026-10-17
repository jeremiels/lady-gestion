import {
  RECORD_TABLES,
  RECORD_TABLE_NAMES,
  db,
  type RecordTableName,
} from "../db.ts";
import { UserFacingError } from "../errors.ts";
import { setOwnerId } from "../owner.ts";
import { isLive } from "../record.ts";
import * as metaRepo from "../repositories/meta.repo.ts";
import { isFirstRun } from "../seed.ts";
import type {
  BaseRecord,
  DocumentFolder,
  MetaKey,
  StoredDocument,
} from "../types.ts";
import { exportBackup } from "./export.ts";
import { deliverBackup, type ExportOutcome } from "./file.ts";
import type { BackupSnapshot } from "./snapshot.ts";
import { checkBackup, type CheckedBackup } from "./validate.ts";

/**
 * A picked file read as a backup, and what replacing this device's data with
 * it would take away: what "Restaurer un fichier" asks about, and what
 * `runRestore` carries out.
 */
export type RestorePlan = {
  backup: CheckedBackup;
  /**
   * The copy handed over before the replace: everything on the device, or
   * `null` when it holds only what a first run writes (`isFirstRun`) — a
   * fresh install, where asking for a copy first would only be in the way.
   */
  copy: BackupSnapshot | null;
  /**
   * Files joined on this device, not in her Drive yet, that the file does not
   * bring back. Their bytes are here and nowhere else, and no backup file
   * carries bytes, so no copy keeps them.
   */
  unsentFiles: number;
};

/**
 * Reads a user-picked `.json` file as a backup and works out what restoring
 * it would take away, writing nothing.
 *
 * The copy is read now, so it is ready before the tap that confirms the
 * restore (`runRestore`).
 */
export const planRestore = async (file: File): Promise<RestorePlan> => {
  const backup = await readBackupFile(file);
  const [current, seedIds] = await Promise.all([
    exportBackup(),
    metaRepo.get<string[]>("seedRecordIds"),
  ]);

  const back = liveDocumentIds(backup.tables.documents);
  const unsent = current.tables.documents.filter(
    (doc) => isLive(doc) && doc.driveFileId === null && !back.has(doc.id),
  );
  const bytes = await db.documentBlobs.bulkGet(unsent.map((doc) => doc.id));

  return {
    backup,
    copy: isFirstRun(current.tables, seedIds) ? null : current,
    unsentFiles: bytes.filter((blob) => blob !== undefined).length,
  };
};

/**
 * How a restore ended: stopped because the copy was dismissed, or the data
 * replaced — with what became of the copy (`null`: none was needed) and how
 * many live rows the file brought back. Its tombstones are restored too, and
 * not counted: nothing in the app shows them.
 */
export type RestoreOutcome =
  | "cancelled"
  | { copy: Exclude<ExportOutcome, "cancelled"> | null; restored: number };

/**
 * Carries out `plan`: hands over its copy, when there is one, and replaces
 * the data with the file (`importBackup`) only once the copy went somewhere.
 * A share sheet dismissed, or one that refuses the file, stops the restore
 * with nothing written — only a device with no share sheet gets a download
 * instead — so nothing of hers is thrown away unless a file of it was handed
 * over, save the `unsentFiles` the confirmation warned about.
 *
 * Call it straight from the tap that confirms. Nothing is awaited before the
 * share sheet opens, which needs that tap's activation, and reading the
 * database first can outlast it — hence the copy `planRestore` read. From
 * then until the replace, the confirmation and the share sheet hold the
 * screen: the only writes left are the Drive sync's, and what it writes
 * mirrors her Drive.
 */
export const runRestore = async (
  plan: RestorePlan,
): Promise<RestoreOutcome> => {
  const copy = plan.copy && (await deliverBackup(plan.copy));
  if (copy === "cancelled") return "cancelled";
  if (copy === "failed") {
    throw new UserFacingError(
      "La copie des données actuelles n’a pas pu être exportée : rien n’a été remplacé.",
    );
  }

  await importBackup(plan.backup);
  return {
    copy,
    restored: Object.values(plan.backup.tables).flat().filter(isLive).length,
  };
};

/**
 * Replaces this device's data with a snapshot, so the app is exactly the file
 * and nothing else: every record table holds the file's rows, tombstones
 * included, and nothing it held before.
 *
 * `meta` keeps only this device's connection (`KEPT_THROUGH_RESTORE`) and
 * takes what the file says: its owner, and its date as the last backup — the
 * data here is now that file's. The bytes kept are those of the documents the
 * file brings back, so the Drive need not send them again.
 *
 * What this throws away is the caller's to keep first: `runRestore` hands
 * over a copy before it calls this.
 */
export const importBackup = async (backup: CheckedBackup): Promise<void> => {
  // Everything here is **one transaction**: a failure part-way would leave
  // tables emptied and others not yet written, and for an app whose only copy
  // of the user's data is this database a restore has to be all-or-nothing.
  // `documentBlobs` and `meta` are in scope beside the record tables for the
  // sweep and the writes below.
  const scope = [
    ...RECORD_TABLE_NAMES.map((name) => RECORD_TABLES[name]),
    db.documentBlobs,
    db.meta,
  ];
  await db.transaction("rw", scope, async () => {
    for (const name of RECORD_TABLE_NAMES) {
      const rows: readonly BaseRecord[] = backup.tables[name];
      const table: Replaceable = RECORD_TABLES[name];
      await table.clear();
      await table.bulkPut(rows.map(AS_RESTORED[name] ?? ((row) => row)));
    }

    // Bytes no restored document points at could never be reached again.
    const kept = liveDocumentIds(backup.tables.documents);
    await db.documentBlobs
      .filter((blob) => !kept.has(blob.documentId))
      .delete();

    // With no `activeHorseId`, `getActive()` shows the file's first live,
    // unarchived horse. With no `horseCover` and no `driveBackup`, the next
    // Drive backup pass fetches that horse's cover from her backup folder.
    await db.meta.filter((entry) => !KEPT_THROUGH_RESTORE[entry.key]).delete();

    // The restored rows carry the exporting device's `ownerId`. Adopt it, or
    // anything created afterwards lands under this install's owner while the
    // rest carries the file's. Invisible today; a data integrity bug the day
    // these rows reach a server.
    //
    // The *row* is written here so it commits or rolls back with everything
    // else. The module-level cache in `owner.ts` is deliberately not touched
    // until after the commit: it is the one piece of state a rollback could
    // not undo, and a failed restore must not leave the session stamping new
    // records with an owner the database never adopted.
    await db.meta.bulkPut([
      { key: "ownerId", value: backup.ownerId },
      { key: "lastBackupAt", value: backup.exportedAt },
    ]);
  });

  // Only now, with the transaction committed, does the in-memory owner catch
  // up with the row written inside it. A re-put of the value already there,
  // for the one line of it that is not in the database.
  await setOwnerId(backup.ownerId);
};

/** Parses a user-picked `.json` file and reads it as a backup. */
const readBackupFile = async (file: File): Promise<CheckedBackup> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new UserFacingError("Ce fichier n'est pas une sauvegarde lisible.");
  }
  return checkBackup(parsed);
};

/**
 * Ids of the documents a file brings back undeleted: the ones whose bytes a
 * restore keeps, and so the ones `planRestore` does not count as lost.
 */
const liveDocumentIds = (documents: readonly StoredDocument[]): Set<string> =>
  new Set(documents.filter(isLive).map((doc) => doc.id));

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
 * What `meta` keeps through a restore: this device's connection to her Drive
 * and its notification switch, never anything the file should say. Every key
 * is decided here, so a new one does not compile until it is.
 */
const KEPT_THROUGH_RESTORE: Record<MetaKey, boolean> = {
  googleAccount: true,
  driveClaim: true,
  driveFolder: true,
  driveSyncProblem: true,
  notificationsEnabled: true,
  // Written from the file by `importBackup`.
  ownerId: false,
  lastBackupAt: false,
  activeHorseId: false,
  driveBackup: false,
  horseCover: false,
  attachmentFolderId: false,
  seededAt: false,
  seedRecordIds: false,
};

/**
 * The slice of a record table a restore writes through. Methods rather than
 * function-typed properties: TypeScript lets a method take a narrower
 * parameter than the type declares, so each table of `RECORD_TABLES` — a
 * `Table<Post>` takes only posts — is one as it stands, with no cast.
 */
type Replaceable = {
  clear(): Promise<void>;
  bulkPut(rows: readonly BaseRecord[]): Promise<unknown>;
};
