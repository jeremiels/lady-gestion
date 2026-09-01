import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { fixture, settled } from '../__tests__/fixture.ts';
import './app-bottom-sheet.ts';
import type { AppBottomSheet } from './app-bottom-sheet.ts';

/**
 * Drag-to-dismiss, in a real browser because there is nowhere else to run it:
 * the gesture is built on pointer capture and `<dialog>.showModal()`, and the
 * three cases below are all about *which* pointer events reach the handler and
 * in what order — a mock of the event model would be testing the mock.
 */

const mount = async () => {
  const el = await fixture<AppBottomSheet>(
    html`<app-bottom-sheet heading="Ration"><p>Contenu</p></app-bottom-sheet>`,
  );
  el.show();
  await settled(el);
  sheets.add(el);
  return el;
};

const sheets = new Set<AppBottomSheet>();

/**
 * Closes anything still open before the fixture detaches it.
 *
 * A modal `<dialog>` removed from the document while open leaves the top layer
 * holding a reference to a detached element, and the next test's sheet then
 * behaves as though its own drag never happened. Tests that deliberately end
 * with the sheet still open — the cancel and non-dismissible cases — are
 * exactly the ones that would poison whatever ran next.
 */
afterEach(async () => {
  for (const el of sheets) {
    el.close();
    await settled(el);
    await wait(0);
  }
  sheets.clear();
});

const handleOf = (el: AppBottomSheet) => {
  const handle = el.renderRoot.querySelector<HTMLElement>('.sheet__handle')!;
  // Synthetic pointer events have no matching active pointer, so the real
  // `setPointerCapture` throws NotFoundError. Capture is not what these tests
  // are about — the handler runs identically with or without it.
  handle.setPointerCapture = () => {};
  return handle;
};

const pointer = (type: string, clientY: number, pointerId = 1) =>
  new PointerEvent(type, { pointerId, clientY, bubbles: true, composed: true });

/** Advances real time, because the velocity maths reads `performance.now()`. */
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Settles the component and drains the task queue, to show that nothing landed.
 *
 * Only for the assertions that a sheet did **not** dismiss: there is no event to
 * wait for when the whole claim is that none is coming, so draining a few turns
 * and looking is the only shape available.
 *
 * It is deliberately *not* how the positive cases wait any more — see
 * `dismissal` below for why that could never be made reliable.
 */
const flush = async (el: AppBottomSheet) => {
  for (let i = 0; i < 5; i++) {
    await settled(el);
    await wait(0);
  }
};

/**
 * Resolves when a dismissal actually lands.
 *
 * The three tests below that assert a sheet *did* dismiss used to wait on
 * `flush`, and that is precisely where this suite broke in CI and nowhere else.
 * `dialog.close()` shuts the dialog synchronously, but the native `close` event
 * is queued as a task and `sheet-close` is dispatched from its handler — so the
 * number of turns to drain before the count is readable is not a property of the
 * component, it is a property of how busy the machine is. Five was enough on a
 * quiet laptop and not enough on a loaded runner, and no larger number would
 * have been a fix so much as a longer bet.
 *
 * Waiting for the event has no such number in it. Bounded all the same, so a
 * real regression reports this message instead of hanging until the suite's own
 * timeout and blaming whatever ran next.
 */
