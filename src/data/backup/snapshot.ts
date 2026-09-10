import {
  RECORD_TABLES,
  SCHEMA_VERSION,
  db,
  type BackupTables,
  type RecordTableName,
} from "../db.ts";
import { nowISO, type IsoTimestamp } from "../dates.ts";
import {
  quantityField,
  seedEventTypeDefs,
  SCHEMA_V9_NESTINGS,
  SCHEMA_V10_NESTINGS,
  SCHEMA_V10_NEW_TYPES,
} from "../event-types.ts";
import {
  migrateEventToCustomFields,
  SCHEMA_V11_ACTIVITY_RENAME,
  type LegacyEventColumns,
} from "../events.ts";
import { newerOf } from "../record.ts";
import { getOwnerId, setOwnerId } from "../owner.ts";
import { seasonFromLegacyFlag } from "../seasons.ts";
import * as metaRepo from "../repositories/meta.repo.ts";
import { clearUntouchedSeedData } from "../seed.ts";
import type { BaseRecord, HorseEvent, RationItem } from "../types.ts";

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
 * Merges a snapshot into the local database, last-write-wins per record.
 *
 * Restoring a three-week-old backup must not throw away edits made since, so
 * each incoming row is only written when its `updatedAt` is newer than the
 * local copy's. That also makes import safe to run twice.
 */
export const importBackup = async (
  snapshot: unknown,
): Promise<ImportResult> => {
  const backup = migrateSnapshot(assertSnapshot(snapshot));

  // A restore almost always happens on a fresh install, where the first-run
  // seed has just written a demo horse. Clear it first or the user ends up
  // with two.
  await clearUntouchedSeedData();

  // The counters live inside the transaction callback on purpose: Dexie may
  // retry a transaction, and outer-scope counters would keep the tally from
  // the abandoned attempt on top of the successful one.
  const result = await db.transaction(
    "rw",
    TABLE_NAMES.map((name) => RECORD_TABLES[name]),
    async () => {
      let imported = 0;
      let skipped = 0;

      const merge = async <T extends BaseRecord>(
        table: {
          get(id: string): Promise<T | undefined>;
          put(row: T): Promise<unknown>;
        },
        rows: T[],
      ) => {
        for (const row of rows) {
          const existing = await table.get(row.id);
          if (newerOf(existing, row) === row) {
            await table.put(row);
            imported += 1;
          } else {
            skipped += 1;
          }
        }
      };

      for (const name of TABLE_NAMES) {
        await merge<BaseRecord>(RECORD_TABLES[name], backup.tables[name]);
      }

      return { imported, skipped };
    },
  );

  // The restored rows carry the exporting device's `ownerId`. Adopt it, or the
  // database ends up split between two owners — old rows under the snapshot's,
  // anything created afterwards under this install's. Invisible today; a data
  // integrity bug the day these rows reach a server. Runs outside the
  // transaction above because `meta` is not one of its tables.
  if (backup.ownerId) await setOwnerId(backup.ownerId);

  await metaRepo.markBackedUp();

  return result;
};

/**
 * An event row while a migration below is still in progress.
 *
 * Every column any step touches, all optional: a step earlier than the one
 * that reads a given column has not written it yet (`customFields`, before the
 * v5→v6 step below runs), and a step later than the one that drops a column
 * has already removed it (`vendor`, once that same step has run). Declared
 * once and used by every step that reads or writes one of these, rather than a
 * cast repeated at each — the same reason `LegacyHorseEvent`/`LegacyWorkEvent`
 * exist in `db.ts`: a shape used only mid-migration, never the real shape a
 * snapshot or a store holds before or after.
 */
type MigratingEventRow = Omit<HorseEvent, "customFields"> &
  Partial<LegacyEventColumns> & {
    customFields?: HorseEvent["customFields"];
  };

type MigratingTables = Omit<BackupTables, "events"> & {
  events: MigratingEventRow[];
};

/**
 * Brings an older snapshot up to the current schema, in place of the database
 * upgrade an old *file* never goes through.
 *
 * `assertSnapshot` accepts any `schemaVersion <= SCHEMA_VERSION`, but accepting
 * a file is not the same as understanding it: a v1 export carries
 * `RationItem.seasonal` and no `season`, and merging those rows unchanged would
 * write ration lines the current build reads as "fed all year" — a silent data
 * loss on the one feature the restore exists to protect.
 *
 * Each step mirrors the matching `db.version(n).upgrade()` in `db.ts`. Add to
 * both, or a restore and a live upgrade will disagree.
 */
