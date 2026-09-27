import type { BackupTables } from "./db.ts";

/**
 * What each schema bump does to stored rows, declared once and read by both
 * paths — the device upgrade in `db.ts` and a backup file's walk in
 * `backup/migrate.ts` — so a phone that upgrades and a file that is restored
 * land on the same row, and a bump cannot handle one and forget the other.
 *
 * Its own module rather than `backup/migrate.ts`, which imports `db.ts`.
 */

/** One row of one table, from one version to the next. */
export type RowStep = (row: Record<string, unknown>) => Record<string, unknown>;

/**
 * A v13 horse row (`name`) at v14 (`firstName` + `lastName`): the first word
 * is the prénom, the rest the nom, so "Ladympala Coupe Chêne" reads back as
 * "Ladympala" + "Coupe Chêne" and `horseFullName` shows what `name` showed.
 *
 * Leaves `updatedAt` alone: splitting a column is not an edit, and restamping
 * would make an untouched row look touched to `clearUntouchedSeedData` and to
 * the restore's last-write-wins merge.
 *
 * A row without a string `name` is returned as it is — already migrated, so a
 * second run changes nothing, or malformed, and then missing `firstName` is
 * what makes `assertRows` refuse the file.
 */
export const horseRowToV14 = (
  row: Record<string, unknown>,
): Record<string, unknown> => {
  const { name, ...rest } = row;
  if (typeof name !== "string") return row;
  const [firstName, ...others] = name.trim().split(/\s+/);
  return {
    ...rest,
    firstName,
    lastName: others.length > 0 ? others.join(" ") : null,
  };
};

/**
 * Keyed by the version each step migrates *from*, then by table. A table a
 * version leaves alone is not listed.
 *
 * **The contract a row step keeps:** it is pure; it is **replay-safe** — a row
 * already in the new shape passes through unchanged, so a file half-migrated
 * by another build converges rather than double-applying; it never drops a
 * key it does not recognise; and it leaves `updatedAt` alone. Give each one a
 * test that runs it twice.
 */
export const ROW_STEPS: Partial<
  Record<number, Partial<Record<keyof BackupTables, RowStep>>>
> = {
  13: { horses: horseRowToV14 },
};
