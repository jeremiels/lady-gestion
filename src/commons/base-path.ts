/**
 * Where the app is mounted, and the two conversions that follow from it.
 *
 * GitHub Pages serves a project repository from `/<repo>/` rather than the
 * origin root, so the address bar reads `/lady-gestion/events` while the route
 * table — and every path literal in the app — says `/events`. One of the two
 * has to give. Rewriting the route table would spread the deploy target across
 * every view, card and test that mentions a path; converting at the two edges
 * where a browser pathname is *read* or *written* keeps all of them
 * app-relative, and leaves one file to change if the app ever moves again.
 *
 * `import.meta.env.BASE_URL` is Vite's `base`, substituted at build time and
 * always carrying a trailing slash. It is `/` under `npm run dev` and under the
 * browser suite — `vitest.config.ts` is a separate config and deliberately does
 * not inherit `base` — which is why both keep working untouched: every function
 * here is the identity when the app is served from the root.
 */
const BASE = import.meta.env.BASE_URL;

/** `BASE` without its trailing slash, so `''` when mounted at the root. */
const PREFIX = BASE.slice(0, -1);

/**
 * A pathname from the browser → the path the route table matches on.
 *
 * `/lady-gestion` with no trailing slash is the app root too — it is what the
 * user gets by trimming the URL, and the host redirects it to the slashed form,
 * but a navigation can be observed before that lands.
 *
 * Anything outside the prefix is returned unchanged rather than rewritten, so
 * it matches no route and renders the 404 view. Silently mapping it onto a real
 * route would be worse than the 404: it would claim a page the URL never asked
 * for.
 */
export function toAppPath(pathname: string): string {
  if (!PREFIX) return pathname;
  if (pathname === PREFIX) return "/";
  return pathname.startsWith(BASE) ? pathname.slice(PREFIX.length) : pathname;
}

/**
 * An app path (`/events`) → what belongs in an `href` or in `location.href`.
 *
 * Every link in the app goes through this. Missing one is invisible in dev and
 * in the test suite, where the prefix is empty and the raw literal is already
 * correct — it only breaks once deployed. That asymmetry is the reason this is
 * a function rather than a prefix spelled out at each call site.
 */
export function appHref(path: string): string {
  return `${PREFIX}${path}`;
}
