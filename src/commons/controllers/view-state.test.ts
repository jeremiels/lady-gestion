import { html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fixture } from '../../components/__tests__/fixture.ts';
import { ViewState, clearViewState } from './view-state.ts';

/**
 * `ViewState` writes to the real `NavigationHistoryEntry`, and the whole point
 * of it is what survives a traversal — so this suite drives actual navigations
 * rather than stubbing the API it exists to wrap.
 *
 * The keeper is the same device `router.test.ts` uses, and for the same reason:
 * a navigation nothing intercepts is a real page load, which would tear the run
 * down mid-assertion. One listener for the file intercepts everything with a
 * no-op handler, so the URL and the entry stack really move while the document
 * stays put.
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
      event.intercept({ handler: async () => {} });
    },
    { signal: keeper.signal },
  );
});

afterAll(() => keeper.abort());

afterEach(async () => {
  if (location.href !== startUrl) await settleNavigation(startUrl, 'replace');
  // `fixture`'s own cleanup clears the entry the run started on; anything left
  // on an entry these tests pushed has to go too, or the next file inherits it.
  clearViewState();
});

const settleNavigation = async (path: string, history?: 'replace') => {
  const options = history ? { history } : {};
  await navigation.navigate(path, options).finished?.catch(() => {});
};

const go = settleNavigation;

const back = async () => {
  await navigation.back().finished?.catch(() => {});
};

type Bag = { mode: string; day: string };

const DEFAULTS = (): Bag => ({ mode: 'calendar', day: 'today' });

@customElement('view-state-test-host')
class ViewStateTestHost extends LitElement {
  readonly ui = new ViewState<Bag>(this, 'events', DEFAULTS);

  render() {
    return html`<span>${this.ui.value.mode}</span>`;
  }
}

const mount = () => fixture<ViewStateTestHost>(html`<view-state-test-host></view-state-test-host>`);

/** What is actually sitting on the entry, without going through the controller. */
const stored = (): unknown => navigation.currentEntry?.getState();

describe('ViewState', () => {
  it('starts from the defaults on an entry that has never been written to', async () => {
    const el = await mount();

    expect(el.ui.value).toEqual({ mode: 'calendar', day: 'today' });
    expect(stored()).toBeUndefined();
  });

  it('patch merges, re-renders the host, and writes through to the entry', async () => {
    const el = await mount();

    el.ui.patch({ mode: 'list' });
    await el.updateComplete;

    expect(el.ui.value).toEqual({ mode: 'list', day: 'today' });
    expect(el.renderRoot.textContent).toContain('list');
    expect(stored()).toEqual({ views: { events: { mode: 'list', day: 'today' } } });
  });

  it('restores what was stored when the entry is traversed back to', async () => {
    const el = await mount();
    el.ui.patch({ mode: 'list', day: '2026-03-04' });

    // Drilling into a detail page and coming back — the round trip the whole
    // controller exists for. The second mount stands in for the fresh element
    // `app-root` builds on the way out.
    await go('/events/some-id');
    const away = await mount();
    expect(away.ui.value).toEqual({ mode: 'calendar', day: 'today' });

    await back();
    const returned = await mount();

    // Pins the timing as much as the storage: the element is constructed inside
    // the intercept handler, so this only passes because `currentEntry` is
    // already the destination entry by the time `hostConnected` reads it.
    expect(returned.ui.value).toEqual({ mode: 'list', day: '2026-03-04' });
  });

  it('gives a pushed entry the defaults rather than the previous entry’s bag', async () => {
    const el = await mount();
    el.ui.patch({ mode: 'list' });

    // What tapping a nav item does. A fresh visit is a new entry, so it opens
    // as the page is meant to open.
    await go('/events');
    const pushed = await mount();

    expect(pushed.ui.value).toEqual({ mode: 'calendar', day: 'today' });
  });

  it('keeps two views on one entry out of each other’s way', async () => {
    const el = await mount();
    el.ui.patch({ mode: 'list' });

    const other = new ViewState<{ granularity: string }>(new StubHost(), 'expenses', () => ({
      granularity: 'month',
    }));
    other.patch({ granularity: 'year' });

    expect(stored()).toEqual({
      views: { events: { mode: 'list', day: 'today' }, expenses: { granularity: 'year' } },
    });
    expect(el.ui.value.mode).toBe('list');
  });

  it('leaves state this module did not write alone', async () => {
    navigation.updateCurrentEntry({ state: { somethingElse: 42 } });

    const el = await mount();
    el.ui.patch({ mode: 'list' });

    expect(stored()).toEqual({
      somethingElse: 42,
      views: { events: { mode: 'list', day: 'today' } },
    });

    clearViewState();
    expect(stored()).toEqual({ somethingElse: 42 });
  });

  it('ignores a stored bag that is not an object, and keys the defaults do not declare', async () => {
    navigation.updateCurrentEntry({ state: { views: 'nonsense' } });
    expect((await mount()).ui.value).toEqual({ mode: 'calendar', day: 'today' });

    navigation.updateCurrentEntry({ state: { views: { events: null } } });
    expect((await mount()).ui.value).toEqual({ mode: 'calendar', day: 'today' });

    // An entry written by an older build outlives the deploy, so a property the
    // view no longer declares must not reappear on it.
    navigation.updateCurrentEntry({ state: { views: { events: { mode: 'list', gone: true } } } });
    expect((await mount()).ui.value).toEqual({ mode: 'list', day: 'today' });
  });
});

/** Enough of a `ReactiveControllerHost` for a controller nothing renders. */
class StubHost {
  addController() {}
  removeController() {}
  requestUpdate() {}
  readonly updateComplete = Promise.resolve(true);
}
