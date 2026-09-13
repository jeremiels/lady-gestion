import { db } from "../db.ts";
import { createRecord, liveOnly, touch } from "../record.ts";
import type { NewRecord, UserProfile } from "../types.ts";

/**
 * The user's identity. One row in practice, but read as "the most recently
 * written live row" rather than by a fixed id: a restore merges by id, so a
 * backup from another device can land a second row next to the local one, and
 * the newer of the two is the one the user last typed.
 */

export type ProfileFields = NewRecord<UserProfile>;

export const get = async (): Promise<UserProfile | undefined> => {
  const rows = liveOnly(await db.profiles.toArray());
  return rows.reduce<UserProfile | undefined>(
    (latest, row) => (!latest || row.updatedAt > latest.updatedAt ? row : latest),
    undefined,
  );
};

/**
 * Creates the row on first save, updates it after. An unchanged form writes
 * nothing, so `updatedAt` only moves when the user actually edited something.
 */
export const save = async (fields: ProfileFields): Promise<UserProfile> => {
  const existing = await get();

  if (!existing) {
    const created = createRecord<UserProfile>(fields);
    await db.profiles.add(created);
    return created;
  }

  const unchanged =
    existing.firstName === fields.firstName &&
    existing.lastName === fields.lastName &&
    existing.email === fields.email;
  if (unchanged) return existing;

  const updated = touch(existing, {
    firstName: fields.firstName,
    lastName: fields.lastName,
    email: fields.email,
  });
  await db.profiles.put(updated);
  return updated;
};
