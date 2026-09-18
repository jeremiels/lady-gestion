import { describe, expect, it } from "vitest";
// The real global stylesheet, so the custom properties below are the ones the
// app actually ships rather than a fixture that agrees with the test.
import "../styles/main.css";
import { THEME_KEYS, THEME_META, isThemeKey } from "./theme.ts";

/**
 * The TypeScript half of a theme and the CSS half are joined by a naming
 * convention and nothing else. `THEME_META` builds `var(--color-theme-<key>)`
 * from the key and `tokens/color.css` declares the property, but no compiler
 * checks the second exists: a fifteenth `ThemeKey` added without its two custom
 * properties type-checks perfectly and renders transparent.
 *
 * In the browser project because that is the only place the question can
 * actually be answered — not "does the file contain this text" but "does this
 * `var()` resolve to a colour in a document that loaded the real stylesheet".
 */
const resolved = (property: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(property).trim();

describe("THEME_META ↔ tokens/color.css", () => {
  it("reports an undeclared property as empty", () => {
    // Without this the checks below could pass vacuously: if `getComputedStyle`
    // ever answered something non-empty for a property nobody declared, every
    // assertion in this file would be true of a stylesheet that loaded nothing.
    expect(resolved("--color-theme-chartreuse")).toBe("");
  });

  it.each(THEME_KEYS)("%s resolves to a real colour", (key) => {
    expect(
      resolved(`--color-theme-${key}`),
      `--color-theme-${key} resolves to nothing`,
    ).not.toBe("");
    expect(
      resolved(`--color-theme-${key}-background`),
      `--color-theme-${key}-background resolves to nothing`,
    ).not.toBe("");
  });

  it.each(THEME_KEYS)(
    "%s points at its own tokens, not another key's",
    (key) => {
      // The one mistake building the values from the key cannot prevent: an entry
      // wired to the wrong argument (`pink: themeTokens("green")`).
      expect(THEME_META[key].color).toBe(`var(--color-theme-${key})`);
      expect(THEME_META[key].backgroundColor).toBe(
        `var(--color-theme-${key}-background)`,
      );
    },
  );

  it("has an entry for every key and no others", () => {
    expect(Object.keys(THEME_META).sort()).toEqual([...THEME_KEYS].sort());
  });

  it("recognises exactly the keys it declares", () => {
    // `isThemeKey` is the guard a restored backup's theme string passes
    // through; it must agree with the table rather than be a second list.
    for (const key of THEME_KEYS) expect(isThemeKey(key)).toBe(true);
    expect(isThemeKey("chartreuse")).toBe(false);
  });
});
