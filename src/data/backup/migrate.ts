import { SCHEMA_VERSION, type BackupTables } from "../db.ts";

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
 * The problem this solves is **forward**, not backward. Every backup exported
 * today is at v13. The day `SCHEMA_VERSION` becomes 14, every one of them stops
 * being restorable unless something turns a v13 file into a v14 one. That
 * something is `STEPS` below, and it is empty on purpose: there is nothing to
 * migrate *from* yet, and the seam is here so the next bump is a step plus a
 * test rather than a rewrite under time pressure with the user's only copy of
 * her data on the line.
 *
 * Going the other way is not a goal. No file below v13 is known to exist, the
 * device that exports them has never been on an older version, and it cannot
 * go back. `a58b66d` deleted a v1 -> v13 chain along with the device chain; if
 * a genuinely old file ever turns up, recover those steps from git rather than
 * rewriting them — they were tested, and `snapshot.v13.test.ts` at that commit
 * is the fixture.
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
 * **Adding a step, when `SCHEMA_VERSION` becomes 14:** write it against
 * `BackupTables` as it is today, register it under `13`, and give it a test
 * that runs it twice and asserts the second run changes nothing.
 */

/**
 * The tables mid-walk. `BackupTables` states the *finished* shape, which a file
 * partway between two versions does not have — narrowed once, at the end.
 */
type MigratingTables = Record<string, unknown[]>;

/** Takes the tables at version `n`, returns them at version `n + 1`. */
type MigrationStep = (tables: MigratingTables) => MigratingTables;

/** Keyed by the version each step migrates *from*. Empty until the first bump. */
const STEPS: Partial<Record<number, MigrationStep>> = {
  // 13: migrateV13toV14 — add here, with the version bump in `db.ts`.
};

/**
 * Walks `from` up to `SCHEMA_VERSION`, one registered step at a time.
 *
 * A file already at the current version — every file that exists today — is
 * returned untouched. That is the path that matters, and it must stay free of
 * any transformation at all.
 */
export const migrateTables = (
  tables: MigratingTables,
  from: number,
): BackupTables => {
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

  return current as unknown as BackupTables;
};
