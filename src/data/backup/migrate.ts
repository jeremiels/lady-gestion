import { SCHEMA_VERSION } from "../db.ts";
import { horseRowToV14 } from "../migrations.ts";

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
 * stays restorable after it, because `STEPS` turns it into the current shape
 * one version at a time. Nothing below v13 is supported — no such file is
 * known to exist, and the device that exports them has never been older.
 *
 * **The contract a step keeps:**
 *
 * - It is a pure function over the plain object. No database, nothing that can
 *   fail partway and leave half a file behind.
 * - It is **replay-safe**: a row already in the new shape passes through
 *   unchanged, so a file half-migrated by another build converges rather than
 *   double-applying.
 * - It never drops a key it does not recognise. `customFields` is an open bag
 *   (`types.ts`), and a value the current build has no field for is still the
 *   user's data — see `assertRows` in `snapshot.ts`.
 *
 * **Adding a step:** write it against the tables as the previous version left
 * them, register it under that version, and give it a test that runs it twice
 * and asserts the second run changes nothing.
 */

/**
 * The tables mid-walk. `BackupTables` states the *finished* shape, which a file
 * partway between two versions does not have — `assertRows` (`snapshot.ts`)
 * narrows to it once the walk is done. Every row is an object: `assertSnapshot`
 * checked that before any step runs. A table may be absent — one a later
 * schema introduces is missing from an older file until the step that
 * introduces it supplies it — and a step leaves an absent table absent, for
 * `assertRows` to refuse.
 */
export type MigratingTables = Partial<
  Record<string, Record<string, unknown>[]>
>;

/** Takes the tables at version `n`, returns them at version `n + 1`. */
type MigrationStep = (tables: MigratingTables) => MigratingTables;

/** Keyed by the version each step migrates *from*. */
const STEPS: Partial<Record<number, MigrationStep>> = {
  // `Horse.name` split into `firstName` + `lastName` — the same row the device
  // upgrade in `db.ts` writes.
  13: (tables) => ({
    ...tables,
    horses: tables.horses?.map(horseRowToV14),
  }),
};

/**
 * Walks `from` up to `SCHEMA_VERSION`, one registered step at a time.
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
    const step = STEPS[version];
    if (!step) {
      throw new Error(
        `Sauvegarde créée par une version trop ancienne de l'application (schéma ${from} < ${SCHEMA_VERSION}).`,
      );
    }
    current = step(current);
  }

  return current;
};
