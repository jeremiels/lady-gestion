import { html } from 'lit';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db.ts';
import { addMonths, todayISO } from '../data/index.ts';
import { makeEvent, makeHorse, resetDb } from '../data/__tests__/factories.ts';
import { fixture, settled, waitFor } from '../components/__tests__/fixture.ts';
import { eventType } from '../types/event.types.ts';
import './ExpensesView.ts';
import type { ExpensesView } from './ExpensesView.ts';

const mount = () => fixture<ExpensesView>(html`<expenses-view></expenses-view>`);

const ledgerIds = (el: ExpensesView) =>
  [...el.querySelectorAll('event-card')].map((card) => card.event?.id).sort();

const setGranularity = async (el: ExpensesView, value: 'month' | 'year') => {
  el.querySelector('app-segmented')!.dispatchEvent(
    new CustomEvent('segment-change', { detail: { value }, bubbles: true, composed: true }),
  );
  await settled(el);
};

const switchToYear = (el: ExpensesView) => setGranularity(el, 'year');

const pickPeriod = async (el: ExpensesView, key: string) => {
  el.querySelector('app-select')!.dispatchEvent(
    new CustomEvent('select-change', { detail: { value: key }, bubbles: true, composed: true }),
  );
  await settled(el);
};

beforeEach(async () => {
  await resetDb();
  await db.horses.add(makeHorse());
});

describe('expenses-view', () => {
  it('defaults to this month, split by type, and drops a cancelled entry', async () => {
    await db.events.bulkAdd([
      makeEvent({ id: 'this-month-veto', type: 'veto', date: todayISO(), amountCents: 4000 }),
      makeEvent({ id: 'this-month-marechal', type: 'marechal', date: todayISO(), amountCents: 6000 }),
      makeEvent({ id: 'last-month', type: 'veto', date: addMonths(todayISO(), -1), amountCents: 9999 }),
      makeEvent({ id: 'cancelled', type: 'veto', date: todayISO(), amountCents: 1000, status: 'cancelled' }),
    ]);

    const el = await mount();
    await waitFor(el, () => el.querySelectorAll('event-card').length > 0);

    expect(ledgerIds(el)).toEqual(['this-month-marechal', 'this-month-veto']);

    const legendLabels = [...el.querySelectorAll('.expenses-view__legend-label')].map((node) =>
      node.textContent?.trim(),
    );
    expect(legendLabels).toEqual(
      expect.arrayContaining([eventType.label('veto'), eventType.label('marechal')]),
    );
  });

  it('switching to year widens the period without reaching into last year', async () => {
    await db.events.bulkAdd([
      makeEvent({ id: 'this-month', date: todayISO(), amountCents: 1000 }),
      makeEvent({ id: 'last-month', date: addMonths(todayISO(), -1), amountCents: 2000 }),
      // 13 months back always lands outside the current year, whatever month
      // this test happens to run in.
      makeEvent({ id: 'last-year', date: addMonths(todayISO(), -13), amountCents: 3000 }),
    ]);

    const el = await mount();
    await waitFor(el, () => el.querySelectorAll('event-card').length > 0);
    expect(ledgerIds(el)).toEqual(['this-month']);

    await switchToYear(el);

    expect(ledgerIds(el)).toEqual(['last-month', 'this-month']);
  });

  /**
   * The round trip the `ViewState` controller exists for.
   *
   * Two mounts stand in for what `app-root` really does — its route template
   * changes on the way to an expense's page, so lit-html discards this element
   * and builds a fresh one on the way back.
   */
  it('reopens on the period the visit was left on, month and year still held apart', async () => {
    const lastYear = addMonths(todayISO(), -13);
    await db.events.bulkAdd([
      makeEvent({ id: 'this-month', date: todayISO(), amountCents: 1000 }),
      makeEvent({ id: 'back-then', date: lastYear, amountCents: 3000 }),
    ]);

    const el = await mount();
    await waitFor(el, () => el.querySelectorAll('event-card').length > 0);
    await switchToYear(el);
    await pickPeriod(el, lastYear.slice(0, 4));
    expect(ledgerIds(el)).toEqual(['back-then']);

    const reopened = await mount();
    await waitFor(reopened, () => reopened.querySelectorAll('event-card').length > 0);
    expect(ledgerIds(reopened)).toEqual(['back-then']);

    // The two keys survive the round trip separately, which is the whole reason
    // they are stored separately: flipping back to Mois returns to the month
    // that was selected rather than guessing one out of the year.
    await setGranularity(reopened, 'month');
    expect(ledgerIds(reopened)).toEqual(['this-month']);
  });

  /**
   * The invariant `views/expenses.css` leans on for its `@starting-style`
   * fade: `render()` sorts every period with the same `byDateDescending`, so
   * this month's rows are a contiguous block of the year's rows. Widening
   * Mois→Année only inserts rows before and after that block, so the
   * survivors never have to move — and a moved node (an `insertBefore` that
   * detaches and re-inserts) would re-fade from zero, which is what the CSS
   * is relying on not happening.
   *
   * Asserted on the `<li>` nodes themselves, not on ids: identity is what
   * proves `repeat()` reused the row instead of rebuilding it, and relative
   * order is what proves it never had to move one.
   */
  it('keeps surviving rows as the same nodes, in order, when switching Mois to Année', async () => {
    await db.events.bulkAdd([
      makeEvent({ id: 'this-month', date: todayISO(), amountCents: 1000 }),
      makeEvent({ id: 'last-month', date: addMonths(todayISO(), -1), amountCents: 2000 }),
    ]);

    const el = await mount();
    await waitFor(el, () => el.querySelectorAll('event-card').length > 0);

    const rowFor = (id: string) =>
      [...el.querySelectorAll('.expenses-view__list > li')].find(
        (li) => li.querySelector('event-card')?.event?.id === id,
      );
    const before = rowFor('this-month');
    expect(before).toBeDefined();

    await switchToYear(el);

    const after = [...el.querySelectorAll('.expenses-view__list > li')];
    expect(after.map((li) => li.querySelector('event-card')?.event?.id)).toEqual(['this-month', 'last-month']);
    expect(after[0]).toBe(before);
  });
});
