import { db } from "../db.ts";
import {
  canBeParentOf,
  childrenOf,
  resolveCatalogue,
  type ResolvedEventType,
} from "../event-types.ts";
import { createRecord, crud, liveOnly, softDelete, touch } from "../record.ts";
import type { EventTypeDef, NewRecord, RecordPatch } from "../types.ts";

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

/**
 * The same list with every row's `icon`/`theme` filled in from its parent —
 * what every view holds a `LiveQuery` on.
 *
 * `listAll` stays raw beside it because the type editor is the one caller that
 * must see the `null`: it is the difference between a swatch showing a chosen
 * colour and one saying "hérité".
 */
export const listResolved = async (): Promise<ResolvedEventType[]> =>
  resolveCatalogue(await listAll());

export const { get, update } = crud<EventTypeDef>(db.eventTypes);

/** Adds a type to the catalogue. */
export const add = async (
  fields: NewRecord<EventTypeDef>,
): Promise<EventTypeDef> => {
  const type = createRecord<EventTypeDef>(fields);
  await db.eventTypes.add(type);
  return type;
};

/**
 * The patch that makes a child a root without changing how it looks.
 *
 * Whatever it was drawing thanks to its parent is written into its own
 * columns, which is what keeps `EventTypeDef.theme` meaningful on a child: it
 * is the value the row takes back the moment it stops inheriting. Without
 * this, detaching or deleting a parent would repaint its children with the
 * fallback tone for no reason the user can see.
 */
const detachment = (
  resolved: ResolvedEventType[],
  childId: string,
): RecordPatch<EventTypeDef> => {
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
 * treats a dangling parent that way), but only by accident, and only until a
 * backup carrying both rows merged them back into disagreement. Repairing the
 * link is what makes that behaviour a safety net instead of the mechanism.
 *
 * The events of a deleted type are untouched: they store its `key`, which
 * outlives the row on purpose.
 */
export const remove = async (id: string): Promise<void> => {
  await db.transaction("rw", db.eventTypes, async () => {
    const types = liveOnly(await db.eventTypes.toArray());
    const target = types.find((type) => type.id === id);
    if (!target) return;

    const resolved = resolveCatalogue(types);
    for (const child of childrenOf(types, id)) {
      await db.eventTypes.put(touch(child, detachment(resolved, child.id)));
    }

    await db.eventTypes.put(softDelete(target));
  });
};

/**
 * Attaches a type under `parentId`, or detaches it when that is `null`.
 *
 * The one write path that can create a parent link, so it is where the depth
 * cap is enforced — `canBeParentOf` refuses anything that would make a
 * three-deep chain or a cycle, and this answers `undefined` rather than
 * writing a catalogue no reader could resolve.
 *
 * Attaching clears `theme`, because a child always takes its parent's: that is
 * what makes a group read as one colour in the budget ring, and it is the
 * invariant the whole feature rests on rather than a preference the editor
 * happens to apply. `icon` is left alone — it is what still tells `Dentiste`
 * from `Vétérinaire` inside the group, so it inherits only when a row has none
 * of its own, which is how the editor creates a new child.
 */
export const setParent = async (
  childId: string,
  parentId: string | null,
): Promise<EventTypeDef | undefined> =>
  db.transaction("rw", db.eventTypes, async () => {
    const types = liveOnly(await db.eventTypes.toArray());
    const child = types.find((type) => type.id === childId);
    if (!child) return undefined;

    // Detaching something that is already a root would only re-stamp
    // `updatedAt`, and `updatedAt` is what last-write-wins resolves a restore
    // by — a write that changes nothing must not win an argument.
    if (parentId === null && child.parentId === null) return child;

    if (parentId !== null && !canBeParentOf(types, childId, parentId)) {
      return undefined;
    }

    const patch: RecordPatch<EventTypeDef> =
      parentId === null
        ? detachment(resolveCatalogue(types), childId)
        : { parentId, theme: null };

    const updated = touch(child, patch);
    await db.eventTypes.put(updated);
    return updated;
  });
