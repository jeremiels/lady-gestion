import {
  RECORD_TABLES,
  SCHEMA_VERSION,
  db,
  type BackupTables,
  type RecordTableName,
} from "../db.ts";
import { nowISO, type IsoTimestamp } from "../dates.ts";
import { newerOf } from "../record.ts";
import { getOwnerId, setOwnerId } from "../owner.ts";
import * as metaRepo from "../repositories/meta.repo.ts";
import { clearUntouchedSeedData, reconcileCategories } from "../seed.ts";
import { migrateTables } from "./migrate.ts";
import type { BaseRecord, Category } from "../types.ts";

/**
 * Whole-database snapshot, used today for manual file export/import and
 * later as the payload pushed to Google Drive's hidden appDataFolder.
 *
 * The envelope carries `schemaVersion` so a restore can tell what shape it is
 * reading. Records keep their original UUIDs, so importing a snapshot into a
 * database that already has data merges rather than duplicates.
 *
 * Document *bytes* are not included — only metadata. Embedding scanned PDFs as
 * base64 would bloat the file by a third and make every backup a full
 * re-upload. Files travel separately, alongside the snapshot, once Drive
 * backup lands.
 */

export type BackupSnapshot = {
  app: "lady-gestion";
  schemaVersion: number;
  exportedAt: IsoTimestamp;
  ownerId: string;
  /** Derived from `RECORD_TABLES`, so a new table lands here without an edit. */
  tables: BackupTables;
};

/** The tables a snapshot carries. One list, read by everything below. */
const TABLE_NAMES = Object.keys(RECORD_TABLES) as RecordTableName[];

export type ImportResult = {
  imported: number;
  skipped: number;
};

/** Reads every table, including soft-deleted rows — tombstones must survive. */
export const exportBackup = async (): Promise<BackupSnapshot> => {
  const rows = await Promise.all(
    TABLE_NAMES.map((name) => RECORD_TABLES[name].toArray()),
  );

  return {
    app: "lady-gestion",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowISO(),
    ownerId: getOwnerId(),
    tables: Object.fromEntries(
      TABLE_NAMES.map((name, index) => [name, rows[index]]),
    ) as BackupTables,
  };
};

/**
 * Whether a local row counts as absent against the file's copy of it: a row
 * this device *seeded* and the user has never touched, when the file holds a
 * different version of it.
 *
 * Two tables seed rows independently on every install — the built-in
 * categories (`reconcileCategories`) and the profile (`seedProfileIfEmpty`),
 * both in `seed.ts`. On a new phone those stamps are newer than every edit in
 * the backup, so plain last-write-wins kept the fresh seed: a category switched
 * off came back on, the restored profile was shadowed by the placeholder, and
 * every seeded row stayed under the new install's owner while the rest of the
 * database adopted the file's. **An install is not a choice, and must not
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
  // The profile has no equivalent flag: the only row `seedProfileIfEmpty`
  // ever writes is the seeded one, and the moment the user edits it on the
  // Personnaliser page `touch` moves `updatedAt` and this stops applying.
  profiles: untouchedSeed,
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
  const tables = migrateTables(
    envelope.tables as unknown as Record<string, unknown[]>,
    envelope.schemaVersion,
  );
  assertRows(tables);
  const backup: BackupSnapshot = {
    ...envelope,
    schemaVersion: SCHEMA_VERSION,
    tables,
  };

  // Everything from here is **one transaction**.
  //
  // It used to be five — `clearUntouchedSeedData`, the merge, `setOwnerId`,
  // `reconcileCategories` and `markBackedUp`, each opening its own — and a
  // failure between any two left the database in a state nothing could report
  // or repair: the demo horse deleted, some rows merged, the owner not
  // adopted. For an app whose only copy of the user's data is this database,
  // a restore has to be all-or-nothing. `documentBlobs` and `meta` are in
  // scope so the seed purge and the two meta writes join rather than open
  // their own; Dexie makes a nested `db.transaction` over a subset reuse this
  // one.
  //
  // The counters live inside the callback on purpose: Dexie may retry a
  // transaction, and outer-scope counters would keep the tally from the
  // abandoned attempt on top of the successful one.
  const result = await db.transaction(
    "rw",
    [
      ...TABLE_NAMES.map((name) => RECORD_TABLES[name]),
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
      ) => {
        for (const row of rows) {
          const existing = await table.get(row.id);
          const local =
            existing && yields?.(existing, row) ? undefined : existing;
          if (newerOf(local, row) === row) {
            await table.put(row);
            imported += 1;
          } else {
            skipped += 1;
          }
        }
      };

      for (const name of TABLE_NAMES) {
        await merge<BaseRecord>(
          RECORD_TABLES[name],
          backup.tables[name],
          YIELDS_TO_FILE[name],
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

      await metaRepo.markBackedUp();

      return { imported, skipped };
    },
  );

  // Only now, with the transaction committed, does the in-memory owner catch
  // up with the row written inside it. A re-put of the value already there,
  // for the one line of it that is not in the database.
  if (backup.ownerId) await setOwnerId(backup.ownerId);

  return result;
};

/**
 * How long the object URL is kept alive after the click. Revoking in the same
 * tick races the browser starting the download — the failure is a silently
 * empty or missing file, on the one action the user is relying on to not lose
 * their data.
 */
