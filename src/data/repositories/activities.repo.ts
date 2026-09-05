import { db } from "../db.ts";
import { createRecord, crud, liveOnly } from "../record.ts";
import type { ActivityItem, NewRecord } from "../types.ts";

/**
 * The work activities the user added themselves — the catalogue behind the
 * week strip's day sheet.
 *
 * A list of chips to offer, not a parent table: a `travail` event stores the
 * label rather than a row id (see `WorkActivity` in `events.ts`), so removing a
 * line here retires a chip and touches nothing else.
 */

/**
 * The horse's own activities, oldest first.
 *
 * Ordered by `createdAt` in memory rather than by an index, so a newly added
 * chip appears at the end of the row where the user just typed it — the store
 * indexes `updatedAt`, which would reshuffle the whole list on any later edit.
 * The catalogue is a handful of rows read whole, so the sort is free.
 */
export const listByHorse = async (horseId: string): Promise<ActivityItem[]> => {
  const items = await db.activities.where("horseId").equals(horseId).toArray();
  return liveOnly(items).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};

export const { get, update, remove } = crud<ActivityItem>(db.activities);

/** Adds an activity to the horse's catalogue. */
export const add = async (
  fields: NewRecord<ActivityItem>,
): Promise<ActivityItem> => {
  const item = createRecord<ActivityItem>(fields);
  await db.activities.add(item);
  return item;
};
