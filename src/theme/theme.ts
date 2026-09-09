import type { ThemeKey, ThemeMeta } from "./theme.types.ts";

export const THEME_META: Record<ThemeKey, ThemeMeta> = {
  pink: {
    color: "var(--color-theme-pink)",
    backgroundColor: "var(--color-theme-pink-background)",
  },
  green: {
    color: "var(--color-theme-green)",
    backgroundColor: "var(--color-theme-green-background)",
  },
  purple: {
    color: "var(--color-theme-purple)",
    backgroundColor: "var(--color-theme-purple-background)",
  },
  orange: {
    color: "var(--color-theme-orange)",
    backgroundColor: "var(--color-theme-orange-background)",
  },
  brown: {
    color: "var(--color-theme-brown)",
    backgroundColor: "var(--color-theme-brown-background)",
  },
  yellow: {
    color: "var(--color-theme-yellow)",
    backgroundColor: "var(--color-theme-yellow-background)",
  },
  taupe: {
    color: "var(--color-theme-taupe)",
    backgroundColor: "var(--color-theme-taupe-background)",
  },
  turquoise: {
    color: "var(--color-theme-turquoise)",
    backgroundColor: "var(--color-theme-turquoise-background)",
  },
  fuchsia: {
    color: "var(--color-theme-fuchsia)",
    backgroundColor: "var(--color-theme-fuchsia-background)",
  },
  mint: {
    color: "var(--color-theme-mint)",
    backgroundColor: "var(--color-theme-mint-background)",
  },
  coral: {
    color: "var(--color-theme-coral)",
    backgroundColor: "var(--color-theme-coral-background)",
  },
  peach: {
    color: "var(--color-theme-peach)",
    backgroundColor: "var(--color-theme-peach-background)",
  },
  grey: {
    color: "var(--color-theme-grey)",
    backgroundColor: "var(--color-theme-grey-background)",
  },
  gold: {
    color: "var(--color-theme-gold)",
    backgroundColor: "var(--color-theme-gold-background)",
  },
};

/**
 * The theme keys as a value, and the runtime check that goes with it.
 *
 * `THEME_META` is a mapped `Record<ThemeKey, ThemeMeta>`, so
 * `noUncheckedIndexedAccess` does *not* widen `THEME_META[key]` to
 * `| undefined` — an unknown theme string reaching a read site is a `TypeError`
 * at render, not a missing colour. A string genuinely can arrive: a restored
 * backup file is validated for `id` and `updatedAt` only
 * (`assertSnapshot`), and `EventTypeDef.theme` is written straight from it.
 * `resolveCatalogue` (`data/event-types.ts`) is the one place that guards it.
 *
 * Mirrors `ICON_NAMES` / `isIconName` in `components/app-icon/icons.ts`, which
 * exists for the same reason on the other half of a type's presentation.
 */
export const THEME_KEYS = Object.keys(THEME_META) as ThemeKey[];

const KEYS: ReadonlySet<string> = new Set<string>(THEME_KEYS);

export const isThemeKey = (value: string): value is ThemeKey => KEYS.has(value);

export type { ThemeKey, ThemeMeta };
