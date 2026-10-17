import { db } from "../db.ts";
import {
  childrenOf,
  enabledOf,
  resolveCatalogue,
  type ResolvedCategory,
} from "../categories.ts";
import { createRecord, crud, liveOnly, softDelete, touch } from "../record.ts";
import type { Category, NewRecord, RecordPatch } from "../types.ts";

/**
 * The category catalogue: what `Post.categoryKey` points at.
 *
 * Not horse-scoped, unlike `activities.repo.ts`'s catalogue — a type applies
 * across every horse in the database, so there is no `listByHorse` here, only
 * `listAll`.
 */

/** Every live type, in `order` — the sequence the budget donut and a type
 * picker both want, so callers do not have to sort it themselves. */
export const listAll = async (): Promise<Category[]> => {
  const types = await db.categories.toArray();
  return liveOnly(types).sort((a, b) => a.order - b.order);
};

/**
 * The same list with every row's `icon`/`theme` filled in from its parent —
 * what every view holds a `LiveQuery` on.
 *
 * `listAll` stays raw beside it because the type editor is the one caller that
 * must see the `null`: it is the difference between a swatch showing a chosen
 * colour and one saying "hérité".
 */
export const listResolved = async (): Promise<ResolvedCategory[]> =>
  resolveCatalogue(await listAll());

/**
 * `listResolved`, less the categories switched off — what every view but the
 * Catégories tab holds a `LiveQuery` on. Resolved before filtering, so a child
 * of a disabled parent keeps its inherited presentation (`enabledOf`).
 */
export const listEnabled = async (): Promise<ResolvedCategory[]> =>
  enabledOf(await listResolved());

/**
 * Switches a category on or off.
 *
 * A no-op when the flag already reads `enabled`: a write restamps `updatedAt`,
 * and the next automatic backup would send a new file over a change that is
 * not one — the same rule `saveCategory` follows.
 */
export const setEnabled = async (
  id: string,
  enabled: boolean,
): Promise<Category | undefined> =>
  db.transaction("rw", db.categories, async () => {
    const type = await db.categories.get(id);
    if (!type || type.deletedAt !== null) return undefined;
    if (type.enabled === enabled) return type;

    const updated = touch(type, { enabled });
    await db.categories.put(updated);
    return updated;
  });

export const { get, update } = crud<Category>(db.categories);

/** Adds a type to the catalogue. */
export const add = async (fields: NewRecord<Category>): Promise<Category> => {
  const type = createRecord<Category>(fields);
  await db.categories.add(type);
  return type;
};

/**
 * The patch that makes a child a root without changing how it looks.
 *
 * Whatever it was drawing thanks to its parent is written into its own
 * columns, which is what keeps `Category.theme` meaningful on a child: it
 * is the value the row takes back the moment it stops inheriting. Without
 * this, detaching or deleting a parent would repaint its children with the
 * fallback tone for no reason the user can see.
 */
const detachment = (
  resolved: ResolvedCategory[],
  childId: string,
): RecordPatch<Category> => {
  const child = resolved.find((type) => type.id === childId);
  return {
    parentId: null,
    icon: child?.icon ?? null,
    theme: child?.theme ?? null,
  };
};

/**
 * Soft-deletes a type, promoting its children to roots in the same
 * transaction.
 *
 * Written here rather than taken from `crud()` for the reason that helper's own
 * doc gives for `documents.repo.ts`: the tombstone is not the whole deletion.
 * `parentId` is a structural reference — leaving children pointing at a
 * tombstoned row would make them resolve as roots anyway (`resolveCatalogue`
 * treats a dangling parent that way), but only by accident. Repairing the
 * link is what makes that behaviour a safety net instead of the mechanism.
 *
 * The events of a deleted type are untouched: they store its `key`, which
 * outlives the row on purpose.
 */
export const remove = async (id: string): Promise<void> => {
  await db.transaction("rw", db.categories, async () => {
    const types = liveOnly(await db.categories.toArray());
    const target = types.find((type) => type.id === id);
    if (!target) return;

    const resolved = resolveCatalogue(types);
    for (const child of childrenOf(types, id)) {
      await db.categories.put(touch(child, detachment(resolved, child.id)));
    }

    await db.categories.put(softDelete(target));
  });
};
