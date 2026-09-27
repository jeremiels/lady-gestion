/**
 * Where the app is mounted, and the two conversions that follow from it.
 *
 * GitHub Pages serves a project repository from `/<repo>/` rather than the
 * origin root, so the address bar reads `/lady-gestion/posts` while the route
 * table — and every path literal in the app — says `/posts`. One of the two
 * has to give. Rewriting the route table would spread the deploy target across
 * every view, card and test that mentions a path; converting at the two edges
 * where a browser pathname is *read* or *written* keeps all of them
 * app-relative, and leaves one file to change if the app ever moves again.
 *
 * `import.meta.env.BASE_URL` is Vite's `base`, substituted at build time and
 * always carrying a trailing slash. It is `/lady-gestion/` under `npm run dev`
 * as in the deployed build, and `/` under the browser suite —
 * `vitest.config.ts` is a separate config and deliberately does not inherit
 * `base` — where every function here is the identity. That is why a missing
 * prefix passes the suite: `*.deployed-base.test.ts` stub `BASE_URL` to catch
 * it.
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
 * Anything outside the prefix is returned unchanged rather than rewritten.
 * Most such paths match no route and render the 404 view; one that happens to
 * be an app path itself (`/posts`) still matches its route. Making this strict
 * waits on the history fallback's removal, the other writer of bare paths.
 */
export function toAppPath(pathname: string): string {
  if (!PREFIX) return pathname;
  if (pathname === PREFIX) return "/";
  return pathname.startsWith(BASE) ? pathname.slice(PREFIX.length) : pathname;
}

/**
 * A browser pathname → its app path, decoded. A malformed escape (`/%E0`)
 * throws from `decodeURI`, and at construction that takes the whole shell
 * down to a blank page; it is kept undecoded instead, which matches no route
 * and renders the 404.
 */
export function appPathOf(pathname: string): string {
  let decoded = pathname;
  try {
    decoded = decodeURI(pathname);
  } catch {
    // Left as is — see above.
  }
  return toAppPath(decoded);
}

/**
 * An app path (`/posts`) → what belongs in an `href` or in `location.href`.
 *
 * Every link in the app goes through this. Missing one is invisible in dev and
 * in the test suite, where the prefix is empty and the raw literal is already
 * correct — it only breaks once deployed. That asymmetry is the reason this is
 * a function rather than a prefix spelled out at each call site.
 */
export function appHref(path: string): string {
  return `${PREFIX}${path}`;
}