const REVOKE_DELAY_MS = 1_000;

/** Triggers a file download of the current snapshot. */
export const downloadBackup = async (): Promise<void> => {
  const snapshot = await exportBackup();
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);

  // The anchor has to be in the document: Firefox ignores `click()` on a
  // detached one, so the export appears to do nothing at all.
  const link = document.createElement("a");
  link.href = url;
  const exportedAt = new Date(snapshot.exportedAt);
  const timestamp = [
    exportedAt.getFullYear(),
    exportedAt.getMonth() + 1,
    exportedAt.getDate(),
    exportedAt.getHours(),
    exportedAt.getMinutes(),
    exportedAt.getSeconds(),
  ]
    .map((part) => `${part}`.padStart(2, "0"))
    .join("-");
  link.download = `lady-gestion-${timestamp}.json`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
  await metaRepo.markBackedUp();
};

/** Parses a user-picked `.json` file and merges it. */
export const readBackupFile = async (file: File): Promise<ImportResult> =>
  importBackup(JSON.parse(await file.text()));

/**
 * The two fields the merge actually reads. A row missing either would be
 * written to IndexedDB as an unaddressable or unresolvable record.
 *
 * Checked on the file as it arrives, before any migration, because these two
 * are the only fields whose name and meaning have never changed. Everything
 * else is checked after migration by `assertRows` — a pre-v13 file spells
 * `categoryKey` as `type`, so validating today's names against yesterday's
 * file would reject exactly the files the migration exists to rescue.
 */
const isMergeableRow = (row: unknown): boolean =>
  typeof row === "object" &&
  row !== null &&
  typeof (row as Partial<BaseRecord>).id === "string" &&
  typeof (row as Partial<BaseRecord>).updatedAt === "string";

const isString = (value: unknown): boolean => typeof value === "string";
const isNumber = (value: unknown): boolean =>
  typeof value === "number" && Number.isFinite(value);
const isBoolean = (value: unknown): boolean => typeof value === "boolean";
const isArray = (value: unknown): boolean => Array.isArray(value);
const nullable =
  (check: (value: unknown) => boolean) =>
  (value: unknown): boolean =>
    value === null || check(value);

/**
 * `Post.customFields`, as a shape and nothing more.
 *
 * **Keys are deliberately not checked against the category's `fields`.** The
 * bag is open by design (`types.ts`), and a key no category declares any more
 * is not corruption — it is the user's data, stranded by a built-in that
 * dropped a field. There is one in the live database right now: two `cures`
 * posts carry a `duration` from a definition that predates
 * `courseFields()`. Validating keys would refuse that file on restore, which
 * is the precise opposite of what this function is for.
 *
 * What *is* checked is that every value survives a JSON round trip as a
 * scalar, because that is the promise `CustomFieldDef` makes to the backup
 * format, and a nested object here would come back from a file as something
 * no read path expects.
 */
const isScalarBag = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (entry) =>
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean",
  );
};

/**
 * What each table's rows must carry, beyond `id` and `updatedAt`.
 *
 * Only fields a read path would actually break on — this is a guard against a
 * corrupt or hand-edited file, not a schema re-declaration. Anything absent
 * from this table is passed through untouched, which is what keeps a field
 * added by a future build from making today's validator reject it.
 *
 * Derived from `RECORD_TABLES`' key set, so a table added there without a rule
 * here is a type error rather than a table that silently skips validation.
 */
