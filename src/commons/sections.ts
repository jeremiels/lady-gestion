import type { IconName } from "../components/app-icon/icons.ts";

/**
 * The bottom nav, and the app's only definition of what a section contains.
 *
 * The `matches` predicates answer one question — "which section is the user
 * in?" — that two callers need: the nav bar, to decide which item is lit, and
 * the route transition, to tell a sideways move from a drill-down. Those two
 * used to answer it separately, and a comment on the second claimed the two
 * agreed. They did not. One table, one answer, no way to drift.
 *
 * Its own module rather than a block in `app-root`, for two reasons. The table
 * is consumed by the nav bar *and* by `extraTransitionTypes`, so it is shared
 * route metadata rather than shell internals. And `app-root` registers a custom
 * element on import, so a suite that wants to re-import this under a different
 * `BASE_URL` — see `sections.test.ts`, which is the only way to cover the
 * deployed base — cannot do it through the shell.
 */

/**
 * `/horse` and `/horse/<id>`.
 *
 * Pulled out of the route's own `match` so the `horse` view-transition type can
 * reuse the exact same check rather than drifting out of sync with it.
 */
export const isHorsePath = (path: string): boolean =>
  path === "/horse" || path.startsWith("/horse/");

/**
 * The horse page's sub-pages, in the order the second-level nav shows them.
 *
 * The first is the default: `/horse/<id>` with no tab renders it, which is what
 * keeps `horse-card`'s plain `/horse/<id>` link valid.
 */
export const HORSE_TABS = [
  { id: "ration", label: "Ration" },
  { id: "cures", label: "Cures" },
  { id: "traitements", label: "Traitements" },
  { id: "cheval", label: "Cheval" },
] as const;

export type HorseTab = (typeof HORSE_TABS)[number]["id"];

const isHorseTab = (value: string): value is HorseTab =>
  HORSE_TABS.some((tab) => tab.id === value);

/**
 * `/horse`, `/horse/<id>` or `/horse/<id>/<tab>`, split into its parts — or
 * `null` for anything else, an unknown tab included, so the route table can
 * hand that to the 404 instead of silently showing the default tab.
 *
 * `horseId` is `null` only for the bare `/horse`.
 */
export const horseRouteOf = (
  path: string,
): { horseId: string | null; tab: HorseTab } | null => {
  if (path === "/horse") return { horseId: null, tab: HORSE_TABS[0].id };
  if (!path.startsWith("/horse/")) return null;

  const [horseId, tab, ...rest] = path.slice("/horse/".length).split("/");
  if (!horseId || rest.length > 0) return null;
  if (tab === undefined) return { horseId, tab: HORSE_TABS[0].id };
  return isHorseTab(tab) ? { horseId, tab } : null;
};

/**
 * The view-transition type a navigation touching the horse page gets.
 *
 * `horse` only on the way in or out (home ↔ horse page), where `horse-card`
 * morphs. Between two of the horse's own sub-pages it is `horse-subpage`
 * instead: the cover and the second-level nav are on both sides and must stay
 * put while only the tab's content slides — re-running the card morph there
 * would animate a card that never moved.
 */
export const horseTransitionType = (
  from: string,
  to: string,
): "horse" | "horse-subpage" | null => {
  const fromHorse = isHorsePath(from);
  const toHorse = isHorsePath(to);
  if (fromHorse && toHorse) return "horse-subpage";
  return fromHorse || toHorse ? "horse" : null;
};

/** App-relative, like every path here — `appHref()` it where it is rendered. */
export const horseTabPath = (horseId: string, tab: HorseTab): string =>
  `/horse/${horseId}/${tab}`;

/** Personnaliser mon interface, reached from the profile page. */
export const CUSTOMIZE_ROOT = "/profile/interface";

/**
 * Its sub-pages, in sub-nav order — the same shape as `HORSE_TABS`, and the
 * first is likewise the default for the bare `CUSTOMIZE_ROOT`.
 */
export const CUSTOMIZE_TABS = [
  { id: "profil", label: "Profil" },
  { id: "ration", label: "Ration" },
  { id: "categories", label: "Catégories" },
  { id: "cheval", label: "Cheval" },
] as const;

export type CustomizeTab = (typeof CUSTOMIZE_TABS)[number]["id"];

