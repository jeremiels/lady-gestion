import type { ReactiveController, ReactiveControllerHost } from "lit";
import { liveQuery } from "./db.ts";
import { dataReady, isDataReady } from "./ready.ts";

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
    // Reconnecting re-subscribes and re-runs the query, so the next emission is
    // genuinely a first one again.
    this.#settled = false;
  }

  #subscribe() {
    this.#subscription = liveQuery(this.#query).subscribe({
      next: (value) => {
        this.value = value;
        this.error = undefined;
        this.#settled = true;
        this.#host.requestUpdate();
      },
      error: (error: unknown) => {
        this.error = error;
        this.#settled = true;
        this.#host.requestUpdate();
      },
    });
  }
}
