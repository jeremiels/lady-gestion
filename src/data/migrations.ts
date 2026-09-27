/**
 * Row transforms between schema versions, shared by the device upgrade in
 * `db.ts` and a backup file's step in `backup/migrate.ts`, so a phone that
 * upgrades and a file that is restored land on the same row.
 *
 * Its own module rather than `backup/migrate.ts`, which imports `db.ts`.
 */

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
