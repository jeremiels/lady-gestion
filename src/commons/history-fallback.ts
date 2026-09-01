/**
 * The shared vocabulary of the no-Navigation-API path.
 *
 * `Router` owns the fallback itself — see its `hostConnected`. This module
 * exists because two callers have to speak to that fallback without importing
 * the controller: `goBack` needs to read the position the router stamps on each
 * history entry, and `navigateTo` needs a way to hand a programmatic navigation
 * over rather than reloading the page.
 *
 * **None of this runs where the Navigation API exists.** That path is the one
 * every Chromium browser takes and it is untouched — the router reaches for any
 * of this only when `'navigation' in window` is false, which today means Safari
 * before 26.2 and Firefox before 147. See the browser floor in AGENTS.md.
 */

/**
 * Where the position of the current entry is stamped.
 *
 * The Navigation API hands out `navigation.currentEntry.index` for free and the
 * history API has nothing equivalent: `history.length` counts entries from
 * before the app was loaded, which is exactly the trap `goBack` documents. So
 * the router keeps its own count on each entry's state. Prefixed so it cannot
 * collide with anything else that might one day share `history.state`.
 */
const INDEX_KEY = '__routerIndex';

/** This entry's position, or `undefined` if nothing has stamped one yet. */
export function historyIndex(state: unknown = history.state): number | undefined {
  const value = (state as Record<string, unknown> | null | undefined)?.[INDEX_KEY];
  return typeof value === 'number' ? value : undefined;
}

/** Stamps `index` on the current entry, preserving anything already there. */
export function stampHistoryIndex(index: number): void {
  history.replaceState({ ...(history.state as object | null), [INDEX_KEY]: index }, '');
}

/** Pushes a new entry at `index`, pointing at `url`. */
export function pushHistoryEntry(index: number, url: string): void {
  history.pushState({ [INDEX_KEY]: index }, '', url);
}

/** Fired on `window` by `navigateTo`, for the router's fallback to claim. */
export const APP_NAVIGATE = 'app-navigate';

/** The path a pending `APP_NAVIGATE` is asking for. */
export interface AppNavigateDetail {
  path: string;
}

/**
 * Asks a mounted router to take `path`, and reports whether one did.
 *
 * Cancelable rather than a direct call: the router is a controller on the shell
 * and this module must not import it, so `preventDefault()` is how the fallback
 * says "mine". Nothing claims it before the shell has connected, and nothing
 * claims it where the Navigation API exists — in both cases `navigateTo` wants
 * its real page load anyway.
 */
export function requestNavigate(path: string): boolean {
  const event = new CustomEvent<AppNavigateDetail>(APP_NAVIGATE, {
    cancelable: true,
    detail: { path },
  });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
