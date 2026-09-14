/**
 * The two navigations a view does for itself.
 *
 * `app-root` owns routing; these are for a view that has to move the user
 * somewhere as the result of an action — a back button, or landing somewhere
 * sensible after deleting the record the page was showing.
 */
import { toAppPath } from "./base-path.ts";
import { historyIndex, requestNavigate } from "./history-fallback.ts";

/**
 * Navigates to `path`.
 *
 * `navigation` is optional — Safari before 26.2 and Firefox before 147 have no
 * Navigation API. There, `Router`'s history fallback claims this through
 * `requestNavigate`, so the move still animates instead of reloading the app.
 * Assigning `location.href` remains the last resort, for the window before the
 * shell has connected and for any document with no router mounted at all: it is
 * the one thing every browser has, and it reloads into the same cached shell
 * rather than failing.
 */
export const navigateTo = (path: string): void => {
  if ("navigation" in window) navigation.navigate(path);
  else if (!requestNavigate(path)) location.href = path;
};

/**
 * Back to wherever this page was opened from, or `fallback` if it wasn't opened
 * from anywhere.
 *
 * Going back rather than to a fixed link, so returning from the calendar lands
 * on the calendar and returning from the list lands on the list.
 *
 * The test is an entry index, **not `history.length`**, which counts entries
 * from before the app was even loaded — it reads 2 on a genuinely cold start,
 * so a bare `back()` there walks *off the app* to whatever the tab showed
 * before. `index > 0` means there is a previous same-origin entry and nothing
 * else. That case is not theoretical: the service worker answers any path with
 * the cached shell, so a shared or bookmarked deep link opens with no app
 * history behind it.
 *
 * Both paths now have a real index to test. The Navigation API supplies one;
 * without it `Router`'s fallback stamps its own on every entry, which is why
 * this no longer has to guess from `history.length` on the browsers where the
 * guess was wrong. `historyIndex()` still returns `undefined` before the shell
 * has connected and stamped the first entry, and only that case falls through
 * to the old heuristic.
 *
 * Lives here rather than in each view because that reasoning is not recoverable
 * from reading the code — the second hand-written copy is where it gets lost.
 */
export const goBack = (fallback: string): void => {
  const hasNavigation = "navigation" in window;
  const index = hasNavigation ? navigation.currentEntry?.index : historyIndex();

  if (index === undefined) {
    // Neither source knows where we are, so the browser's own count is all
    // that is left — see the caveat above.
    if (history.length > 1) history.back();
    else navigateTo(fallback);
    return;
  }

  if (index <= 0) {
    navigateTo(fallback);
    return;
  }

  if (hasNavigation) navigation.back();
  else history.back();
};

/**
 * Back out of a section whose sub-pages are real routes — to the last entry
 * *before* the user entered it — or to `fallback` if they never came from
 * anywhere.
 *
 * `goBack` steps one entry, which is wrong for a page with tabs: every tab
 * switch pushes an entry, so Retour on `/horse/<id>/cheval` used to land on
 * `/horse/<id>/ration` rather than on the dashboard. This skips every entry
 * `isInside` claims, and still *traverses* rather than pushing, so the
 * transition plays as `back` and the stack is not grown by a way out.
 *
 * Only the Navigation API can see the URLs of earlier entries. Without it there
 * is nothing to search, so it navigates to `fallback` — which lands in the
 * right place, with a forward slide instead of a back one.
 */
export const goBackOutOf = (
  isInside: (path: string) => boolean,
  fallback: string,
): void => {
  if (!("navigation" in window)) {
    navigateTo(fallback);
    return;
  }

  const current = navigation.currentEntry?.index ?? -1;
  const entries = navigation.entries();
  for (let i = current - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry?.url) continue;
    const url = new URL(entry.url);
    if (url.origin !== location.origin) break;
    if (!isInside(toAppPath(decodeURI(url.pathname)))) {
      navigation.traverseTo(entry.key);
      return;
    }
  }

  navigateTo(fallback);
};