const ROW_RULES: Record<
  RecordTableName,
  Record<string, (value: unknown) => boolean>
> = {
  horses: { name: isString, sex: isString },
  posts: {
    horseId: isString,
    categoryKey: isString,
    title: isString,
    date: isString,
    status: isString,
    currency: isString,
    time: nullable(isString),
    notes: nullable(isString),
    location: nullable(isString),
    customFields: isScalarBag,
  },
  documents: {
    horseId: isString,
    name: isString,
    mimeType: isString,
    size: isNumber,
    category: isString,
    postId: nullable(isString),
  },
  rationItems: {
    horseId: isString,
    label: isString,
    quantity: isNumber,
    unit: isString,
  },
  activities: { horseId: isString, label: isString },
  categories: {
    key: isString,
    label: isString,
    enabled: isBoolean,
    order: isNumber,
    fields: isArray,
    parentId: nullable(isString),
    isBuiltIn: isBoolean,
  },
  profiles: { firstName: isString, email: isString },
};

/**
 * Per-table validation, on the migrated tables — i.e. on today's field names.
 *
 * Everything here goes straight into IndexedDB, where a bad row is permanent
 * and a `TypeError` at render is the first anyone hears of it. Validating at
 * the boundary is what lets the defensive guards further in — `resolveCatalogue`
 * for an unknown icon or theme, `THEME_KEYS` for a theme string — stay
 * belt-and-braces rather than the only thing standing between a hand-edited
 * file and a view that throws.
 *
 * A row is named by table and `id` in the message, because "la table posts
 * contient des enregistrements invalides" over 124 rows is not something a
 * user, or the person helping them, can act on.
 */
const assertRows = (tables: BackupTables): void => {
  for (const name of TABLE_NAMES) {
    const rules = ROW_RULES[name];
    for (const row of tables[name]) {
      const record = row as unknown as Record<string, unknown>;
      for (const [field, check] of Object.entries(rules)) {
        if (!check(record[field])) {
          throw new Error(
            `Sauvegarde illisible : la table « ${name} » contient un enregistrement invalide (${String(record.id)}, champ « ${field} »).`,
          );
        }
      }
    }
  }
};

/**
 * The envelope, and the one per-row check that predates every rename.
 *
 * Returns the file as it was written — **not** migrated. `importBackup` runs
 * `migrateTables` next and then `assertRows`; see `isMergeableRow` for why the
 * validation is split either side of that.
 */
const assertSnapshot = (value: unknown): BackupSnapshot => {
  const snapshot = value as Partial<BackupSnapshot> | null;

  if (!snapshot || snapshot.app !== "lady-gestion") {
    throw new Error("Ce fichier n'est pas une sauvegarde Ladympala.cc.");
  }

  if (typeof snapshot.schemaVersion !== "number" || !snapshot.tables) {
    throw new Error("Sauvegarde illisible : en-tête manquant.");
  }

  // A newer file may contain fields this build does not understand; writing
  // it would silently drop them on the next export.
  if (snapshot.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `Sauvegarde créée par une version plus récente de l'application (schéma ${snapshot.schemaVersion} > ${SCHEMA_VERSION}).`,
    );
  }

  // How *old* a file may be is `migrate.ts`'s call, not this one's: it knows
  // which versions it has a step for. This function's job is only to be sure
  // there is something coherent to hand it.
  const tables = snapshot.tables as Record<string, unknown>;

  for (const name of TABLE_NAMES) {
    const rows = tables[name];

    // A table introduced by a later schema is simply absent from an older
    // file, and that is not corruption — the migration step that introduces it
    // is what supplies it. Only a file already at the current version is
    // required to carry every table. Without this, adding a table to
    // `RECORD_TABLES` silently makes every backup ever exported unrestorable,
    // on the one feature that exists to stop data being lost.
    if (rows === undefined && snapshot.schemaVersion < SCHEMA_VERSION) continue;

    if (!Array.isArray(rows)) {
      throw new Error(
        `Sauvegarde illisible : la table « ${name} » est absente ou corrompue.`,
      );
    }

    if (!rows.every(isMergeableRow)) {
      throw new Error(
        `Sauvegarde illisible : la table « ${name} » contient des enregistrements invalides.`,
      );
    }
  }

  return snapshot as BackupSnapshot;
};
