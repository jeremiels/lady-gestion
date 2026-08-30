import { html } from 'lit';
import { describe, expect, it } from 'vitest';
import type { WorkActivity } from '../../data/events.ts';
import { fixture } from '../__tests__/fixture.ts';
import './day-card.ts';
import type { DayCard } from './day-card.ts';

/** A Monday, so the weekday label is one the assertion can name. */
const MONDAY = '2026-08-10';

const mount = (activity: WorkActivity | null, today = false) =>
  fixture<DayCard>(
    html`<day-card .date=${MONDAY} .activity=${activity} ?today=${today}></day-card>`,
  );

const textOf = (el: DayCard, selector: string) =>
  el.renderRoot.querySelector(selector)?.textContent?.trim() ?? '';

describe('day-card', () => {
  it('names the day and shows the session in French', async () => {
    const el = await mount('longe');

    expect(textOf(el, '.day__weekday')).toBe('LUN');
    expect(textOf(el, '.day__number')).toBe('10');
    // The label, not the stored key — the card resolves it from the taxonomy.
    expect(textOf(el, '.day__activity')).toBe('Longe');
  });

  it('carries the machine-readable date, whatever the display format', async () => {
    const el = await mount(null);

    expect(el.renderRoot.querySelector('time')?.getAttribute('datetime')).toBe(MONDAY);
  });

  it('keeps the activity line on a day with nothing in it', async () => {
    const el = await mount(null);

    // Present but empty: an absent line would make the day shorter than its
    // neighbours and pull the numbers out of alignment across the row.
    const line = el.renderRoot.querySelector('.day__activity');
    expect(line).not.toBeNull();
    expect(line?.textContent?.trim()).toBe('');
  });

  it('marks today, and only when told to', async () => {
    const plain = await mount('plat');
    expect(plain.hasAttribute('today')).toBe(false);
    expect(plain.renderRoot.querySelector('time')?.hasAttribute('aria-current')).toBe(false);

    const today = await mount('plat', true);
    // Reflected, because `:host([today])` is what paints the second style.
    expect(today.hasAttribute('today')).toBe(true);
    expect(today.renderRoot.querySelector('time')?.getAttribute('aria-current')).toBe('date');
  });
});
