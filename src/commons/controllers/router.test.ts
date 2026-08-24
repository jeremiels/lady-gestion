import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fixture } from '../../components/__tests__/fixture.ts';
import { Router, type RouterOptions } from './router.ts';

/**
 * `Router` is the one controller with nothing between it and the browser: it
 * subscribes to the real `navigate` event, awaits a route's chunk, and drives
 * the DOM swap inside a real view transition. None of that is observable
 * without a real Navigation API, so this suite drives actual navigations rather
 * than synthesising events — `NavigateEvent` is not constructible, and a
 * hand-rolled stand-in would be testing a mock of the exact thing at risk.
 *
 * **The keeper below is what makes that safe.** Every test here navigates the
 * page it is running in. A navigation nothing intercepts is a real page load,
 * which would tear down the test run mid-assertion — including the two cases
 * that exist precisely to check the router *doesn't* intercept. So one listener
 * is installed for the whole file that intercepts everything with a no-op
 * handler: the URL still changes, the router under test still sees the event,
 * and the document never actually unloads.
 */

let keeper: AbortController;
let startUrl: string;

beforeAll(() => {
  startUrl = location.href;
  keeper = new AbortController();
  navigation.addEventListener(
    'navigate',
    (event) => {
      if (!event.canIntercept || event.navigationType === 'reload') return;
      // Registered before any router under test, but interception is not
      // exclusive — every handler for the event runs, so this does not stop the
      // router from doing its own work.
      event.intercept({ handler: async () => {} });
    },
    { signal: keeper.signal },
  );
});

afterAll(() => keeper.abort());

afterEach(async () => {
  // Back to where the runner started, so the next test reads the URL it expects
  // and the run does not drift somewhere the harness cannot recover from.
  if (location.href !== startUrl) await settleNavigation(startUrl, 'replace');
});

/**
 * Navigates and waits for every intercept handler to settle.
 *
 * `finished` is optional in the DOM types because a navigation the browser
 * refuses outright returns a bare object — and a rejection here is expected
 * (the fallback test deliberately makes one), so both are swallowed.
 */
const settleNavigation = async (path: string, history?: 'replace') => {
  const options = history ? { history } : {};
  await navigation.navigate(path, options).finished?.catch(() => {});
};

const go = settleNavigation;

/** The back gesture and `goBack()` both arrive as a traversal. */
const back = async () => {
  await navigation.back().finished?.catch(() => {});
};

/*
 * The direction assertions below only mean anything where the browser
 * understands view-transition *types*. `Router` feature-detects that and stays
 * on the plain callback form otherwise, at which point there is no direction to
 * read back — so the tests state the condition rather than quietly asserting
 * whatever the runner happens to support.
 */
const supportsTypes = CSS.supports('selector(:active-view-transition-type(forward))');

@customElement('router-test-host')
class RouterTestHost extends LitElement {
  options: RouterOptions = {};
  renders = 0;

  // Proves the host actually re-rendered, rather than just that `path` moved.
  @state() accessor _unused = 0;

  readonly router = new Router(this, {
    beforeRender: (p) => this.options.beforeRender?.(p),
    afterRender: (p) => this.options.afterRender?.(p),
  });

  render() {
    this.renders++;
    return html`<span>${this.router.path}</span>`;
  }
}

const mount = (options: RouterOptions = {}) =>
  fixture<RouterTestHost>(html`<router-test-host></router-test-host>`).then((el) => {
    el.options = options;
    return el;
  });

