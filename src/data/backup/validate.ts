import {
  RECORD_TABLE_NAMES,
  SCHEMA_VERSION,
  type BackupTables,
  type RecordTableName,
} from "../db.ts";
import { isIsoDate } from "../dates.ts";
import { UserFacingError } from "../errors.ts";
import { isRationSeason } from "../seasons.ts";
import type { MigratingTables } from "./migrate.ts";
import type { BackupSnapshot } from "./snapshot.ts";
import type { BaseRecord } from "../types.ts";

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
 * A currency code `Intl` will format. `formatCents` builds a currency
 * formatter from the stored code, and ECMA-402 throws `RangeError` — from
 * inside a render — for exactly the codes that are not three ASCII letters.
 */
const isCurrency = (value: unknown): boolean =>
  typeof value === "string" && /^[A-Za-z]{3}$/.test(value);

/**
 * What every row carries whatever its table. `deletedAt` must be *present*:
 * `isLive` reads `=== null`, so a row without it is neither live nor
 * deleted — written, and never shown anywhere.
 */
const RECORD_RULES: Record<string, (value: unknown) => boolean> = {
  ownerId: isString,
  createdAt: isString,
  deletedAt: nullable(isString),
};

/**
 * What each table's rows must carry, beyond `id`, `updatedAt` and
 * `RECORD_RULES`.
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
    category: isString,
    postId: nullable(isString),
    issuedAt: nullable(isIsoDate),
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

/**
 * Per-table validation, on the migrated tables — i.e. on today's field names —
 * and the one place that requires every table to be there: presence is a
 * property of the finished shape, which a file only has once migrated.
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
export const assertRows = (tables: MigratingTables): BackupTables => {
  for (const name of RECORD_TABLE_NAMES) {
    const rows = tables[name];
    if (!rows) {
      throw new UserFacingError(
        `Sauvegarde illisible : la table « ${name} » est absente ou corrompue.`,
      );
    }

    const rules = RULES[name];
    for (const record of rows) {
      for (const [field, check] of Object.entries(rules)) {
        if (!check(record[field])) {
          throw new UserFacingError(
            `Sauvegarde illisible : la table « ${name} » contient un enregistrement invalide (${String(record.id)}, champ « ${field} »).`,
          );
        }
      }
    }
  }
  return tables as unknown as BackupTables;
};

/**
 * The envelope, and the one per-row check that predates every rename.
 *
 * Returns the file as it was written — **not** migrated. `importBackup` runs
 * `migrateTables` next and then `assertRows`; see `isMergeableRow` for why the
 * validation is split either side of that.
 */
export const assertSnapshot = (value: unknown): BackupSnapshot => {
  const snapshot = value as Partial<BackupSnapshot> | null;

  if (!snapshot || snapshot.app !== "lady-gestion") {
    throw new UserFacingError(
      "Ce fichier n'est pas une sauvegarde Ladympala.cc.",
    );
  }

  if (typeof snapshot.schemaVersion !== "number" || !snapshot.tables) {
    throw new UserFacingError("Sauvegarde illisible : en-tête manquant.");
  }

  // A newer file may contain fields this build does not understand; writing
  // it would silently drop them on the next export.
  if (snapshot.schemaVersion > SCHEMA_VERSION) {
    throw new UserFacingError(
      `Sauvegarde créée par une version plus récente de l'application (schéma ${snapshot.schemaVersion} > ${SCHEMA_VERSION}).`,
    );
  }

  // How *old* a file may be is `migrate.ts`'s call, not this one's: it knows
  // which versions it has a step for. This function's job is only to be sure
  // there is something coherent to hand it.
  const tables = snapshot.tables as Record<string, unknown>;

  for (const name of RECORD_TABLE_NAMES) {
    const rows = tables[name];

    // Whether a table may be missing is decided on the migrated tables, by
    // `assertRows`: one a later schema introduces is absent from an older file
    // until the step that introduces it supplies it.
    if (rows === undefined) continue;

    if (!Array.isArray(rows)) {
      throw new UserFacingError(
        `Sauvegarde illisible : la table « ${name} » est absente ou corrompue.`,
      );
    }

    if (!rows.every(isMergeableRow)) {
      throw new UserFacingError(
        `Sauvegarde illisible : la table « ${name} » contient des enregistrements invalides.`,
      );
    }
  }

  return snapshot as BackupSnapshot;
};
