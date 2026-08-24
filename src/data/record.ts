import { nowISO } from './dates.ts';
import { newId } from './ids.ts';
import { getOwnerId } from './owner.ts';
import type { BaseRecord, NewRecord, RecordPatch } from './types.ts';

/**
 * The single place where `id`, `ownerId`, timestamps and soft-delete are
 * applied. Repositories go through these helpers so no table can quietly
 * forget to stamp `updatedAt` — which restore and future sync depend on.
 */

export const createRecord = <T extends BaseRecord>(fields: NewRecord<T>): T => {
  const timestamp = nowISO();
  return {
    ...fields,
    id: fields.id ?? newId(),
    ownerId: getOwnerId(),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  } as T;
};

/**
 * Applies a patch and re-stamps `updatedAt`. The patch type excludes identity
 * and bookkeeping fields, so a caller cannot rewrite `id`, `ownerId` or
 * `createdAt` by accident.
 */
export const touch = <T extends BaseRecord>(record: T, patch: RecordPatch<T>): T => ({
  ...record,
  ...patch,
  updatedAt: nowISO(),
});

/**
 * Marks a record deleted without removing it. A row that is simply gone
 * cannot be communicated to a backup or another device — the absence is
 * indistinguishable from "never existed here".
 */
export const softDelete = <T extends BaseRecord>(record: T): T => {
  const timestamp = nowISO();
  return { ...record, deletedAt: timestamp, updatedAt: timestamp };
};

export const isLive = <T extends BaseRecord>(record: T): boolean => record.deletedAt === null;

export const liveOnly = <T extends BaseRecord>(records: T[]): T[] => records.filter(isLive);

/**
 * Last-write-wins resolution, used when merging a backup into the local
 * database: an older snapshot must never overwrite a newer local edit.
 */
export const newerOf = <T extends BaseRecord>(a: T | undefined, b: T): T => {
  if (!a) return b;
  return b.updatedAt > a.updatedAt ? b : a;
};

/**
 * The slice of a table the shared CRUD below needs.
 *
 * Structural rather than Dexie's `Table`, so this module keeps its promise of
 * having no `dexie` import — the same shape, and for the same reason, as the
 * `merge` helper in `backup/snapshot.ts`.
 */
export type RecordTable<T> = {
  get(id: string): Promise<T | undefined>;
  put(row: T): Promise<unknown>;
};

/**
 * The three operations every table implements identically.
 *
 * This module's promise at the top — that soft-delete is applied in one place —
 * used to hold for writes only. The *read* half was copy-pasted into all four
 * repositories:
 *
 *     return event && isLive(event) ? event : undefined;
 *
 * Four chances to forget it, and forgetting it means tombstoned rows surfacing
 * in the UI with nothing to catch it. `update` and `remove` were verbatim in
 * four and three repositories respectively for the same reason: there is only
 * one correct way to write them.
 *
 * A repository spreads what it needs and keeps its own domain queries:
 *
 *     export const { get, update, remove } = crud<Horse>(db.horses);
 *
 * Take only `get` and `update` where the deletion is not a plain tombstone —
 * `documents.repo.ts` has to drop the file bytes in the same transaction, so it
 * writes its own `remove` and this one stays out of its way.
 */
export const crud = <T extends BaseRecord>(table: RecordTable<T>) => {
  /** Soft-deleted rows do not exist as far as every read path is concerned. */
  const get = async (id: string): Promise<T | undefined> => {
    const record = await table.get(id);
    return record && isLive(record) ? record : undefined;
  };

  return {
    get,

    /** `undefined` when there is no live record under `id` — never a throw. */
    update: async (id: string, patch: RecordPatch<T>): Promise<T | undefined> => {
      const existing = await get(id);
      if (!existing) return undefined;

      const updated = touch(existing, patch);
      await table.put(updated);
      return updated;
    },

    /** Writes the tombstone. Removing a row that is already gone is a no-op. */
    remove: async (id: string): Promise<void> => {
      const existing = await get(id);
      if (!existing) return;
      await table.put(softDelete(existing));
    },
  };
};
