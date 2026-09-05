import {
  bool,
  decimal,
  readForm,
  type FieldError,
  type FormSchema,
} from "../forms.ts";
import * as rationsRepo from "../repositories/rations.repo.ts";
import { DEFAULT_SEASON } from "../seasons.ts";
import type { RationItem, RecordPatch } from "../types.ts";

/**
 * Reading the feed-plan sheet back and writing what actually changed.
 *
 * The sheet is one form over the horse's whole plan: every line at once, one
 * "Enregistrer". Its field *names* are generated from the lines themselves
 * (`quantity-<id>`), which is what makes this worth a module rather than a
 * handler — the markup that renders a control and the schema that parses it
 * back have to agree on a string, and until this existed they were two separate
 * template literals in the same file with nothing tying them together. The
 * version before *that* hardcoded five product names in the markup and read
 * four different keys, and saving wrote one unlabeled row and dropped the rest.
 *
 * `rationFieldNames` is the tie. Both halves call it; neither spells a name.
 *
 * See `events.service.ts` for what a service is here and the rules one follows.
 */

/**
 * The two controls one ration line contributes, by name.
 *
 * Called by the markup in `HorseView.#renderRationField` and by the schema
 * below, so a rename is one edit rather than two that must be made together.
 */
export const rationFieldNames = (
  id: string,
): { quantity: string; seasonal: string } => ({
  quantity: `quantity-${id}`,
  seasonal: `seasonal-${id}`,
});

export type RationSheetResult =
  /** `saved` counts the lines actually written — unchanged ones are not. */
  | { ok: true; saved: number }
  | { ok: false; errors: Partial<Record<string, FieldError>> };

/**
 * Parses the sheet against the same list that rendered it, then writes the
 * lines whose values moved.
 *
 * Takes the rations as an argument rather than re-reading them: the schema, the
 * lookup and the comparison must all run against the list the user was actually
 * looking at, and a fresh read could return a different one.
 *
 * Native constraint validation already blocked every normal path — the inputs
 * are `required` with a decimal `pattern`. The parsing here is for the paths
 * that skip it, where a `NaN` written to IndexedDB is permanent and renders as
 * "NaN g" for the life of the record.
 */
export const saveRationSheet = async (
  rations: RationItem[],
  source: HTMLFormElement | FormData,
): Promise<RationSheetResult> => {
  const schema: FormSchema = Object.fromEntries(
    rations.flatMap((ration) => {
      const names = rationFieldNames(ration.id);
      return [
        [names.quantity, decimal({ required: true, min: 0 })],
        [names.seasonal, bool()],
      ];
    }),
  );

  const result = readForm(source, schema);
  if (!result.ok) return { ok: false, errors: result.errors };

  const patches = rationPatches(rations, result.value);
  if (patches.length > 0) await rationsRepo.updateMany(patches);
  return { ok: true, saved: patches.length };
};

/**
 * The submitted values, diffed against the lines they came from.
 *
 * **Untouched lines are skipped, not re-saved**, and that is not an
 * optimisation. `touch()` restamps `updatedAt`, and `clearUntouchedSeedData`
 * (`seed.ts`) tells a demo row from a real one by `createdAt === updatedAt` —
 * so writing all five lines here because one of them changed would make the
 * whole seeded plan look hand-entered and survive the next backup restore,
 * leaving the user with two feed plans. Nothing about that coupling is visible
 * from the sheet, which is most of why this belongs down here.
 */
const rationPatches = (
  rations: RationItem[],
  values: Record<string, unknown>,
): { id: string; patch: RecordPatch<RationItem> }[] =>
  rations.flatMap((ration) => {
    const names = rationFieldNames(ration.id);

    // The cast is what a schema built with `Object.fromEntries` costs: the key
    // union is gone, so the parsers' return types are gone with it. The `null`
    // branch cannot be reached through `decimal({ required: true })` — a blank
    // field fails the parse and never gets here — but skipping the line is the
    // right answer either way, and it keeps the cast honest.
    const quantity = values[names.quantity] as number | null;
    if (quantity === null) return [];

    // Re-ticking "Saisonnier" restores the line's own window when it still has
    // one, so a stored Nov→Mar isn't quietly flattened to the default.
    const season = values[names.seasonal]
      ? (ration.season ?? DEFAULT_SEASON)
      : null;

    const unchanged =
      quantity === ration.quantity &&
      season?.from === ration.season?.from &&
      season?.to === ration.season?.to;

    return unchanged ? [] : [{ id: ration.id, patch: { quantity, season } }];
  });
