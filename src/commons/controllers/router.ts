import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { appHref, toAppPath } from '../base-path.ts';
import {
  APP_NAVIGATE,
  type AppNavigateDetail,
  historyIndex,
  pushHistoryEntry,
  stampHistoryIndex,
} from '../history-fallback.ts';

/** Hooks the host supplies. Both are awaited, so both may be async. */
export interface RouterOptions {
  /**
   * Runs before the DOM swap, inside the intercept handler.
   *
   * This is where work that has to finish *before* the new view renders goes —
   * loading a route's chunk, setting `document.title`. Throwing here abandons
   * the client-side navigation and falls back to `location.href = path`, so the
   * browser boots the shell fresh and resolves the route from there.
   */
  beforeRender?: (path: string) => void | Promise<void>;
  /**
   * Runs after the DOM swap and after the view transition's update callback has
   * settled. This is where focus management belongs.
   */
  afterRender?: (path: string) => void | Promise<void>;
  /**
   * Extra view-transition types to layer on top of the built-in `forward`/
   * `back`, computed from the paths on both sides of the navigation.
   *
   * `forward`/`back` alone can only describe *how* content moves; a view that
   * wants to behave differently depending on *which* route it's trading places
   * with — `horse-card` keeping its shared-element morph only between the
   * dashboard and the horse's own page, and riding the plain route slide
   * everywhere else — needs the two paths, not just the direction. Only
   * consulted when there is a direction to combine it with; a `replace` gets
   * no types at all, same as before this existed.
   */
  extraTransitionTypes?: (from: string, to: string) => string[];
  /**
   * Take the history fallback even where the Navigation API exists.
   *
   * For the suite, and load-bearing there. The fallback is the path every
   * iPhone below iOS 26.2 takes, and the browser suite runs on Chromium, which
   * has the Navigation API — so without a way to force it, the code those users
   * actually run would ship with no coverage at all. Production never sets it.
   */
  forceHistoryFallback?: boolean;
}

/** Which way through the history stack a navigation is going. */
export type NavigationDirection = 'forward' | 'back';

/**
 * Whether the browser understands view-transition *types*.
 *
 * Two things shipped separately: `startViewTransition(callback)` came first,
 * the `{ update, types }` form and `:active-view-transition-type()` later.
 * Handing the object form to a browser that only knows the callback form makes
 * it try to *call* the object, so this is a real guard rather than tidiness.
 *
 * Probed through the selector because that is the half the CSS depends on —
 * a browser that matched the selector but ignored the types would animate
 * nothing, which is the same outcome as having no types at all.
 */
const SUPPORTS_TRANSITION_TYPES =
  typeof CSS !== 'undefined' &&
  CSS.supports('selector(:active-view-transition-type(forward))');

/** Narrows a `composedPath()` entry to the link that was clicked. */
const isAnchor = (target: EventTarget): target is HTMLAnchorElement =>
  target instanceof HTMLAnchorElement;

/**
 * Client-side routing on the Navigation API.
 *
 * Holds the current pathname and swaps it inside a view transition, then hands
 * control back to the host through `beforeRender` / `afterRender`. The route
 * table itself stays in `app-root` — this owns the *mechanics* of getting from
 * a `navigate` event to a re-render, which is exactly the kind of cross-cutting
 * plumbing that belongs in a controller rather than a `connectedCallback`.
 *
 * It also gets the listener torn down. The version of this that lived inline in
 * `app-root.connectedCallback` added a `navigate` listener and never removed
 * it — harmless for a singleton shell, but it was the one listener in the app
 * outliving its host, and it made the route table untestable without mounting
 * the whole shell.
 *
 * **Where the Navigation API is missing** — Safari before 26.2 and Firefox
 * before 147, so two of the three engines at the project's stated floor — this
 * subscribes to nothing and every `<a href>` does a real page load instead.
 * That is the ordinary case on iOS today rather than an edge case, and it costs
 * every route animation: `startViewTransition` below is never reached at all.
 * The service worker answers any path with the cached shell, so deep links
 * still resolve. Nothing to polyfill — but don't touch the global unguarded,
 * which would throw and take the shell down before anything renders.
 */
export class Router implements ReactiveController {
  /** The current pathname, decoded. Read this from the host's `render()`. */
  path: string;

  #host: ReactiveControllerHost;
  #options: RouterOptions;
  // Not `#abort?:` — `exactOptionalPropertyTypes` then refuses the reset below.
  #abort: AbortController | undefined;
  /** The history fallback's own `currentEntry.index`. Unused otherwise. */
  #index = 0;

