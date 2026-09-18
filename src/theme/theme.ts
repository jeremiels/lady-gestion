import type { ThemeKey, ThemeMeta } from "./theme.types.ts";

/**
 * A theme's two values, built from its key.
 *
 * Every entry in the table below is the same pair of custom properties with the
 * key substituted, so writing them out by hand bought nothing and cost a place
 * for `--color-theme-mint-backgroud` to hide: a typo here is not a type error,
 * it is a transparent swatch nobody notices until a category renders wrong.
 * Built from the key instead, that class of mistake is unrepresentable.
 *
 * The table stays an explicit `Record<ThemeKey, ThemeMeta>` literal rather than
 * being generated from a list, because that is what makes a `ThemeKey` with no
 * entry a compile error — and `THEME_META[key]` never being `undefined` is what
 * lets every read site index it directly.
 */
const themeTokens = (key: ThemeKey): ThemeMeta => ({
  color: `var(--color-theme-${key})`,
  backgroundColor: `var(--color-theme-${key}-background)`,
});

export const THEME_META: Record<ThemeKey, ThemeMeta> = {
  pink: themeTokens("pink"),
  green: themeTokens("green"),
  purple: themeTokens("purple"),
  orange: themeTokens("orange"),
  brown: themeTokens("brown"),
  yellow: themeTokens("yellow"),
  taupe: themeTokens("taupe"),
  turquoise: themeTokens("turquoise"),
  fuchsia: themeTokens("fuchsia"),
  mint: themeTokens("mint"),
  coral: themeTokens("coral"),
  peach: themeTokens("peach"),
  grey: themeTokens("grey"),
  gold: themeTokens("gold"),
};

/**
 * The theme keys as a value, and the runtime check that goes with it.
 *
 * `THEME_META` is a mapped `Record<ThemeKey, ThemeMeta>`, so
 * `noUncheckedIndexedAccess` does *not* widen `THEME_META[key]` to
 * `| undefined` — an unknown theme string reaching a read site is a `TypeError`
 * at render, not a missing colour. A string genuinely can arrive: a restored
 * backup file is validated for `id` and `updatedAt` only
 * (`assertSnapshot`), and `Category.theme` is written straight from it.
 * `resolveCatalogue` (`data/categories.ts`) is the one place that guards it.
 *
 * Mirrors `ICON_NAMES` / `isIconName` in `components/app-icon/icons.ts`, which
 * exists for the same reason on the other half of a type's presentation.
 */
export const THEME_KEYS = Object.keys(THEME_META) as ThemeKey[];

const KEYS: ReadonlySet<string> = new Set<string>(THEME_KEYS);

export const isThemeKey = (value: string): value is ThemeKey => KEYS.has(value);

export type { ThemeKey, ThemeMeta };
