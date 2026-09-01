import type { ReactiveController, ReactiveControllerHost } from 'lit';

/**
 * A view's UI state, held on the history entry rather than on the element.
 *
 * `app-root` renders a different template per route, so lit-html tears the old
 * view's element down on the way out and constructs a brand new one on the way
 * back — every `@state()` field is re-initialised from its declaration. That is
 * why drilling into an event and pressing Retour used to land on the calendar
 * however the list had been left, and why `goBack`'s own promise ("returning
 * from the list lands on the list") was aspirational.
 *
 * The state lives on the **Navigation API's history entry**, which is the
 * platform's own answer to this and buys three things a module-level cache does
 * not: two `/events` entries in the stack each keep their own state, a nav-bar
 * tap pushes a *fresh* entry and so opens at defaults, and a reload restores
 * what was on screen because the entry's state is part of the session history.
 * No storage to write, expire or clean up — AGENTS.md rules out localStorage,
 * and `meta.repo` is device settings in IndexedDB, async and deliberately
 * outside the backup.
 *
 * **Never reach for `history.replaceState()` here.** Where the Navigation API
 * exists it routes `pushState`/`replaceState` through a `navigate` event, which
 * `Router` intercepts — so persisting a chip tap that way would run a full view
 * transition and re-render the page on every tap. `updateCurrentEntry()` fires
 * only `currententrychange`, which nothing in this app listens for.
 */

/**
 * The one property of the entry's state object this module owns.
 *
 * `updateCurrentEntry()` **replaces** the state rather than merging into it, so
 * every write here has to spread what was already there. Keeping every view's
 * bag under one reserved name is what lets that spread stay safe for state this
 * module did not write, and what makes `clearViewState()` a single delete
 * rather than a list of names to keep in step with the views.
 */
const NAMESPACE = 'views';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * The current entry's whole state object.
 *
 * No Navigation API (Safari before 26.2, Firefox before 147 — both *above* the
 * browser floor, not below it, so this is the live path on most iPhones rather
 * than a legacy one) means every navigation is a real page load and the view is
 * rebuilt from the cached shell either way, so there is nothing to restore and
 * nothing to write. The visible cost there is that the calendar/list mode, the
 * type chip and the budget period reset on every Retour. AGENTS.md accepts that
 * degradation; a `history` shim would be a second code path the Chromium-only
 * component suite could never exercise.
 */
const currentState = (): Record<string, unknown> => {
  if (!('navigation' in window)) return {};

  const state: unknown = navigation.currentEntry?.getState();
  return isRecord(state) ? state : {};
};

/** Every view's bag, keyed by the name each `ViewState` was constructed with. */
const namespace = (): Record<string, unknown> => {
  const bags: unknown = currentState()[NAMESPACE];
  return isRecord(bags) ? bags : {};
};

const read = (key: string): Record<string, unknown> => {
  const bag: unknown = namespace()[key];
  return isRecord(bag) ? bag : {};
};

const write = (key: string, bag: object): void => {
  if (!('navigation' in window)) return;

  navigation.updateCurrentEntry({
    state: { ...currentState(), [NAMESPACE]: { ...namespace(), [key]: bag } },
  });
};

/**
 * Stored values over the defaults, for the keys the defaults declare and no
 * others.
 *
 * The restriction is the point: an entry's state outlives a deploy and is
 * reachable from the devtools, so a bag written by an older build — or by hand
 * — must not be able to put a property on a view that the view never declared.
 * Unknown *values* under a known key still get through; each view keeps that
 * survivable by testing for the non-default branch, so anything unrecognised
 * falls back to the default rendering rather than to a blank one.
 */
const restore = <T extends object>(defaults: T, stored: Record<string, unknown>): T => {
  const merged = { ...defaults };

  for (const key of Object.keys(defaults) as (keyof T & string)[]) {
    if (key in stored) merged[key] = stored[key] as T[keyof T & string];
  }

  return merged;
};

/**
 * Drops every view's stored bag from the current entry.
 *
 * For the test fixture, and load-bearing there: the whole run shares the
 * runner's one history entry, so a test that switches `EventsView` to list mode
 * would otherwise leave that behind for the next test's mount to restore —
 * breaking assertions about the default state, from a different file, with
 * nothing pointing at the cause.
 */
export const clearViewState = (): void => {
  if (!('navigation' in window)) return;

  const { [NAMESPACE]: _views, ...rest } = currentState();
  navigation.updateCurrentEntry({ state: rest });
};

/**
 * Holds `T` for the host and keeps it on the history entry.
 *
 * A typed bag rather than a list of host property names to mirror: the fields
 * this replaces are `@state() private`, so they are not in `keyof EventsView`
 * and a "persist these properties" controller could only be written with casts
 * nothing checks. The bag being the state also means a field added to `T` is
 * persisted without anyone remembering to add it anywhere else.
 */
export class ViewState<T extends object> implements ReactiveController {
  /** Read this from `render()`. Write through `patch()`, never in place. */
  value: T;

  #host: ReactiveControllerHost;
  #key: string;
  #defaults: () => T;

  /**
   * @param key Names this view's bag inside the entry. Two views sharing one
   *   entry — only the tests do — must not clobber each other.
   * @param defaults Called again on every connect rather than once at
   *   construction, so a default derived from `todayISO()` is resolved when the
   *   view is actually shown.
   */
  constructor(host: ReactiveControllerHost, key: string, defaults: () => T) {
    this.#host = host;
    this.#key = key;
    this.#defaults = defaults;
    this.value = defaults();
    host.addController(this);
  }

  hostConnected() {
    this.value = restore(this.#defaults(), read(this.#key));
  }

  /** Merges `changes` in, stores the result, and re-renders the host. */
  patch(changes: Partial<T>) {
    this.value = { ...this.value, ...changes };
    write(this.#key, this.value);
    this.#host.requestUpdate();
  }
}
