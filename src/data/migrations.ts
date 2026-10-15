import type { BackupTables } from "./db.ts";

/**
 * What each schema bump does to stored rows, declared once and read by both
 * paths — the device upgrade in `db.ts` and a backup file's walk in
 * `backup/migrate.ts` — so a phone that upgrades and a file that is restored
 * land on the same row, and a bump cannot handle one and forget the other.
 *
 * Its own module rather than `backup/migrate.ts`, which imports `db.ts`.
 */

/**
 * One row of one table, from one version to the next — or `null` to drop the
 * row altogether.
 */
export type RowStep = (
  row: Record<string, unknown>,
) => Record<string, unknown> | null;

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
 * A v14 document row (`category`, a closed union) is dropped at v15, where
 * documents are filed in the user's own Drive folders (`folderId`).
 *
 * Dropped rather than mapped because there is nothing to map it to: no
 * version before v15 had an upload path, so the only document any install
 * holds is the first-run demo PDF, and folders are whatever the user names in
 * her Drive. A backup file never carried the bytes either — a restored
 * document was already a name with no file behind it.
 *
 * A row without `category` is returned as it is: already at v15.
 */
export const documentRowToV15 = (
  row: Record<string, unknown>,
): Record<string, unknown> | null => ("category" in row ? null : row);

/**
 * The roles v16 gives the two fields the app used to find by their `id`: the
 * amount the budget adds up, and the practitioner or merchant the search, the
 * share and the detail card read. A `Map` rather than an object literal, so a
 * field id that happens to name an `Object.prototype` key finds nothing.
 */
const V16_ROLES = new Map([
  ["amountCents", "budget"],
  ["counterparty", "counterparty"],
]);

/**
 * A v15 category row at v16: its `amountCents` and `counterparty` fields carry
 * the role that says what the app does with them (`CustomFieldDef.role`), so
 * the form builder can link any field to the budget or make it the
 * intervenant, whatever its id.
 *
 * Only top-level fields, and only one without a role yet — a field that has
 * one keeps it, so a second run changes nothing. A row whose fields are not an
 * array is returned as it is, for `assertRows` to judge.
 */
export const categoryRowToV16 = (
  row: Record<string, unknown>,
): Record<string, unknown> => {
  const { fields } = row;
  if (!Array.isArray(fields)) return row;

  let changed = false;
  const next = fields.map((field: unknown) => {
    if (typeof field !== "object" || field === null) return field;
    const { id, role } = field as { id?: unknown; role?: unknown };
    const named = typeof id === "string" ? V16_ROLES.get(id) : undefined;
    if (named === undefined || role !== undefined) return field;
    changed = true;
    return { ...field, role: named };
  });
  return changed ? { ...row, fields: next } : row;
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
  14: { documents: documentRowToV15 },
  15: { categories: categoryRowToV16 },
};

/**
 * Tables each version introduces, keyed like `ROW_STEPS`.
 *
 * Only a file needs this: Dexie creates a new store on the device by itself,
 * but a file written before the table existed lacks it, and `assertRows`
 * refuses a file with a table missing. The walk supplies it empty.
 */
export const NEW_TABLES: Partial<Record<number, (keyof BackupTables)[]>> = {
  14: ["documentFolders"],
};
