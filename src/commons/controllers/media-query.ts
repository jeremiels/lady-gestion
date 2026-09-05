import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * A media query as reactive state.
 *
 * `matchMedia(...).matches` read inline samples the answer once and never hears
 * about it again — which is how `app-donut-chart` came to check
 * `prefers-reduced-motion` only at the moment its data changed, leaving a user
 * who flipped the setting mid-session with the old behaviour until something
 * else happened to re-trigger the check.
 *
 *     export class AppDonutChart extends BaseElement {
 *       #reducedMotion = new MediaQuery(this, '(prefers-reduced-motion: reduce)');
 *
 *       // ...reads `this.#reducedMotion.matches`, and re-renders when it flips.
 *     }
 *
 * Subscribes on connect and unsubscribes on disconnect, so a detached host
 * holds no listener — the same contract `LiveQuery` follows for its Dexie
 * subscription.
 */
export class MediaQuery implements ReactiveController {
  matches: boolean;

  #host: ReactiveControllerHost;
  #list: MediaQueryList;

  constructor(host: ReactiveControllerHost, query: string) {
    this.#host = host;
    this.#list = matchMedia(query);
    // Seeded rather than left undefined: a host that reads this during its
    // first render runs before `hostConnected` has fired.
    this.matches = this.#list.matches;
    host.addController(this);
  }

  hostConnected() {
    // Re-read on connect: the query can have changed while detached, and
    // between construction and connection for an element created ahead of time.
    this.matches = this.#list.matches;
    this.#list.addEventListener("change", this.#onChange);
  }

  hostDisconnected() {
    this.#list.removeEventListener("change", this.#onChange);
  }

  #onChange = () => {
    this.matches = this.#list.matches;
    this.#host.requestUpdate();
  };
}
