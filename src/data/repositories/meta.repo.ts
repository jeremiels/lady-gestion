import { db } from '../db.ts';
import { nowISO, type IsoTimestamp } from '../dates.ts';
import type { MetaKey } from '../types.ts';

/**
 * Local app state: which horse is on screen, when the last backup ran, the
 * Drive folder id. Deliberately not an entity — it is never exported, never
 * synced, and stays behind on the device it belongs to.
 */

export const get = async <T>(key: MetaKey): Promise<T | undefined> =>
  (await db.meta.get(key))?.value as T | undefined;

export const set = async (key: MetaKey, value: unknown): Promise<void> => {
  await db.meta.put({ key, value });
};

export const remove = async (key: MetaKey): Promise<void> => {
  await db.meta.delete(key);
};

export const getLastBackupAt = (): Promise<IsoTimestamp | undefined> =>
  get<IsoTimestamp>('lastBackupAt');

export const markBackedUp = (): Promise<void> => set('lastBackupAt', nowISO());

/**
 * The notifications preference, on until the user says otherwise. The default
 * lives here rather than in the view so the two cannot drift. Nothing consumes
 * the flag yet — reminders are not implemented.
 */
export const getNotificationsEnabled = async (): Promise<boolean> =>
  (await get<boolean>('notificationsEnabled')) ?? true;

export const setNotificationsEnabled = (enabled: boolean): Promise<void> =>
  set('notificationsEnabled', enabled);

/** Whole days since the last backup; `Infinity` when there has never been one. */
export const daysSinceBackup = async (): Promise<number> => {
  const last = await getLastBackupAt();
  if (!last) return Infinity;
  return Math.floor((Date.now() - Date.parse(last)) / 86_400_000);
};
