import { html } from 'lit';
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../../data/icalendar.ts';
import { fixture, settled } from '../__tests__/fixture.ts';
import './app-calendar.ts';
import type { AppCalendar } from './app-calendar.ts';

/** A Sunday mid-month, so every arrow key has somewhere to go in both directions. */
const ANCHOR = '2026-03-15';

/**
 * A single all-day occurrence. Built in full rather than partially, because the
 * calendar hands these straight to `occurrencesByDate`, which walks `end` — a
 * half-built literal fails inside date arithmetic rather than at the boundary.
 */
const calendarEvent = (uid: string, start: string): CalendarEvent => ({
  uid,
  start,
  startTime: null,
  end: null,
  status: 'CONFIRMED',
  summary: `Évènement ${uid}`,
  categories: [],
});

const mount = () =>
  fixture<AppCalendar>(
    html`<app-calendar .value=${ANCHOR} .today=${ANCHOR} week-start="MO"></app-calendar>`,
  );

/** The day currently holding the grid's single tab stop. */
const tabStop = (el: AppCalendar) =>
  el.renderRoot.querySelector<HTMLButtonElement>('.calendar__day[tabindex="0"]');

const press = async (el: AppCalendar, key: string, init: KeyboardEventInit = {}) => {
  el.renderRoot
    .querySelector('.calendar__grid')!
    .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  await settled(el);
};

/**
 * The ARIA grid pattern is the whole point of this component and none of it is
 * expressible without a real browser: a roving tabindex is only meaningful
 * against actual focus, and the month arithmetic crosses boundaries the grid
 * has to follow on its own.
 */
