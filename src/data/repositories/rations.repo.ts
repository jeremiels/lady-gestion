import { db } from '../db.ts';
import { createRecord, crud, liveOnly, touch } from '../record.ts';
import type { NewRecord, RationItem, RecordPatch } from '../types.ts';

/**
 * The daily feed plan, one row per line.
 *
 * Modelled as rows rather than fixed columns (fib / minéral / sel / huile /
 * vitamine) because the list changes with the season and the horse — adding a
 * feed should not require a schema migration.
 */

export const listByHorse = async (horseId: string): Promise<RationItem[]> => {
  const items = await db.rationItems
    .where('[horseId+sortOrder]')
    .between([horseId, -Infinity], [horseId, Infinity])
    .toArray();
  return liveOnly(items);
};

export const { get, update, remove } = crud<RationItem>(db.rationItems);

/** Appends a line at the end of the horse's plan. */
export const add = async (
  fields: Omit<NewRecord<RationItem>, 'sortOrder'> & { sortOrder?: number },
): Promise<RationItem> => {
  const sortOrder = fields.sortOrder ?? (await nextSortOrder(fields.horseId));
  const item = createRecord<RationItem>({ ...fields, sortOrder });
  await db.rationItems.add(item);
  return item;
};

/**
 * Applies several patches in one transaction.
 *
 * The feed plan is edited as a whole — one sheet, every line, one "Enregistrer"
 * — so the write has to be all-or-nothing. Looping `update()` at the call site
 * would leave the plan half-saved if the fourth line threw, and a ration plan
 * that is partly yesterday's is worse than one that failed outright.
 *
 * Unknown ids are skipped rather than throwing: a line deleted in another tab
 * between the sheet opening and Enregistrer is not an error the user can act on.
 */
export const updateMany = async (
  patches: { id: string; patch: RecordPatch<RationItem> }[],
): Promise<void> => {
  await db.transaction('rw', db.rationItems, async () => {
    for (const { id, patch } of patches) {
      const existing = await get(id);
      if (existing) await db.rationItems.put(touch(existing, patch));
    }
  });
};

/**
 * Persists a drag-reordered list in one transaction.
 *
 * A reorder *is* a batch of patches, so it goes through `updateMany` rather than
 * opening a second transaction that does the same get/touch/put by hand. The two
 * used to be separate copies that had drifted apart on the one detail neither
 * explained — this one wrapped its loop in `Promise.all` and the other did not,
 * for identical work. Delegating settles the question in the one place it is
 * answered.
 */
export const reorder = (orderedIds: string[]): Promise<void> =>
  updateMany(orderedIds.map((id, index) => ({ id, patch: { sortOrder: index } })));

const nextSortOrder = async (horseId: string): Promise<number> => {
  const items = await listByHorse(horseId);
  return items.reduce((max, item) => Math.max(max, item.sortOrder + 1), 0);
};
