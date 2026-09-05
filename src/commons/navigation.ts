/**
 * The two navigations a view does for itself.
 *
 * `app-root` owns routing; these are for a view that has to move the user
 * somewhere as the result of an action — a back button, or landing somewhere
 * sensible after deleting the record the page was showing.
 */
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