describe('Router', () => {
  it('starts on the pathname the page was loaded with', async () => {
    const el = await mount();
    expect(el.router.path).toBe(decodeURI(location.pathname));
  });

  it('swaps the path and re-renders the host on a same-origin navigation', async () => {
    const el = await mount();
    const before = el.renders;

    await go('/events');

    expect(el.router.path).toBe('/events');
    expect(el.renders).toBeGreaterThan(before);
    expect(el.renderRoot.textContent).toContain('/events');
  });

  it('decodes the pathname', async () => {
    const el = await mount();

    await go('/events/caf%C3%A9');

    // The route table slices ids straight off this string, so a still-encoded
    // path would look up a record whose id nothing in the database matches.
    expect(el.router.path).toBe('/events/café');
  });

  it('runs beforeRender before the swap and afterRender after it', async () => {
    const order: string[] = [];
    const el = await mount({
      beforeRender: (path) => {
        // The swap has not happened yet: this is where a route's chunk is
        // awaited, and rendering before it lands renders an undefined element.
        order.push(`before:${el.router.path}`);
        void path;
      },
      afterRender: () => {
        order.push(`after:${el.router.path}`);
      },
    });

    const origin = el.router.path;
    await go('/documents');

    expect(order).toEqual([`before:${origin}`, 'after:/documents']);
  });

  it('waits for beforeRender to resolve before rendering the new path', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let pathWhenGateOpened = '';

    const el = await mount({
      beforeRender: async () => {
        await gate;
        pathWhenGateOpened = el.router.path;
      },
    });

    const origin = el.router.path;
    const navigated = go('/profile');

    // Still on the old path while the chunk is notionally in flight.
    expect(el.router.path).toBe(origin);

    release();
    await navigated;

    expect(pathWhenGateOpened).toBe(origin);
    expect(el.router.path).toBe('/profile');
  });

  it('wraps the swap in a view transition', async () => {
    const el = await mount();
    const spy = vi.spyOn(document, 'startViewTransition');

    try {
      await go('/documents');
      expect(spy).toHaveBeenCalledTimes(1);
      // The update callback must return the host's update, or the transition
      // snapshots the old DOM and cross-fades it with itself.
      expect(el.router.path).toBe('/documents');
    } finally {
      spy.mockRestore();
    }
  });

  /*
   * NOT TESTED HERE: the `beforeRender` throws -> `location.href = path`
   * fallback.
   *
   * That path deliberately asks the browser for a *real* page load, and this
   * suite runs inside the test runner's own iframe. The keeper above cannot
   * save it: the assignment re-enters navigation while the first one is still
   * inside its intercept handler, the original `finished` promise never
   * settles, and the runner loses the iframe it needs to report results —
   * every test in the file then fails for a reason unrelated to the router.
   *
   * It is genuinely reachable in production (a route chunk that will not load,
   * which offline is a precache miss) and worth covering, but it needs a
   * harness that owns a whole page — a Playwright test driving `npm run
   * preview` — not a component fixture. Left uncovered on purpose rather than
   * covered badly.
   */

  it.skipIf(!supportsTypes)(
    'tags a push forward and a traversal back, so back undoes the way in',
    async () => {
      await mount();
      const spy = vi.spyOn(document, 'startViewTransition');

      try {
        await go('/events');
        // The object form, because there is a direction to carry. `main.css`
        // reads it through `:root:active-view-transition-type(...)`; without it
        // both directions would slide the same way.
        expect(spy.mock.calls[0]?.[0]).toMatchObject({ types: ['forward'] });

        await back();
        expect(spy.mock.calls[1]?.[0]).toMatchObject({ types: ['back'] });
      } finally {
        spy.mockRestore();
      }
    },
  );

  it('gives a replace no direction at all', async () => {
    await mount();
    const spy = vi.spyOn(document, 'startViewTransition');

    try {
      await go('/profile', 'replace');

      // The bare callback form, not an object with an empty `types`: nothing
      // moved through the history stack, so the cross-fade is the honest
      // animation and there is no type for the CSS to have to ignore.
      expect(typeof spy.mock.calls[0]?.[0]).toBe('function');
    } finally {
      spy.mockRestore();
    }
  });

  it('stops listening once the host disconnects', async () => {
    const beforeRender = vi.fn();
    const el = await mount({ beforeRender });

    el.remove();
    await go('/events');

    // The keeper is what makes this assertable: with the router's listener gone
    // this navigation is nobody's to intercept, and without the keeper it would
    // be a real page load rather than a failed expectation.
    expect(beforeRender).not.toHaveBeenCalled();
    expect(el.router.path).not.toBe('/events');
  });
});
