import type { IconName } from "../components/app-icon/icons.ts";
import { THEME_META, type ThemeKey, type ThemeMeta } from "../theme/theme.ts";

/**
 * How a category presents itself: what to call it, what to draw for it, and
 * which palette entry colours it.
 *
 * `DocumentCategory` (`document.types.ts`) is a closed, compile-time taxonomy
 * with exactly this shape. Event types used to be the same — a
 * `Record<EventTypeKey, TaxonomyMeta>` in `event.types.ts` — until schema v6
 * turned them into user-visible data (`EventTypeDef` in `data/types.ts`,
 * which restates `label`/`icon`/`theme` as real columns rather than reading
 * this shared type, since a `taxonomy()` table only makes sense over a closed,
 * compile-time key set).
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
