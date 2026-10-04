import { db } from "../db.ts";
import { nowISO, type IsoTimestamp } from "../dates.ts";
import type { HorseCover, MetaKey } from "../types.ts";

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
  get<IsoTimestamp>("lastBackupAt");

export const markBackedUp = (): Promise<void> => set("lastBackupAt", nowISO());

/**
 * The notifications preference, on until the user says otherwise. The default
 * lives here rather than in the view so the two cannot drift. Off, it empties
 * the push reminder list (`listReminders`, `reminders.ts`).
 */
export const getNotificationsEnabled = async (): Promise<boolean> =>
  (await get<boolean>("notificationsEnabled")) ?? true;

export const setNotificationsEnabled = (enabled: boolean): Promise<void> =>
  set("notificationsEnabled", enabled);

/** The cover photo she picked, `undefined` while the bundled one stands in. */
export const getHorseCover = (): Promise<HorseCover | undefined> =>
  get<HorseCover>("horseCover");

/**
 * Replaces the cover photo. `pickedAt` is stamped here, so two writes never
 * share one: it is what the views and the Drive copy tell photos apart by.
 */
export const setHorseCover = async (
  horseId: string,
  blob: Blob,
): Promise<HorseCover> => {
  const cover: HorseCover = { horseId, blob, pickedAt: nowISO() };
  await set("horseCover", cover);
  return cover;
};