const dismissal = (el: AppBottomSheet) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('sheet-close never fired — the sheet did not dismiss')),
      2000,
    );
    el.addEventListener(
      'sheet-close',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * Counts dismissals for one element with a counter of its own.
 *
 * Per element rather than a shared counter reset in `beforeEach`: a sheet left
 * open at the end of a test is torn down by the fixture, and anything that
 * queues off that teardown lands after the next test has already installed its
 * own counter — which is how a passing suite ends up attributing one test's
 * dismissal to the next one.
 *
 * A count rather than a list of close reasons, which is what this used to
 * collect: a drag is the only thing that closes a sheet in any test below, so
 * "did it dismiss" is the whole question and the reason added nothing to it.
 */
const watchCloses = (el: AppBottomSheet) => {
  const closes = { count: 0 };
  el.addEventListener('sheet-close', () => (closes.count += 1));
  return closes;
};

describe('app-bottom-sheet drag-to-dismiss', () => {

  it('dismisses on a drag past the distance threshold', async () => {
    const el = await mount();
    const closes = watchCloses(el);
    const dismissed = dismissal(el);
    const handle = handleOf(el);

    handle.dispatchEvent(pointer('pointerdown', 0));
    handle.dispatchEvent(pointer('pointermove', 200));
    handle.dispatchEvent(pointer('pointerup', 200));
    await dismissed;

    expect(closes.count).toBe(1);
  });

  /**
   * The platform taking the gesture away — a system edge-swipe, an incoming
   * call — must spring the sheet back, never commit the dismissal. Routing
   * `pointercancel` into the pointerup handler closed any sheet that happened
   * to be past the threshold when the interruption landed.
   */
  it('springs back instead of dismissing when the gesture is cancelled past the threshold', async () => {
    const el = await mount();
    const closes = watchCloses(el);
    const handle = handleOf(el);

    handle.dispatchEvent(pointer('pointerdown', 0));
    handle.dispatchEvent(pointer('pointermove', 200));
    handle.dispatchEvent(pointer('pointercancel', 200));
    await flush(el);

    expect(closes.count).toBe(0);
    expect(el.open).toBe(true);
    // Released back to the stylesheet, so the sheet transitions home.
    expect(el.renderRoot.querySelector<HTMLElement>('dialog')!.style.transform).toBe('');
  });

  /**
   * A slow drag that ends with a twitch is not a flick.
   *
   * With one velocity sample the measured window collapsed to however long it
   * had been since the last refresh, so the 2px of jitter as the finger leaves
   * the glass got divided by ~2ms — 1.0 px/ms, nine times the threshold — and
   * the sheet dismissed out from under a gesture that had been crawling. The
   * drag below averages 0.04 px/ms over its whole life; nothing about it is a
   * flick except the last two milliseconds.
   */
  it('does not dismiss when a slow drag ends in a twitch', async () => {
    const el = await mount();
    const closes = watchCloses(el);
    const handle = handleOf(el);

    handle.dispatchEvent(pointer('pointerdown', 0));
    handle.dispatchEvent(pointer('pointermove', 10));
    await wait(300);
    handle.dispatchEvent(pointer('pointermove', 20));
    await wait(300);
    handle.dispatchEvent(pointer('pointermove', 30));
    await wait(200);
    handle.dispatchEvent(pointer('pointermove', 31));
    // The twitch, immediately before the finger leaves the glass.
    handle.dispatchEvent(pointer('pointerup', 33));
    await flush(el);

    expect(closes.count).toBe(0);
    expect(el.open).toBe(true);
  });

  it('still dismisses on a genuine flick that never crosses the distance threshold', async () => {
    const el = await mount();
    const closes = watchCloses(el);
    const dismissed = dismissal(el);
    const handle = handleOf(el);

    handle.dispatchEvent(pointer('pointerdown', 0));
    handle.dispatchEvent(pointer('pointermove', 10));
    await wait(120);
    // ~60px in the few ms after the sample aged — a flick, well under 120px.
    handle.dispatchEvent(pointer('pointermove', 20));
    handle.dispatchEvent(pointer('pointerup', 80));
    await dismissed;

    expect(closes.count).toBe(1);
  });

  /**
   * A second finger landing mid-drag used to re-anchor `#dragStartY` on itself,
   * so the sheet jumped to meet it and the accumulated distance was lost.
   */
  it('ignores a second pointer that lands mid-drag', async () => {
    const el = await mount();
    const closes = watchCloses(el);
    const dismissed = dismissal(el);
    const handle = handleOf(el);
    const dialog = el.renderRoot.querySelector<HTMLElement>('dialog')!;

    handle.dispatchEvent(pointer('pointerdown', 0));
    handle.dispatchEvent(pointer('pointermove', 200));

    // Second finger, far up the screen. It must not re-anchor or steal the drag.
    handle.dispatchEvent(pointer('pointerdown', 500, 2));
    handle.dispatchEvent(pointer('pointermove', 500, 2));
    expect(dialog.style.transform).toBe('translateY(200px)');

    // The owning pointer still decides, and still sees its full 200px.
    handle.dispatchEvent(pointer('pointerup', 200, 1));
    await dismissed;

    expect(closes.count).toBe(1);
  });

  it('does not drag at all when the sheet is not dismissible', async () => {
    const el = await fixture<AppBottomSheet>(
      html`<app-bottom-sheet heading="Ration" .dismissible=${false}></app-bottom-sheet>`,
    );
    el.show();
    await settled(el);
    const closes = watchCloses(el);
    const handle = handleOf(el);

    handle.dispatchEvent(pointer('pointerdown', 0));
    handle.dispatchEvent(pointer('pointermove', 300));
    handle.dispatchEvent(pointer('pointerup', 300));
    await flush(el);

    expect(closes.count).toBe(0);
    expect(el.renderRoot.querySelector<HTMLElement>('dialog')!.style.transform).toBe('');
  });
});
