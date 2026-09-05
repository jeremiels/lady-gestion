import { db } from "./db.ts";
import { newId } from "./ids.ts";

/**
 * Who owns the rows in this database.
 *
 * Today there is one user and no server, so the owner is a UUID generated on
 * first run and kept in the `meta` table. Stamping it onto every record now
 * means that when Google sign-in arrives, adopting the real account id is a
 * data update (rewrite `ownerId` on existing rows) rather than a schema
 * migration on a table that never had a tenant column. Retrofitting "who owns
 * this row" is the expensive part; paying for the column up front costs
 * nothing.
 */

let cachedOwnerId: string | null = null;

/**
 * Resolves the owner id, creating one on first run. Must be awaited once
 * during app start-up, before any repository write.
 */
export const initOwnerId = async (): Promise<string> => {
  if (cachedOwnerId) return cachedOwnerId;

  const existing = await db.meta.get("ownerId");
  if (typeof existing?.value === "string") {
    cachedOwnerId = existing.value;
    return cachedOwnerId;
  }

  const ownerId = newId();
  await db.meta.put({ key: "ownerId", value: ownerId });
  cachedOwnerId = ownerId;
  return ownerId;
};

/**
 * The current owner id, synchronously. Throws rather than silently writing
 * rows with a placeholder owner, which would be invisible until the day the
 * data is pushed to a server.
 */
export const getOwnerId = (): string => {
  if (!cachedOwnerId) {
    throw new Error(
      "Owner id not initialised — call initData() before writing records.",
    );
  }
  return cachedOwnerId;
};

/** Test/restore hook: adopt an owner id read from elsewhere (e.g. a backup file). */
export const setOwnerId = async (ownerId: string): Promise<void> => {
  await db.meta.put({ key: "ownerId", value: ownerId });
  cachedOwnerId = ownerId;
};
