import { html } from 'lit';
import { describe, expect, it } from 'vitest';
import { fixture, settled } from '../__tests__/fixture.ts';
import './app-donut-chart.ts';
import type { AppDonutChart, DonutSlice } from './app-donut-chart.ts';

const SLICES: DonutSlice[] = [
  { id: 'a', label: 'Alpha', value: 60, color: 'red' },
  { id: 'b', label: 'Bravo', value: 30, color: 'green' },
  { id: 'c', label: 'Charlie', value: 10, color: 'blue' },
];

const mount = () =>
  fixture<AppDonutChart>(
    html`<app-donut-chart
      .slices=${SLICES}
      .formatValue=${(value: number) => String(Math.round(value))}
    ></app-donut-chart>`,
  );

const shadow = (el: AppDonutChart) => el.shadowRoot!;
/** Every drawn wedge, which is every path but the empty-state ring behind them. */
const wedges = (el: AppDonutChart) => [...shadow(el).querySelectorAll('path:not(.donut__track)')];
const track = (el: AppDonutChart) => shadow(el).querySelector('.donut__track');
const centre = (el: AppDonutChart) => shadow(el).querySelector('.donut__value')!.textContent!.trim();
const description = (el: AppDonutChart) => shadow(el).querySelector('svg')!.getAttribute('aria-label');

const tick = async (el: AppDonutChart) => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await settled(el);
};

/**
 * Waits in real time for the chart to reach a state.
 *
 * `waitFor` from the fixture polls on `setTimeout(0)`, which is a few
 * milliseconds all told — right for a `LiveQuery`'s first value, nowhere near
 * the second the entrance sweep runs for. Bounded for the same reason it is:
 * an animation that never arrives should fail the run, not hang it.
 */
const untilChart = async (el: AppDonutChart, predicate: () => boolean) => {
  for (let i = 0; i < 60 && !predicate(); i++) await tick(el);
  if (!predicate()) throw new Error(`chart never reached the expected state (centre: ${centre(el)})`);
};

/**
 * Waits until the chart stops redrawing itself.
 *
 * Watching the output rather than the clocks: `progress` and `morph` are
 * private, and waiting on the centre figure alone is not enough — it rounds
 * onto its final value while the wedges still have a fifth of their travel
 * left, so a wedge count taken there would still see the one that is closing.
 * Two identical frames 50ms apart cannot happen while a loop is running: every
 * frame rewrites each wedge's `d` to a dozen decimal places.
 */
const drawn = async (el: AppDonutChart) => {
  let previous = '';
  for (let i = 0; i < 60; i++) {
    await tick(el);
    const current = shadow(el).innerHTML;
    if (current === previous) return;
    previous = current;
  }
  throw new Error('chart never stopped animating');
};

describe('app-donut-chart', () => {
  it('draws one wedge per slice and totals them', async () => {
    const el = await mount();
    await drawn(el);

    expect(wedges(el)).toHaveLength(3);
    expect(centre(el)).toBe('100');
    expect(description(el)).toBe('Répartition : Alpha 60 %, Bravo 30 %, Charlie 10 %');
  });

  it('hiding a slice takes it out of the ring, the total and the description', async () => {
    const el = await mount();
    await drawn(el);

    el.hiddenIds = ['b'];
    await drawn(el);

    expect(wedges(el)).toHaveLength(2);
    expect(centre(el)).toBe('70');
    // Re-based on what is left, not on the period's total: a ring that adds up
    // to 100% of nothing it is showing is worse than no percentages at all.
    expect(description(el)).toBe('Répartition : Alpha 86 %, Charlie 14 %');
  });

  it('shows it again when it leaves the hidden set', async () => {
    const el = await mount();
    await drawn(el);

    el.hiddenIds = ['b'];
    await drawn(el);
    el.hiddenIds = [];
    await drawn(el);

    expect(wedges(el)).toHaveLength(3);
    expect(centre(el)).toBe('100');
  });

  /**
   * The centre figure counts rather than cutting, which is the observable half
   * of the redistribution — the wedges' own travel is geometry the DOM does not
   * expose. Caught on the first poll after the toggle rather than at a fixed
   * offset into it, so a slow machine widens the window instead of missing it.
   */
  it('counts the centre figure between the two totals rather than snapping', async () => {
    const el = await mount();
    await drawn(el);

    el.hiddenIds = ['b'];
    await settled(el);
    expect(centre(el)).toBe('100');

    await untilChart(el, () => centre(el) !== '100');
    expect(Number(centre(el))).toBeGreaterThan(70);

    await drawn(el);
    expect(centre(el)).toBe('70');
  });

  it('reveals the track and empties the figure when every slice is hidden', async () => {
    const el = await mount();
    await drawn(el);

    el.hiddenIds = ['a', 'b', 'c'];
    await drawn(el);

    expect(wedges(el)).toHaveLength(0);
    expect(track(el)).not.toBeNull();
    expect(centre(el)).toBe('0');
    // Told apart from a period with nothing in it: only one of the two is
    // fixed by tapping the legend.
    expect(description(el)).toBe('Aucune catégorie affichée');
  });

  it('stops its frame loop when it leaves the document', async () => {
    const el = await mount();
    await drawn(el);

    el.hiddenIds = ['b'];
    await untilChart(el, () => centre(el) !== '100');
    el.remove();

    const atRemoval = centre(el);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await settled(el);

    expect(centre(el)).toBe(atRemoval);
  });
});
