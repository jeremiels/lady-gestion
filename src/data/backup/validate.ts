import {
  RECORD_TABLE_NAMES,
  SCHEMA_VERSION,
  type RecordTableName,
} from "../db.ts";
import { isIsoDate } from "../dates.ts";
import { UserFacingError } from "../errors.ts";
import { isRationSeason } from "../seasons.ts";
import type { BackupSnapshot } from "./snapshot.ts";

declare const checked: unique symbol;

/**
 * A backup file `checkBackup` has read: what a `RestorePlan` holds and
 * `importBackup` takes, so nothing reaches the database without passing
 * through it. Only `checkBackup` makes one.
 */
export type CheckedBackup = BackupSnapshot & { readonly [checked]: true };

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
 * A currency code `Intl` will format. `formatCents` builds a currency
 * formatter from the stored code, and ECMA-402 throws `RangeError` — from
 * inside a render — for exactly the codes that are not three ASCII letters.
 */
const isCurrency = (value: unknown): boolean =>
  typeof value === "string" && /^[A-Za-z]{3}$/.test(value);

/**
 * What every row carries whatever its table. `id` is the key the restore
 * writes it under. `updatedAt` is what the restore stamps a Drive row's
 * `driveSyncedAt` from, and what `pending` and the profile's newest row
 * compare afterwards. `deletedAt` must be *present*: `isLive` reads
 * `=== null`, so a row without it is neither live nor deleted — written, and
 * never shown anywhere.
 */
const RECORD_RULES: Record<string, (value: unknown) => boolean> = {
  id: isString,
  ownerId: isString,
  createdAt: isString,
  updatedAt: isString,
  deletedAt: nullable(isString),
};

/**
 * What each table's rows must carry, beyond `RECORD_RULES`.
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
  horses: {
    firstName: isString,
    lastName: nullable(isString),
    sex: isString,
  },
  posts: {
    horseId: isString,
    categoryKey: isString,
    title: isString,
    date: isIsoDate,
    status: isString,
    currency: isCurrency,
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
    folderId: nullable(isString),
    postId: nullable(isString),
    issuedAt: nullable(isIsoDate),
  },
  documentFolders: {
    name: isString,
    parentId: nullable(isString),
  },
  rationItems: {
    horseId: isString,
    label: isString,
    quantity: isNumber,
    unit: isString,
    sortOrder: isNumber,
    season: nullable(isRationSeason),
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

/** `RECORD_RULES` and each table's own, merged once. */
const RULES = Object.fromEntries(
  RECORD_TABLE_NAMES.map((name) => [
    name,
    { ...RECORD_RULES, ...ROW_RULES[name] },
  ]),
) as typeof ROW_RULES;

const isRow = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * A backup file as this build reads it: the envelope, then every row of every
 * table. Throws a `UserFacingError` saying what is wrong, and writes nothing,
 * so the restore can ask before it replaces anything.
 *
 * Only a file at this build's `SCHEMA_VERSION` is read — what the automatic
 * backup and the export write. `exportedAt` is part of the header: the
 * restore's confirmation names the file by it, as a date, and `Intl` throws on
 * one `Date` cannot read. So is a non-empty `ownerId`: the restore adopts it,
 * and every row written afterwards carries it — an empty one makes
 * `getOwnerId` throw on the next write, and any other value makes the next
 * backup a file this check refuses.
 *
 * Everything here goes straight into IndexedDB, where a bad row is permanent
 * and a `TypeError` at render is the first anyone hears of it. Checking at the
 * boundary is what lets the defensive guards further in — `resolveCatalogue`
 * for an unknown icon or theme, `THEME_KEYS` for a theme string — stay
 * belt-and-braces rather than the only thing standing between a hand-edited
 * file and a view that throws.
 *
 * A row is named by table and `id` in the message, because "la table posts
 * contient un enregistrement invalide" over 124 rows is not something a user,
 * or the person helping them, can act on.
 */
export const checkBackup = (value: unknown): CheckedBackup => {
  const snapshot = value as Partial<BackupSnapshot> | null;

  if (!snapshot || snapshot.app !== "lady-gestion") {
    throw new UserFacingError(
      "Ce fichier n'est pas une sauvegarde Ladympala.cc.",
    );
  }

  if (
    typeof snapshot.schemaVersion !== "number" ||
    typeof snapshot.exportedAt !== "string" ||
    Number.isNaN(Date.parse(snapshot.exportedAt)) ||
    typeof snapshot.ownerId !== "string" ||
    snapshot.ownerId === "" ||
    !snapshot.tables
  ) {
    throw new UserFacingError("Sauvegarde illisible : en-tête manquant.");
  }

  // A newer file may contain fields this build does not understand; writing
  // it would silently drop them on the next export.
  if (snapshot.schemaVersion > SCHEMA_VERSION) {
    throw new UserFacingError(
      `Sauvegarde créée par une version plus récente de l'application (schéma ${snapshot.schemaVersion} > ${SCHEMA_VERSION}).`,
    );
  }
  if (snapshot.schemaVersion < SCHEMA_VERSION) {
    throw new UserFacingError(
      `Sauvegarde créée par une version trop ancienne de l'application (schéma ${snapshot.schemaVersion} < ${SCHEMA_VERSION}).`,
    );
  }

  const tables = snapshot.tables as Record<string, unknown>;
  for (const name of RECORD_TABLE_NAMES) {
    const rows = tables[name];
    if (!Array.isArray(rows)) {
      throw new UserFacingError(
        `Sauvegarde illisible : la table « ${name} » est absente ou corrompue.`,
      );
    }

    for (const row of rows) {
      if (!isRow(row)) {
        throw new UserFacingError(
          `Sauvegarde illisible : la table « ${name} » contient des enregistrements invalides.`,
        );
      }
      for (const [field, check] of Object.entries(RULES[name])) {
        if (!check(row[field])) {
          throw new UserFacingError(
            `Sauvegarde illisible : la table « ${name} » contient un enregistrement invalide (${String(row.id)}, champ « ${field} »).`,
          );
        }
      }
    }
  }

  // The tables this build has and nothing else: what `BackupTables` promises,
  // and what `importBackup` writes.
  return {
    ...snapshot,
    tables: Object.fromEntries(
      RECORD_TABLE_NAMES.map((name) => [name, tables[name]]),
    ),
  } as CheckedBackup;
};