  constructor(host: ReactiveControllerHost, options: RouterOptions = {}) {
    this.#host = host;
    this.#options = options;
    this.path = toAppPath(decodeURI(location.pathname));
    host.addController(this);
  }

  hostConnected() {
    // Re-read on connect for the same reason `MediaQuery` does: the answer can
    // have moved between construction and connection.
    this.path = toAppPath(decodeURI(location.pathname));

    // One signal tears every listener down, with no `removeEventListener`
    // bookkeeping and no handler reference to keep in sync.
    this.#abort = new AbortController();
    const { signal } = this.#abort;

    if ('navigation' in window && !this.#options.forceHistoryFallback) {
      navigation.addEventListener('navigate', this.#onNavigate, { signal });
      return;
    }

    this.#connectHistoryFallback(signal);
  }

  hostDisconnected() {
    this.#abort?.abort();
    this.#abort = undefined;
  }

  #onNavigate = (event: NavigateEvent) => {
    if (!event.canIntercept) return;

    // A reload has to stay a real reload. Intercepting it re-renders the same
    // view from the same already-loaded assets, which silently breaks both the
    // browser's refresh button and the service worker update flow, where
    // applying an update means reloading into the new build.
    if (event.navigationType === 'reload') return;

    const path = toAppPath(decodeURI(new URL(event.destination.url).pathname));
    const direction = this.#directionOf(event);
    event.intercept({ handler: () => this.#commit(path, direction) });
  };

  /**
   * Which way this navigation is going, for the view transition to animate.
   *
   * A `push` is always forward — it is a brand new entry, and `destination.index`
   * reads -1 because the entry does not exist yet. A traversal is the only case
   * with two real indices to compare, and it is the one that matters: the back
   * gesture and the app's own `goBack()` both land here, and both should undo
   * the animation that brought the user in rather than repeat it.
   *
   * `replace` gets no direction at all. It is not movement through the stack —
   * nothing was pushed and nothing was popped — so sliding for it would tell
   * the user something happened that didn't.
   */
  #directionOf(event: NavigateEvent): NavigationDirection | undefined {
    if (event.navigationType === 'push') return 'forward';
    if (event.navigationType !== 'traverse') return undefined;

    const from = navigation.currentEntry?.index;
    const to = event.destination.index;
    if (from === undefined || from < 0 || to < 0) return undefined;

    return to < from ? 'back' : 'forward';
  }

  // --- The history fallback ---
  //
  // Everything below runs only where there is no Navigation API. It rebuilds
  // the four things `#onNavigate` gets for free — link clicks, traversals, a
  // navigation type and an entry index — on top of `history` and a delegated
  // click listener, then hands the result to the same `#commit`. So the view
  // transitions, the types and both hooks are identical on either path; only
  // the plumbing that decides *when* to run them differs.
  //
  // Worth being clear about why this exists at all: on those browsers
  // `startViewTransition` was never reached, so the app had no route animation
  // whatsoever. Nothing here is a polyfill of the Navigation API — it is the
  // narrow slice of it this router actually uses.

  #connectHistoryFallback(signal: AbortSignal) {
    // Seed the entry the app booted on, so the first traversal has something
    // to compare against. `replaceState` is safe here in a way AGENTS.md warns
    // it is not elsewhere, and for the same reason: the warning is about it
    // firing a `navigate` event that this router would intercept, and there is
    // no Navigation API here to fire one.
    this.#index = historyIndex() ?? 0;
    stampHistoryIndex(this.#index);

    document.addEventListener('click', this.#onClick, { signal });
    window.addEventListener('popstate', this.#onPopState, { signal });
    window.addEventListener(APP_NAVIGATE, this.#onAppNavigate, { signal });
  }

  /**
   * A left-click on an in-app link, which the Navigation API would have
   * delivered as a `push`.
   *
   * The modifier and `target` checks are what keep "open in a new tab" working:
   * every one of them is a case where the user asked for something other than
   * an in-page navigation, and swallowing it would be a regression the
   * Navigation API path does not have.
   */
  #onClick = (event: MouseEvent) => {
    // `button !== 0` covers middle-click (open in a new tab) as well as right.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    // `composedPath()`, not `event.target`: every link in this app is rendered
    // inside a component's shadow root, and `target` retargets to the host
    // element — a `closest('a')` from there finds nothing at all.
    const anchor = event.composedPath().find(isAnchor);
    if (!anchor) return;
    if (anchor.target && anchor.target !== '_self') return;
    if (anchor.hasAttribute('download') || anchor.relList.contains('external')) return;

    const url = new URL(anchor.href);
    // Cross-origin, and also `mailto:`/`tel:`, whose origin is never ours.
    if (url.origin !== location.origin) return;
    // A pure fragment change belongs to the browser: it scrolls, and there is
    // no route to swap.
    if (url.pathname === location.pathname && url.hash) return;

    event.preventDefault();
    void this.#pushAndCommit(toAppPath(decodeURI(url.pathname)), url.href);
  };

  /** The back/forward gesture, which the Navigation API calls a `traverse`. */
  #onPopState = (event: PopStateEvent) => {
    // The URL has already moved by the time this fires, so `location` is the
    // destination rather than the origin.
    const path = toAppPath(decodeURI(location.pathname));

    // A fragment navigation is a same-document navigation, and the browser
    // reports it here as well — with the route unchanged. Committing it would
    // run a whole route transition over a page that never moved. Measured, not
    // theoretical: the suite caught this the first time it clicked an `#anchor`.
    //
    // Returning before `#index` is touched, not after: the entry a fragment
    // link pushes carries no stamp of ours, so reading one out of it would
    // overwrite a good position with a zero and leave the *next* real traversal
    // animating the wrong way.
    if (path === this.path) return;

    const to = historyIndex(event.state) ?? 0;
    const from = this.#index;
    this.#index = to;

    void this.#commit(path, to < from ? 'back' : 'forward');
  };

  /** A programmatic `navigateTo`, which is a push like any other. */
  #onAppNavigate = (event: Event) => {
    const { path } = (event as CustomEvent<AppNavigateDetail>).detail;
    // Claims it, so `navigateTo` does not also assign `location.href`.
    event.preventDefault();
    void this.#pushAndCommit(path, appHref(path));
  };

  /**
   * Commits the URL, then the render.
   *
   * This order is the Navigation API's: it has moved the address bar by the
   * time an intercept handler runs. It also leaves `#commit`'s own
   * `location.href` bail-out pointing at the right place, since the URL it
   * would reload is already the one on screen.
   */
  async #pushAndCommit(path: string, href: string) {
    this.#index += 1;
    pushHistoryEntry(this.#index, href);
    // A click is always a new entry, and `#directionOf` calls a push forward.
    await this.#commit(path, 'forward');
  }

  async #commit(path: string, direction?: NavigationDirection) {
    // Read before `#apply` overwrites it below — this is the one point where
    // both sides of the navigation are available at once.
    const previousPath = this.path;

    try {
      await this.#options.beforeRender?.(path);
    } catch (error) {
      // The only thing that throws here is a route chunk that would not load.
      // Rejecting the handler would leave the user on the old page with a URL
      // that says otherwise, so hand the navigation back to the browser: a real
      // page load boots the shell fresh and resolves the route from there.
      console.error('[router] Navigation impossible, rechargement complet :', path, error);
      location.href = appHref(path);
      return;
    }

    if (!('startViewTransition' in document)) {
      this.#apply(path);
      await this.#host.updateComplete;
    } else {
      const update = () => {
        this.#apply(path);
        return this.#host.updateComplete;
      };

      // The types are what let `main.css` slide forward and back differently
      // from one cross-fade rule, and what a route pair like home↔horse-view
      // can key its own animation off. Without them — or on a browser that
      // only has the callback form — this stays exactly the transition it was
      // before.
      const types = direction
        ? [direction, ...(this.#options.extraTransitionTypes?.(previousPath, path) ?? [])]
        : undefined;

      const transition =
        types && SUPPORTS_TRANSITION_TYPES
          ? document.startViewTransition({ update, types })
          : document.startViewTransition(update);

      // `ready` and `finished` reject with an AbortError whenever a transition
      // is skipped — which is routine, not exceptional: starting a second
      // navigation before the first has finished animating skips the first, and
      // so does `prefers-reduced-motion`, which this app honours by setting
      // `animation: none` on every ::view-transition pseudo-element. Nothing
      // awaits either promise, so an unclaimed rejection reaches the console as
      // an uncaught AbortError on a perfectly normal double-tap.
      //
      // Only `updateCallbackDone` is awaited, and it is the right one: it
      // resolves when the DOM swap has settled, which is what `afterRender`
      // needs, and it does not reject when the animation is skipped.
      transition.ready.catch(() => {});
      transition.finished.catch(() => {});

      await transition.updateCallbackDone;
    }

    await this.#options.afterRender?.(path);
  }

  #apply(path: string) {
    this.path = path;
    // A plain field rather than a reactive property: the host re-renders off
    // this one call, and nothing needs `changed.has('path')` now that the two
    // things that used to key off it are the hooks above.
    this.#host.requestUpdate();
  }
}
