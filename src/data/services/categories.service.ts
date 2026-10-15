import {
  draftOf,
  sameData,
  validateCategory,
  type CategoryDraft,
} from "../category-editor.ts";
import { db } from "../db.ts";
import { createRecord, liveOnly, touch } from "../record.ts";
import * as categoriesRepo from "../repositories/categories.repo.ts";
import * as postsRepo from "../repositories/posts.repo.ts";
import { newId } from "../ids.ts";
import type { Category } from "../types.ts";

/**
 * Writing a category the form builder edited.
 *
 * See `posts.service.ts` for what a service is here and the rules one follows.
 * The rules a draft must meet live in `category-editor.ts`, read by the screen
 * and by this write alike, so the two cannot disagree on what may be saved.
 */

export type SaveCategoryResult =
  | { ok: true; category: Category }
  | { ok: false; errors: Record<string, string> };

/**
 * The draft as it is stored: the label trimmed, and a child's theme `null` —
 * a child always takes its parent's colour, which is what makes a group one
 * wedge in the budget ring.
 */
const storedShape = (draft: CategoryDraft): CategoryDraft => ({
  ...draft,
  label: draft.label.trim(),
  theme: draft.parentId === null ? draft.theme : null,
});

/**
 * Creates the category, or saves the draft over `existing` — in one
 * transaction with the read of the catalogue it is checked against.
 *
 * A new category is hers, not a model: `isBuiltIn: false`, switched on, and
 * its `id` doubles as its slug, the way a built-in's `key` doubles as its
 * `id`. It goes last among its siblings, so the budget ring keeps every other
 * wedge in place.
 *
 * Saving a draft that changes nothing writes nothing: `updatedAt` is what a
 * restore arbitrates by, and a write that changes nothing must not win.
 */
export const saveCategory = ({
  existing,
  draft,
}: {
  existing: Category | null;
  draft: CategoryDraft;
}): Promise<SaveCategoryResult> =>
  db.transaction("rw", db.categories, async () => {
    const catalogue = liveOnly(await db.categories.toArray());
    const current = existing
      ? catalogue.find((type) => type.id === existing.id)
      : undefined;
    if (existing && !current) {
      return {
        ok: false,
        errors: { form: "Cette catégorie a été supprimée entre-temps." },
      };
    }

    const errors = validateCategory(draft, catalogue, existing?.id ?? null);
    if (Object.keys(errors).length > 0) return { ok: false, errors };

    const stored = storedShape(draft);

    if (current) {
      if (sameData(draftOf(current), stored)) {
        return { ok: true, category: current };
      }
      const category = touch(current, stored);
      await db.categories.put(category);
      return { ok: true, category };
    }

    const siblings = catalogue.filter(
      (type) => type.parentId === stored.parentId,
    );
    const id = newId();
    const category = createRecord<Category>({
      ...stored,
      id,
      key: id,
      isBuiltIn: false,
      enabled: true,
      order: Math.max(-1, ...siblings.map((type) => type.order)) + 1,
    });
    await db.categories.add(category);
    return { ok: true, category };
  });

/**
 * Deletes a category no post is filed under — `false`, and nothing written,
 * when one is. A post keeps its category's slug after the row is gone, and
 * would be left with no form, no icon and no colour; the switch in the
 * Catégories tab is how one with posts is put away.
 *
 * Its children are promoted to roots, as `categoriesRepo.remove` does.
 */
export const deleteCategory = (id: string): Promise<boolean> =>
  db.transaction("rw", [db.categories, db.posts], async () => {
    const category = await db.categories.get(id);
    if (!category || category.deletedAt !== null) return true;
    if ((await postsRepo.countByCategory(category.key)) > 0) return false;

    await categoriesRepo.remove(id);
    return true;
  });
