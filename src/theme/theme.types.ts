/**
 * Short, stable keys identifying a color theme (a `color` /
 * `backgroundColor` pairing). Themes are purely visual — no icon, no
 * label — so they can be reused by anything that needs a color, not
 * just events. Multiple event types can share the same theme.
 */
export type ThemeKey =
  | "pink"
  | "green"
  | "purple"
  | "orange"
  | "brown"
  | "yellow"
  | "taupe"
  | "turquoise"
  | "fuchsia"
  | "mint"
  | "coral"
  | "peach"
  | "grey"
  | "gold";

export type ThemeMeta = {
  color: string;
  backgroundColor: string;
};
