import { UserFacingError } from "../errors.ts";
import { SCHEMA_VERSION } from "../db.ts";
import { ROW_STEPS } from "../migrations.ts";

/**
 * Brings an older backup file up to the current schema, in place of the
 * database upgrade an old *file* never goes through.
 *
 * **Why this exists, and what it is not.** `db.ts` declares one version and has
 * no upgrade chain: a device below v13 is unsupported, deliberately. A file is
 * not a device — it is plain JSON, it is the only copy of the user's data that
 * lives outside one phone, and migrating it is a pure function with no
 * IndexedDB and nothing to fail halfway.
 *
 * The problem this solves is **forward**: a file exported before a schema bump
 * stays restorable after it, because the file is walked through `ROW_STEPS`
 * (`migrations.ts`) one version at a time — the same steps a device's own
 * upgrade runs. Nothing below v13 is supported — no such file is
 * known to exist, and the device that exports them has never been older.
 *
 * The walk is a pure function over the plain object: no database, nothing
 * that can fail partway and leave half a file behind. What a step may do to a
 * row is `ROW_STEPS`'s contract.
 */

/**
 * The tables mid-walk. `BackupTables` states the *finished* shape, which a file
 * partway between two versions does not have — `assertRows` (`snapshot.ts`)
 * narrows to it once the walk is done. Every row is an object: `assertSnapshot`
 * checked that before any step runs. A table may be absent, and a step leaves
 * it absent, for `assertRows` to refuse.
 */
export type MigratingTables = Partial<
  Record<string, Record<string, unknown>[]>
>;

/**
 * Walks `from` up to `SCHEMA_VERSION`, one version's `ROW_STEPS` at a time.
 *
 * A file already at the current version is returned untouched, free of any
 * transformation at all.
 */
export const migrateTables = (
  tables: MigratingTables,
  from: number,
): MigratingTables => {
  let current = tables;

  for (let version = from; version < SCHEMA_VERSION; version++) {
    const steps = ROW_STEPS[version];
    if (!steps) {
      throw new UserFacingError(
        `Sauvegarde créée par une version trop ancienne de l'application (schéma ${from} < ${SCHEMA_VERSION}).`,
      );
    }
    const migrated = Object.entries(steps).map(([name, step]) => [
      name,
      current[name]?.map(step),
    ]);
    current = { ...current, ...Object.fromEntries(migrated) };
  }

  return current;
};
