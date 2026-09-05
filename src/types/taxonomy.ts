import type { IconName } from "../components/app-icon/icons.ts";
import { THEME_META, type ThemeKey, type ThemeMeta } from "../theme/theme.ts";

/**
 * How a category presents itself: what to call it, what to draw for it, and
 * which palette entry colours it.
 *
 * Two taxonomies in this app have exactly this shape — `EventTypeKey` in
 * `event.types.ts` and `DocumentCategory` in `document.types.ts` — and they had
 * a field-for-field copy of it each, with a comment on the second saying it
 * mirrored the first. That is the kind of agreement worth having the compiler
 * keep: a third field added here reaches both, and neither can quietly grow one
 * the other lacks.
 *
 * The *keys* stay separate on purpose. An event type and a document category
 * are different vocabularies that happen to be described the same way; merging
 * them would let a `'facture'` reach a function expecting a `'veto'`.
 */
export type TaxonomyMeta = {
  label: string;
  icon: IconName;
  theme: ThemeKey;
};

/**
 * The accessors every taxonomy table needs, derived from the table itself.
 *
 * The shape was shared here and the *readers* of it still were not: both
 * taxonomies hand-wrote the same `keys` cast and the same three one-line
 * lookups, half of which were plain indexing dressed up as a function
 * (`eventType.label(k)` is `EVENT_TYPE_META[k].label`, no more). Six
 * functions and two casts, none of which had a decision in them.
 *
 * `keys` comes out of the same object, so a category cannot be added to the
 * table and forgotten in the list — the failure that would otherwise show up as
 * a folder missing from the documents view.
 */
export const taxonomy = <K extends string>(meta: Record<K, TaxonomyMeta>) => ({
  keys: Object.keys(meta) as K[],
  label: (key: K): string => meta[key].label,
  icon: (key: K): IconName => meta[key].icon,
  theme: (key: K): ThemeMeta => THEME_META[meta[key].theme],
});
