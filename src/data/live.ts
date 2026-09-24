import type { ReactiveController, ReactiveControllerHost } from "lit";
import { liveQuery } from "./db.ts";
import { dataReady, isDataReady } from "./ready.ts";

/**
 * The first value of every connected `LiveQuery` that has not delivered one
 * yet — what `liveQueriesSettled` waits on.
 */
const firstValues = new Set<Promise<void>>();

/**
 * Waits for every connected `LiveQuery` still missing its first value, for at
 * most `timeoutMs`.
 *
 * For a caller that wants a view whole before showing it — the route
 * transition, which otherwise captures a view on its empty state and fills it
 * in mid-slide. Resolves `true` when some were pending and all of them
 * answered, `false` when none were pending or time ran out: an answer can
 * mount a component with queries of its own, so a caller loops while this
 * keeps returning `true`.
 */
export const liveQueriesSettled = async (
  timeoutMs: number,
): Promise<boolean> => {
  if (firstValues.size === 0 || timeoutMs <= 0) return false;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const answered = await Promise.race([
    Promise.all(firstValues).then(() => true),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  return answered;
};

/**
 * Bridges Dexie's `liveQuery` to Lit's reactive update cycle.
 *
 * This is the whole of the app's state management. A `liveQuery` re-runs
 * whenever any table it touched is written to — by any component, in any
 * view — so a component holding one of these re-renders on its own after a
 * write, with no store, no events and no manual refresh calls.
 *
 *     export class HorseView extends BaseElement {
 *       #horse = new LiveQuery(this, () => horsesRepo.getActive());
 *
 *       render() {
 *         const horse = this.#horse.value;
 *         return horse ? html`<h1>${horse.name}</h1>` : nothing;
 *       }
 *     }
 *
 * `value` is `undefined` until the first emission — render a loading or empty
 * state for that tick.
 *
 * **Subscription waits for `initData()`.** "Any table it touched" is the catch:
 * on a first run the database is still being seeded while views mount, so a
 * query that begins with "which horse is active?" takes its no-horse branch and
 * returns without ever reading `events` — and a table a query never read is a
 * table Dexie has no reason to re-run it for. The rows land, nothing re-fires,
 * and the view sits empty until the user reloads. Waiting for the gate means
 * the first run always sees a finished database, so the observed set is
 * complete from the start. See `ready.ts`.
 */
export class LiveQuery<T> implements ReactiveController {
  value: T | undefined;
  error: unknown;

  #host: ReactiveControllerHost;
  #query: () => T | Promise<T>;
  #subscription: { unsubscribe(): void } | undefined;
  #settled = false;
  #connected = false;
  /** This connection's entry in `firstValues`, until its first value arrives. */
  #firstValue: PromiseWithResolvers<void> | undefined;

  constructor(host: ReactiveControllerHost, query: () => T | Promise<T>) {
    this.#host = host;
    this.#query = query;
    host.addController(this);
  }

  /**
   * True until the first emission arrives.
   *
   * Tracked with its own flag rather than inferred from `value === undefined`:
   * plenty of queries here legitimately resolve `undefined` — `getActive()` on
   * a database with no horse, `get()` on a missing id — and a view keyed off
   * that would show a spinner forever on exactly the empty state it needs to
   * render.
   */
  get loading(): boolean {
    return !this.#settled;
  }

  hostConnected() {
    this.#connected = true;
    // Counted from the moment the host connects, not from the subscribe: a
    // query still waiting on the gate below is just as far from its value.
    this.#firstValue = Promise.withResolvers<void>();
    firstValues.add(this.#firstValue.promise);

    // Already open on every navigation after the first, so this is a straight
    // synchronous subscribe rather than a wasted tick of loading state.
    if (isDataReady()) {
      this.#subscribe();
      return;
    }

    void dataReady().then(() => {
      // The host can be gone before the gate opens — a view the user navigated
      // straight past. `hostDisconnected` ran with nothing to unsubscribe, so
      // without this flag it would be subscribed here and never torn down.
      if (this.#connected) this.#subscribe();
    });
  }

  hostDisconnected() {
    this.#connected = false;
    this.#subscription?.unsubscribe();
    this.#subscription = undefined;
    // A host that leaves before its first value must not hold a waiter up.
    this.#releaseFirstValue();
    // Reconnecting re-subscribes and re-runs the query, so the next emission is
    // genuinely a first one again.
    this.#settled = false;
  }

  /**
   * Re-runs the query now, for an input Dexie cannot track — the date, which
   * `Today` watches. `value` is kept until the new result arrives, so the view
   * does not flash its loading state. A query still waiting on the gate has
   * nothing to re-run: it reads its inputs fresh when it subscribes.
   */
  refresh() {
    if (!this.#subscription) return;
    this.#subscription.unsubscribe();
    this.#subscribe();
  }

  #subscribe() {
    this.#subscription = liveQuery(this.#query).subscribe({
      next: (value) => {
        this.value = value;
        this.error = undefined;
        this.#settled = true;
        this.#host.requestUpdate();
        this.#releaseFirstValue();
      },
      error: (error: unknown) => {
        this.error = error;
        this.#settled = true;
        this.#host.requestUpdate();
        this.#releaseFirstValue();
      },
    });
  }

  #releaseFirstValue() {
    if (!this.#firstValue) return;
    firstValues.delete(this.#firstValue.promise);
    this.#firstValue.resolve();
    this.#firstValue = undefined;
  }
}
