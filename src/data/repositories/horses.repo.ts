import { db } from '../db.ts';
import { createRecord, crud, liveOnly } from '../record.ts';
import type { Horse, NewRecord } from '../types.ts';

/**
 * The schema supports any number of horses; the UI currently shows one.
 * `getActive()` is the seam — it resolves whichever horse the app is
 * currently looking at, so views never hardcode an id.
 */

export const { get, update, remove } = crud<Horse>(db.horses);

export const list = async (): Promise<Horse[]> => {
  const horses = await db.horses.orderBy('name').toArray();
  return liveOnly(horses).filter((horse) => horse.archivedAt === null);
};

/** The horse the app is currently showing, falling back to the first one. */
export const getActive = async (): Promise<Horse | undefined> => {
  const active = await db.meta.get('activeHorseId');
  if (typeof active?.value === 'string') {
    const horse = await get(active.value);
    if (horse) return horse;
  }
  const [first] = await list();
  return first;
};

export const setActive = async (id: string): Promise<void> => {
  await db.meta.put({ key: 'activeHorseId', value: id });
};

export const create = async (fields: NewRecord<Horse>): Promise<Horse> => {
  const horse = createRecord<Horse>(fields);
  await db.horses.add(horse);
  return horse;
};