describe('app-calendar', () => {
  describe('roving tab stop', () => {
    it('gives the grid exactly one tab stop', async () => {
      const el = await mount();

      const stops = el.renderRoot.querySelectorAll('.calendar__day[tabindex="0"]');
      expect(stops).toHaveLength(1);
      expect(tabStop(el)?.textContent?.trim()).toBe('15');
    });

    it('leaves every other day out of the tab order', async () => {
      const el = await mount();

      const days = [...el.renderRoot.querySelectorAll('.calendar__day')];
      expect(days.length).toBeGreaterThan(28);
      expect(days.filter((day) => day.getAttribute('tabindex') === '-1')).toHaveLength(
        days.length - 1,
      );
    });
  });

  describe('arrow keys', () => {
    it.each([
      ['ArrowRight', '16'],
      ['ArrowLeft', '14'],
      ['ArrowDown', '22'],
      ['ArrowUp', '8'],
    ])('%s moves the tab stop to %s', async (key, expected) => {
      const el = await mount();
      await press(el, key);

      expect(tabStop(el)?.textContent?.trim()).toBe(expected);
    });

    it('moves without selecting', async () => {
      const el = await mount();
      await press(el, 'ArrowRight');

      // The selected day is still the 15th — arrows move focus, Enter commits.
      expect(el.value).toBe(ANCHOR);
      expect(el.renderRoot.querySelector('.calendar__day--selected')?.textContent?.trim()).toBe(
        '15',
      );
    });

    it('cancels the event so the page does not scroll', async () => {
      const el = await mount();
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      });

      el.renderRoot.querySelector('.calendar__grid')!.dispatchEvent(event);
      await settled(el);

      expect(event.defaultPrevented).toBe(true);
    });

    it('ignores keys it does not handle', async () => {
      const el = await mount();
      const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });

      el.renderRoot.querySelector('.calendar__grid')!.dispatchEvent(event);
      await settled(el);

      expect(event.defaultPrevented).toBe(false);
      expect(tabStop(el)?.textContent?.trim()).toBe('15');
    });
  });

  describe('Home and End', () => {
    it('Home goes to the start of the week, which is Monday here', async () => {
      const el = await mount();
      await press(el, 'Home');

      // 15 March 2026 is a Sunday, so with WKST=MO its week starts on the 9th.
      expect(tabStop(el)?.textContent?.trim()).toBe('9');
    });

    it('End goes to the last day of the same week', async () => {
      const el = await mount();
      await press(el, 'End');

      expect(tabStop(el)?.textContent?.trim()).toBe('15');
    });
  });

  describe('crossing a month boundary', () => {
    it('pulls the visible month along and announces it', async () => {
      const el = await mount();
      const months: string[] = [];
      el.addEventListener('month-change', (event) => {
        months.push((event as CustomEvent<{ month: string }>).detail.month);
      });

      await press(el, 'PageDown');

      expect(months).toEqual(['2026-04-01']);
      expect(tabStop(el)?.textContent?.trim()).toBe('15');
      // `formatMonthYear` upper-cases the first letter, which `fr-FR` does not.
      expect(el.renderRoot.querySelector('.calendar__month')?.textContent?.trim()).toBe(
        'Avril 2026',
      );
    });

    it('PageUp with Shift moves a year', async () => {
      const el = await mount();
      await press(el, 'PageUp', { shiftKey: true });

      expect(el.renderRoot.querySelector('.calendar__month')?.textContent).toContain('2025');
    });

    it('keeps the focused day inside a shorter month', async () => {
      const el = await fixture<AppCalendar>(
        html`<app-calendar .value=${'2026-01-31'} .today=${ANCHOR} week-start="MO"></app-calendar>`,
      );

      // The month arrow, not a key: this is the path that clamps.
      el.renderRoot.querySelectorAll<HTMLButtonElement>('.calendar__nav')[1]!.click();
      await settled(el);

      expect(el.renderRoot.querySelector('.calendar__month')?.textContent?.trim()).toBe(
        'Février 2026',
      );
      // 31 January has no counterpart in February, so it clamps to the 28th
      // rather than spilling into March.
      expect(tabStop(el)?.textContent?.trim()).toBe('28');
    });
  });

  describe('selection', () => {
    it('Enter selects the focused day and says so', async () => {
      const el = await mount();
      const selected: string[] = [];
      el.addEventListener('date-select', (event) => {
        selected.push((event as CustomEvent<{ date: string }>).detail.date);
      });

      await press(el, 'ArrowRight');
      await press(el, 'Enter');

      expect(selected).toEqual(['2026-03-16']);
      expect(el.value).toBe('2026-03-16');
      expect(el.renderRoot.querySelector('.calendar__day--selected')?.textContent?.trim()).toBe(
        '16',
      );
    });

    it('Space selects too, and does not also re-trigger the button', async () => {
      const el = await mount();
      const selected: string[] = [];
      el.addEventListener('date-select', (event) => {
        selected.push((event as CustomEvent<{ date: string }>).detail.date);
      });

      await press(el, ' ');

      expect(selected).toEqual([ANCHOR]);
    });

    it('clicking a day selects it', async () => {
      const el = await mount();
      const selected: string[] = [];
      el.addEventListener('date-select', (event) => {
        selected.push((event as CustomEvent<{ date: string }>).detail.date);
      });

      const days = [...el.renderRoot.querySelectorAll<HTMLButtonElement>('.calendar__day')];
      days.find((day) => day.textContent?.trim() === '20')!.click();
      await settled(el);

      expect(selected).toEqual(['2026-03-20']);
    });
  });

  describe('accessible names', () => {
    it('marks today with aria-current', async () => {
      const el = await mount();

      const today = el.renderRoot.querySelector('.calendar__day--today');
      expect(today?.getAttribute('aria-current')).toBe('date');
      expect(today?.textContent?.trim()).toBe('15');
    });

    it('spells out the event count, which the dot cannot', async () => {
      const el = await fixture<AppCalendar>(html`
        <app-calendar
          .value=${ANCHOR}
          .today=${ANCHOR}
          week-start="MO"
          .events=${[calendarEvent('a', '2026-03-20'), calendarEvent('b', '2026-03-20')]}
        ></app-calendar>
      `);

      const days = [...el.renderRoot.querySelectorAll('.calendar__day')];
      const day20 = days.find((day) => day.textContent?.trim() === '20');

      expect(day20?.getAttribute('aria-label')).toContain('2 évènements');
    });
  });
});