const isCustomizePath = (path: string): boolean =>
  path === CUSTOMIZE_ROOT || path.startsWith(`${CUSTOMIZE_ROOT}/`);

/**
 * `CUSTOMIZE_ROOT` or `CUSTOMIZE_ROOT/<tab>`, as its tab — `null` for anything
 * else, an unknown tab included, so the route table 404s it as `horseRouteOf`
 * does.
 */
export const customizeRouteOf = (
  path: string,
): { tab: CustomizeTab } | null => {
  if (path === CUSTOMIZE_ROOT) return { tab: CUSTOMIZE_TABS[0].id };
  if (!isCustomizePath(path)) return null;

  const tab = path.slice(`${CUSTOMIZE_ROOT}/`.length);
  const match = CUSTOMIZE_TABS.find((candidate) => candidate.id === tab);
  return match ? { tab: match.id } : null;
};

/** `customize-subpage` between two of its tabs, where header and sub-nav stay put. */
export const customizeTransitionType = (
  from: string,
  to: string,
): "customize-subpage" | null =>
  customizeRouteOf(from) && customizeRouteOf(to) ? "customize-subpage" : null;

/** App-relative, like every path here — `appHref()` it where it is rendered. */
export const customizeTabPath = (tab: CustomizeTab): string =>
  `${CUSTOMIZE_ROOT}/${tab}`;

/** One of the four destinations the bottom nav offers. */
export type Section = {
  id: string;
  /**
   * The section's root, **app-relative** — `/posts`, never `/lady-gestion/posts`.
   *
   * App-relative and not an `href`, because this field is read as well as
   * written. `appHref()` belongs at the one place it is rendered into a link;
   * baking the prefix in here instead is what made `isLateral` compare a
   * deployed href against a stripped path and silently answer `false` for every
   * navigation in production. See `base-path.ts` for why paths stay
   * app-relative everywhere but the edges.
   */
  root: string;
  label: string;
  icon: IconName;
  /**
   * Every path that belongs to this section — including its drill-downs, which
   * have no nav item of their own and must not unlight the one they came from.
   *
   * Must claim disjoint sets. `sectionOf` is a `find`, and the nav lights each
   * item independently, so a path two predicates both claim gets the first
   * section for transitions and *two* lit nav items at once.
   */
  matches: (path: string) => boolean;
};

export const SECTIONS: Section[] = [
  {
    id: "home",
    root: "/",
    label: "Accueil",
    icon: "home",
    // The horse's page is a drill-down from the dashboard, not a section of its
    // own — an unlit bar there would say otherwise. `/budget` used to be listed
    // here for the same reason and is not any more: it has had its own nav item
    // since it was added to the bar, and leaving it claimed here lit two items
    // at once and made Accueil↔Budget look like a drill-down to `isLateral`.
    matches: (path) => path === "/" || isHorsePath(path),
  },
  {
    id: "posts",
    root: "/posts",
    label: "Activités",
    icon: "date",
    // A prefix match: a post's own page is still the Activités section.
    matches: (path) => path.startsWith("/posts"),
  },
  {
    id: "budget",
    root: "/budget",
    label: "Budget",
    icon: "currencyEur",
    matches: (path) => path === "/budget",
  },
  {
    id: "documents",
    root: "/documents",
    label: "Documents",
    icon: "folder",
    matches: (path) => path === "/documents",
  },
];

/** The section a path belongs to, or `undefined` for a path in none (the 404). */
export const sectionOf = (path: string): Section | undefined =>
  SECTIONS.find((section) => section.matches(path));

/**
 * A sideways move: out of one section and onto the root of another.
 *
 * The "onto a root" half matters as much as the section comparison. Leaving
 * `/profile` for `/posts/<id>` via a deep link changes section but still lands
 * a level down, and should still push.
 *
 * Both arguments are app-relative paths, the form `Router` works in — which is
 * why the root comparison below is against `section.root` and not against a
 * rendered href.
 */
export const isLateral = (from: string, to: string): boolean => {
  const fromSection = sectionOf(from);
  const toSection = sectionOf(to);

  return (
    SECTIONS.some((section) => section.root === to) &&
    fromSection !== undefined &&
    toSection !== undefined &&
    fromSection !== toSection
  );
};
