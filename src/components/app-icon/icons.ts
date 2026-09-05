/**
 * Where the sprite is served from, and the `<use>` target `app-icon` builds.
 *
 * Here rather than in the plugin that emits it, because the plugin already
 * reads `ICON_NAMES` from this file and the app must not import build tooling.
 * One constant, referenced from both sides, so the file that is written and the
 * URL that is fetched cannot disagree.
 */
export const SPRITE_PATH = "/icons.svg";

/**
 * Every icon the app can draw, camelCased from its file name in
 * `src/assets/icons/`.
 *
 * A list of *names*, not of SVG source. The glyphs live in `/icons.svg`, a
 * sprite built from that folder by `vite/icon-sprite.ts`, and `app-icon`
 * references them with `<use>`.
 *
 * The list stays hand-written because `IconName` is what makes a typo in
 * `icon="chevronLeft"` a compile error, and a name union cannot be derived from
 * a directory at type-check time. Nothing drifts silently for it: the sprite
 * plugin is handed this array and fails the build if the folder and the list
 * disagree in either direction — a file with no name, or a name with no file.
 */
export const ICON_NAMES = [
  "home",
  "homeFilled",
  "date",
  "dateFilled",
  "folder",
  "folderFilled",
  "user",
  "userFilled",
  "search",
  "firstAidKit",
  "footprints",
  "tooth",
  "pawPrint",
  "cowboyHat",
  "carrot",
  "shoppingCart",
  "farm",
  "plus",
  "chevronLeft",
  "chevronRight",
  "close",
  "check",
  "list",
  "signOut",
  "trash",
  "edit",
  "info",
  "download",
  "share",
  "file",
  "currencyEur",
  "currencyEurFilled",
  "cactus",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const NAMES: ReadonlySet<string> = new Set(ICON_NAMES);

/**
 * Runtime check, because `icon` is an attribute: a typo arrives as a string
 * whatever the property type says.
 */
export const isIconName = (value: string): value is IconName =>
  NAMES.has(value);
