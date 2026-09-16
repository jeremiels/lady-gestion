import type { Category, Post, StoredDocument } from "./types.ts";

/**
 * Schema v13's rename, one row at a time: `events` became `posts` and
 * `eventTypes` became `categories`, with `type` -> `categoryKey`, `archived`
 * -> `enabled` and `eventId` -> `postId`.
 *
 * Its own module rather than a corner of `posts.ts` / `categories.ts`: those
 * hold today's rules over today's rows, and these describe a shape that only
 * exists on a device or in a file that has not been through v13 yet. Shared by
 * `db.ts`'s live upgrade and `migrateSnapshot` (`backup/snapshot.ts`) so the
 * two cannot drift. **Frozen** — it describes what v13 did.
 *
 * Every transform accepts a row from either side of the rename and is a no-op
 * on one already renamed, so replaying one — a device upgraded live, backed
 * up, then restored onto itself — changes nothing.
 */

/** The names a pre-v13 file stores two tables under. */
export const PRE_V13_TABLE_NAMES = {
  posts: "events",
  categories: "eventTypes",
} as const;

/** A post row as a pre-v13 build wrote it, in the `events` store. */
export type LegacyPostRow = Omit<Post, "categoryKey"> & {
  categoryKey?: string;
  type?: string;
};

/**
 * A category row as a pre-v13 build wrote it, in the `eventTypes` store. Both
 * flags optional: schema v6 and v10 seed today's shape into that old store.
 */
export type LegacyCategoryRow = Omit<Category, "enabled"> & {
  enabled?: boolean;
  archived?: boolean;
};

/** A document row as a pre-v13 build wrote it. */
export type LegacyDocumentRow = Omit<StoredDocument, "postId"> & {
  postId?: string | null;
  eventId?: string | null;
};

export const migratePostRowV13 = (row: LegacyPostRow): Post => {
  const { type, categoryKey, ...rest } = row;
  return { ...rest, categoryKey: categoryKey ?? type ?? "" };
};

/** `archived` becomes its inverse, `enabled`. */
export const migrateCategoryRowV13 = (row: LegacyCategoryRow): Category => {
  const { archived, enabled, ...rest } = row;
  return {
    ...rest,
    enabled: typeof enabled === "boolean" ? enabled : archived !== true,
  };
};

export const migrateDocumentRowV13 = (
  row: LegacyDocumentRow,
): StoredDocument => {
  const { eventId, postId, ...rest } = row;
  return { ...rest, postId: postId ?? eventId ?? null };
};
