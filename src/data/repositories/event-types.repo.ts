import { db } from "../db.ts";
import { createRecord, crud, liveOnly } from "../record.ts";
import type { EventTypeDef, NewRecord } from "../types.ts";

/**
 * The event-type catalogue: what `HorseEvent.type` points at.
 *
 * Not horse-scoped, unlike `activities.repo.ts`'s catalogue — a type applies
 * across every horse in the database, so there is no `listByHorse` here, only
 * `listAll`.
 */

/** Every live type, in `order` — the sequence the budget donut and a type
 * picker both want, so callers do not have to sort it themselves. */
export const listAll = async (): Promise<EventTypeDef[]> => {
  const types = await db.eventTypes.toArray();
  return liveOnly(types).sort((a, b) => a.order - b.order);
};

export const { get, update, remove } = crud<EventTypeDef>(db.eventTypes);

/** Adds a type to the catalogue. */
export const add = async (
  fields: NewRecord<EventTypeDef>,
): Promise<EventTypeDef> => {
  const type = createRecord<EventTypeDef>(fields);
  await db.eventTypes.add(type);
  return type;
};