export const migrateSnapshot = (backup: BackupSnapshot): BackupSnapshot => {
  if (backup.schemaVersion >= SCHEMA_VERSION) return backup;

  // Loosened to `MigratingTables` for the run of this function: an event row
  // genuinely does not have the final `HorseEvent` shape (`customFields`
  // filled in, the legacy columns gone) until every step below has run, and
  // `BackupTables` — the type `backup.tables` already satisfies, and the one
  // this function returns — states the *finished* shape, not the shape a
  // half-migrated file is in partway through this function's own body.
  let tables: MigratingTables = backup.tables;

  // v1 -> v2: `seasonal: boolean` becomes a `season` window.
  if (backup.schemaVersion < 2) {
    tables = {
      ...tables,
      rationItems: tables.rationItems.map((row) => {
        const { seasonal, ...rest } = row as RationItem & {
          seasonal?: boolean;
        };
        return { ...rest, season: seasonFromLegacyFlag(seasonal) };
      }),
    };
  }

  // v2 -> v3: events gain `vendor` and `followUpInterval`. A pre-v3 file simply
  // has no such keys, and `undefined` is not `null` — the merge would write rows
  // whose columns contradict the declared type.
  if (backup.schemaVersion < 3) {
    tables = {
      ...tables,
      events: tables.events.map((row) => ({
        ...row,
        vendor: row.vendor ?? null,
        followUpInterval: row.followUpInterval ?? null,
      })),
    };
  }

  // v3 -> v4: events gain `activity`, for the same reason and with the same
  // consequence as the columns above.
  if (backup.schemaVersion < 4) {
    tables = {
      ...tables,
      events: tables.events.map((row) => ({
        ...row,
        activity: row.activity ?? null,
      })),
    };
  }

  // v4 -> v5: `activities` is a whole new table, so an older file has no such
  // key at all. The first four steps fix up rows; this one supplies a table
  // that was never written — `importBackup` merges every name in
  // `TABLE_NAMES`, and `undefined` there is a TypeError from inside the
  // transaction. `assertSnapshot` lets the absence through for exactly this.
  if (backup.schemaVersion < 5) {
    tables = { ...tables, activities: tables.activities ?? [] };
  }

  // v5 -> v6: event types stop being a closed, compile-time union. Every
  // event's fixed `providerName`/`vendor`/`followUpInterval`/`activity`/
  // `amountCents` columns fold into a `customFields` bag — the exact
  // transform `db.ts`'s live upgrade applies, shared as
  // `migrateEventToCustomFields` so the two cannot disagree — and the type
  // catalogue itself, absent from a pre-v6 file the same way `activities` was
  // absent from a pre-v5 one, is supplied with the same built-in rows a fresh
  // device seeds.
  if (backup.schemaVersion < 6) {
    const types =
      tables.eventTypes ?? seedEventTypeDefs(backup.ownerId, nowISO());
    tables = {
      ...tables,
      eventTypes: types,
      events: tables.events.map((row) => {
        const { type, customFields, notes } = migrateEventToCustomFields(
          {
            type: row.type,
            notes: row.notes ?? null,
            providerName: row.providerName ?? null,
            vendor: row.vendor ?? null,
            followUpInterval: row.followUpInterval ?? null,
            activity: row.activity ?? null,
            amountCents: row.amountCents ?? null,
          },
          types,
        );
        const {
          providerName: _providerName,
          vendor: _vendor,
          followUpInterval: _followUpInterval,
          activity: _activity,
          amountCents: _amountCents,
          ...rest
        } = row;
        return { ...rest, type, customFields, notes };
      }),
    };
  }

  // v6 -> v7: `alimentation`'s built-in `fields` gains a `quantity` entry.
  // Same transform as `db.ts`'s v7 upgrade, applied to the file's own
  // `eventTypes` rows instead of a live table — addressed by `key`, the same
  // field `findEventType` resolves a type by everywhere else in this app, so
  // an older file's row is found the same way regardless of which build wrote
  // it or what its own `id` happens to be. Guarded so replaying an
  // already-migrated row (a device patched live, backed up, then restored
  // onto itself) cannot double the field.
  if (backup.schemaVersion < 7) {
    tables = {
      ...tables,
      eventTypes: tables.eventTypes.map((type) =>
        type.key === "alimentation" &&
        !type.fields.some((field) => field.id === "quantity")
          ? { ...type, fields: [...type.fields, quantityField()] }
          : type,
      ),
    };
  }

  // v7 -> v8: event types gain `parentId`. A pre-v8 file has no such key, and
  // `undefined` is not `null` — the same trap v3 and v4 fixed for events, with
  // the same consequence: the merge writes rows whose column contradicts the
  // declared type, and `JSON.stringify` drops the key again on the next
  // export, so the file never heals itself. `??` rather than a bare `null`
  // keeps a real parent on a file that already carries one, which is what a
  // device patched live, backed up, then restored onto itself produces.
  //
  // `icon` and `theme` widen to nullable in the same version with nothing to
  // fix up: a pre-v8 row always carries both. `resolveCatalogue`
  // (`data/event-types.ts`) is what copes with a file where they do not.
  if (backup.schemaVersion < 8) {
    tables = {
      ...tables,
      eventTypes: tables.eventTypes.map((type) => ({
        ...type,
        parentId: type.parentId ?? null,
      })),
    };
  }

  // v8 -> v9: `cures` files under `alimentation`, `traitement` under `veto` —
  // the first built-ins to use v8's hierarchy. Same payload as `db.ts`'s v9
  // upgrade, shared as `SCHEMA_V9_NESTINGS` so the two cannot drift, applied
  // to the file's own `eventTypes` rows instead of a live table.
  //
  // The parent's `id` comes from the file's own rows: `SCHEMA_V9_NESTINGS` is
  // keyed by `key` for exactly this, since an older file's ids are whatever
  // the build that wrote it produced. Guarded on the child still being a root,
  // so a file already carrying the link — or one where the user chose a
  // different parent — passes through untouched.
  if (backup.schemaVersion < 9) {
    const rows = tables.eventTypes;
    tables = {
      ...tables,
      eventTypes: rows.map((type) => {
        const nesting = SCHEMA_V9_NESTINGS.find((one) => one.key === type.key);
        if (!nesting || type.parentId !== null) return type;

        const parent = rows.find((one) => one.key === nesting.parentKey);
        return parent
          ? { ...type, parentId: parent.id, icon: null, theme: null }
          : type;
      }),
    };
  }

  // v9 -> v10: `osteo` files under `soins`, and `massage` is seeded as its
  // new sibling. Same payloads as `db.ts`'s v10 upgrade, shared as
  // `SCHEMA_V10_NESTINGS`/`SCHEMA_V10_NEW_TYPES` so the two cannot drift,
  // applied to the file's own `eventTypes` rows instead of a live table.
  //
  // The reparenting mirrors v8 -> v9 above, including resolving the parent's
  // `id` from the file's own rows rather than assuming it equals `key` —
  // except `osteo`'s icon is kept rather than nulled; see
  // `SCHEMA_V10_NESTINGS`'s own comment for why. The insertion mirrors v5 ->
  // v6's `eventTypes` seed: `massage` never shipped before, so there is no
  // row in an older file to migrate, only one to add — guarded on the key not
  // already being present, for a file already carrying it.
  if (backup.schemaVersion < 10) {
    const rows = tables.eventTypes;
    const nested = rows.map((type) => {
      const nesting = SCHEMA_V10_NESTINGS.find((one) => one.key === type.key);
      if (!nesting || type.parentId !== null) return type;

      const parent = rows.find((one) => one.key === nesting.parentKey);
      return parent ? { ...type, parentId: parent.id, theme: null } : type;
    });

    const existingKeys = new Set(nested.map((type) => type.key));
    // `seedEventTypeDefs` stamps `parentId` as the literal key it is written
    // with in `BUILT_IN_EVENT_TYPES`, resolved to a real `id` below off the
    // file's own rows for the same reason the reparenting above does.
    const additions = seedEventTypeDefs(backup.ownerId, nowISO())
      .filter(
        (type) =>
          SCHEMA_V10_NEW_TYPES.includes(type.key) &&
          !existingKeys.has(type.key),
      )
      .map((type) => {
        const parent = rows.find((row) => row.key === type.parentId);
        return parent ? { ...type, parentId: parent.id } : type;
      });

    tables = { ...tables, eventTypes: [...nested, ...additions] };
  }

  // v10 -> v11: `balade` splits into two activities. Same rewrite as `db.ts`'s
  // v11 upgrade, shared as `SCHEMA_V11_ACTIVITY_RENAME` so the two cannot
  // drift, applied to the file's own `events` rows instead of a live table.
  // Guarded on the field still reading the old key, so a file already
  // rewritten — or one where the user genuinely picked today's `balade` —
  // passes through untouched.
  if (backup.schemaVersion < 11) {
    const { type, field, from, to } = SCHEMA_V11_ACTIVITY_RENAME;
    tables = {
      ...tables,
      events: tables.events.map((row) =>
        row.type === type && row.customFields?.[field] === from
          ? {
              ...row,
              customFields: { ...row.customFields, [field]: to },
            }
          : row,
      ),
    };
  }

  return {
    ...backup,
    schemaVersion: SCHEMA_VERSION,
    tables: tables as BackupTables,
  };
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
 */
const isMergeableRow = (row: unknown): boolean =>
  typeof row === "object" &&
  row !== null &&
  typeof (row as Partial<BaseRecord>).id === "string" &&
  typeof (row as Partial<BaseRecord>).updatedAt === "string";

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

  // Everything below this point goes straight into IndexedDB, where a bad row
  // is permanent. Validate before the transaction opens rather than letting a
  // malformed file surface as a TypeError from inside the merge.
  const tables = snapshot.tables as Record<string, unknown>;

  for (const name of TABLE_NAMES) {
    const rows = tables[name];

    // A table introduced by a later schema is simply absent from an older file,
    // and that is not corruption — `migrateSnapshot` supplies it below. Only a
    // file already at the current version is required to carry every table.
    // Without this, adding a table to `RECORD_TABLES` silently makes every
    // backup ever exported unrestorable, on the one feature that exists to stop
    // data being lost.
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
