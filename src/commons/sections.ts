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

/** `root` itself, or anything below it. Both sub-page sections ask this. */
const isUnder = (root: string, path: string): boolean =>
  path === root || path.startsWith(`${root}/`);

/** The tab carrying this id, or `undefined`. Generic, so each caller keeps its own union. */
const tabWithId = <T extends readonly { id: string }[]>(
  tabs: T,
  value: string | undefined,
): T[number] | undefined => tabs.find((tab) => tab.id === value);

/**
 * `/horse` and everything under it.
 *
 * Pulled out of the route's own `match` so the `horse` view-transition type and
 * the section's `matches` reuse the exact same check rather than drifting out
 * of sync with it.
 */
export const isHorsePath = (path: string): boolean => isUnder("/horse", path);

/**
 * `/horse` or `/horse/<id>`, but not a tab below it — where the Cheval nav item
 * and `horse-card` both point.
 *
 * `isLateral` needs it because this section's landing carries the horse's id,
 * so it is the one section whose `root` can never equal its own destination.
 */
const isHorseLanding = (path: string): boolean =>
  path === "/horse" || /^\/horse\/[^/]+$/.test(path);

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

  const match = tabWithId(HORSE_TABS, tab);
  return match ? { horseId, tab: match.id } : null;
};

/**
 * The view-transition type a navigation touching the horse page gets.
 *
 * `horse` on the way in or out, where `horse-card` morphs — it is the shared
 * element between the dashboard's card and the page's cover, and coming from
 * anywhere else only the incoming half exists. Between two of the horse's own
 * sub-pages it is `horse-subpage` instead: the cover and the second-level nav
 * are on both sides and must stay put while only the tab's content slides —
 * re-running the card morph there would animate a card that never moved.
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

/**
 * The horse's page, default tab — what both the Cheval nav item and
 * `horse-card` link to, so the two cannot drift.
 *
 * App-relative, like every path here — `appHref()` it where it is rendered.
 */
export const horsePath = (horseId: string): string => `/horse/${horseId}`;

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
  isUnder(CUSTOMIZE_ROOT, path);

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

  const match = tabWithId(
    CUSTOMIZE_TABS,
    path.slice(`${CUSTOMIZE_ROOT}/`.length),
  );
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
  /**
   * Where this section's nav item actually points, when that is not `root`.
   *
   * Only `isLateral` reads it, and only the horse's section supplies it: its
   * link carries the horse's id, so `root` alone can never equal the path a tap
   * on the item lands on and every move into the section would read as a
   * drill-down. See the comment on `isLateral` for what that half decides.
   */
  landsOn?: (path: string) => boolean;
};

export const SECTIONS: Section[] = [
  {
    id: "home",
    root: "/",
    label: "Accueil",
    icon: "home",
    // The dashboard alone. It links to the horse's page and to Budget, but both
    // are sections of their own with their own nav item, and claiming either
    // here would light two items at once and make the move read as a drill-down
    // to `isLateral`.
    matches: (path) => path === "/",
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
    id: "horses",
    root: "/horse",
    label: "Cheval",
    icon: "cheval",
    // A prefix match, like Activités: the tabs under `/horse/<id>` are the
    // Cheval section too, and must not unlight it.
    matches: isHorsePath,
    landsOn: isHorseLanding,
  },
];

/** The section a path belongs to, or `undefined` for a path in none (the 404). */
export const sectionOf = (path: string): Section | undefined =>
  SECTIONS.find((section) => section.matches(path));

/**
 * A sideways move: out of one section and onto the landing page of another.
 *
 * The "onto a landing" half matters as much as the section comparison. Leaving
 * `/profile` for `/posts/<id>` via a deep link changes section but still lands
 * a level down, and should still push.
 *
 * Both arguments are app-relative paths, the form `Router` works in — which is
 * why the comparison below is against `section.root` and not against a rendered
 * href.
 */
export const isLateral = (from: string, to: string): boolean => {
  const fromSection = sectionOf(from);
  const toSection = sectionOf(to);

  return (
    SECTIONS.some((section) =>
      section.landsOn ? section.landsOn(to) : section.root === to,
    ) &&
    fromSection !== undefined &&
    toSection !== undefined &&
    fromSection !== toSection
  );
};
