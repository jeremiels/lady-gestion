import type { BackupTables } from "../db.ts";
import type { IsoTimestamp } from "../dates.ts";

/**
 * Whole-database snapshot: the file a manual export writes and a restore
 * reads, and the one `src/drive/backup.ts` puts in her Drive once a day.
 *
 * The envelope carries `schemaVersion`, and a restore reads a file at this
 * build's version only (`checkBackup`). It replaces the database with the
 * file (`importBackup`, `restore.ts`).
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
