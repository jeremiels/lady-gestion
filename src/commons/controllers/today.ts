import type { ReactiveController, ReactiveControllerHost } from "lit";
import { todayISO, type IsoDate } from "../../data/dates.ts";

/**
 * Today's date as reactive state, for a view that can stay open across
 * midnight.
 *
 * `todayISO()` samples the clock once. A `LiveQuery` re-runs on a Dexie write,
 * never on the clock, and an installed app brought back from the background
 * the next morning is the same page, not a reload — so a date read inside a
 * query, or in a render nothing re-triggers, stays on yesterday.
 *
 *     export class HomeView extends LightElement {
 *       #today = new Today(this, () => this.#upcoming.refresh());
 *
 *       // ...reads `this.#today.value`, and re-renders when the day turns.
 *     }
 *
 * Re-reads the date at the next local midnight and whenever the page becomes
 * visible again. Timers do not run while iOS has the app suspended, so the
 * visibility check is the one that matters there; the timer covers a screen
 * left open. On a change it calls `onChange` — where the host refreshes the
 * queries that read the date — and re-renders the host.
 */
export class Today implements ReactiveController {
  value: IsoDate = todayISO();

  #host: ReactiveControllerHost;
  #onChange: () => void;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(host: ReactiveControllerHost, onChange: () => void = () => {}) {
    this.#host = host;
    this.#onChange = onChange;
    host.addController(this);
  }

  hostConnected() {
    document.addEventListener("visibilitychange", this.#check);
    // A host reconnected on a later day must not render the day it was
    // built on.
    this.#check();
  }

  hostDisconnected() {
    document.removeEventListener("visibilitychange", this.#check);
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #check = () => {
    const today = todayISO();
    if (today !== this.value) {
      this.value = today;
      this.#onChange();
      this.#host.requestUpdate();
    }
    this.#schedule();
  };

  #schedule() {
    clearTimeout(this.#timer);
    const now = new Date();
    const midnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );
    this.#timer = setTimeout(this.#check, midnight.getTime() - now.getTime());
  }
}
