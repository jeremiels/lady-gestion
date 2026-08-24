/**
 * The two navigations a view does for itself.
 *
 * `app-root` owns routing; these are for a view that has to move the user
 * somewhere as the result of an action — a back button, or landing somewhere
 * sensible after deleting the record the page was showing.
 */

/**
 * Navigates to `path`.
 *
 * `navigation` is optional — Safari before 18.2 and older Firefox have no
 * Navigation API, and `app-root` deliberately doesn't polyfill it. Assigning
 * `location.href` is the fallback every browser has, and it reloads into the
 * same cached shell rather than failing.
 */
export const navigateTo = (path: string): void => {
  if ('navigation' in window) navigation.navigate(path);
  else location.href = path;
};

/**
 * Back to wherever this page was opened from, or `fallback` if it wasn't opened
 * from anywhere.
 *
 * Going back rather than to a fixed link, so returning from the calendar lands
 * on the calendar and returning from the list lands on the list.
 *
 * The test is the Navigation API's entry index, **not `history.length`**, which
 * counts entries from before the app was even loaded — it reads 2 on a genuinely
 * cold start, so a bare `back()` there walks *off the app* to whatever the tab
 * showed before. `index > 0` means there is a previous same-origin entry and
 * nothing else. That case is not theoretical: the service worker answers any
 * path with the cached shell, so a shared or bookmarked deep link opens with no
 * app history behind it.
 *
 * Lives here rather than in each view because that reasoning is not recoverable
 * from reading the code — the second hand-written copy is where it gets lost.
 */
export const goBack = (fallback: string): void => {
  const index = 'navigation' in window ? navigation.currentEntry?.index : undefined;

  if (index === undefined) {
    // No Navigation API, so every route change was a real page load and the
    // browser's own history is the only thing left to go on.
    if (history.length > 1) history.back();
    else navigateTo(fallback);
    return;
  }

  if (index > 0) navigation.back();
  else navigateTo(fallback);
};
