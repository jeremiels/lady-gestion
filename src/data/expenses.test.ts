import { describe, expect, it } from 'vitest';
import {
  byDateDescending,
  formatPeriod,
  formatPeriodHeading,
  formatPeriodNote,
  inPeriod,
  periodOf,
  periodOptions,
  sumByType,
  sumSlices,
  type ExpensePeriod,
} from './expenses.ts';
import { makeEvent } from './__tests__/factories.ts';
import type { HorseEvent } from './types.ts';

/**
 * These are pure functions over records the caller fetched, so the fixtures are
 * built straight from the factory — no database, no `resetDb`.
 */
const expense = (
  date: string,
  type: HorseEvent['type'],
  amountCents: number,
  over: Partial<HorseEvent> = {},
): HorseEvent => makeEvent({ id: `${date}-${type}`, date, type, amountCents, ...over });

const MONTH = (key: string): ExpensePeriod => ({ granularity: 'month', key });
const YEAR = (key: string): ExpensePeriod => ({ granularity: 'year', key });

describe('periodOf', () => {
  it('takes the month prefix for a month and the year prefix for a year', () => {
    expect(periodOf('2026-01-10', 'month')).toEqual(MONTH('2026-01'));
    expect(periodOf('2026-01-10', 'year')).toEqual(YEAR('2026'));
  });
});

describe('inPeriod', () => {
  const events = [
    expense('2025-12-31', 'veto', 1000),
    expense('2026-01-01', 'marechal', 2000),
    expense('2026-01-31', 'osteo', 3000),
    expense('2026-02-01', 'pension', 4000),
  ];

  it('keeps only the events inside a month, both ends included', () => {
    expect(inPeriod(events, MONTH('2026-01')).map((event) => event.date)).toEqual([
      '2026-01-01',
      '2026-01-31',
    ]);
  });

  it('does not let December leak into the following January', () => {
    expect(inPeriod(events, MONTH('2026-01')).some((event) => event.date === '2025-12-31')).toBe(
      false,
    );
  });

  it('keeps the whole year for a year period', () => {
    expect(inPeriod(events, YEAR('2026'))).toHaveLength(3);
    expect(inPeriod(events, YEAR('2025'))).toHaveLength(1);
  });

  it('preserves the order it was given', () => {
    const reversed = [...events].reverse();
    expect(inPeriod(reversed, YEAR('2026')).map((event) => event.date)).toEqual([
      '2026-02-01',
      '2026-01-31',
      '2026-01-01',
    ]);
  });
});

describe('sumByType', () => {
  it('adds up several events of the same category', () => {
    const slices = sumByType([
      expense('2026-01-05', 'veto', 10_000),
      expense('2026-01-20', 'veto', 2500),
    ]);
    expect(slices).toEqual([{ type: 'veto', cents: 12_500 }]);
  });

  it('omits categories with nothing spent on them', () => {
    const slices = sumByType([expense('2026-01-05', 'veto', 10_000)]);
    expect(slices).toHaveLength(1);
    expect(slices.map((slice) => slice.type)).not.toContain('pension');
  });

  it('omits a category whose events cancel out to zero', () => {
    const slices = sumByType([
      expense('2026-01-05', 'achat', 5000),
      expense('2026-01-06', 'achat', -5000, { id: 'refund' }),
      expense('2026-01-07', 'veto', 1000),
    ]);
    expect(slices).toEqual([{ type: 'veto', cents: 1000 }]);
  });

  it('orders by EVENT_TYPES, not by amount, so the ring never reshuffles', () => {
    // `pension` is last in EVENT_TYPES and biggest here; `veto` is first and smallest.
    const slices = sumByType([
      expense('2026-01-05', 'pension', 35_000),
      expense('2026-01-06', 'veto', 100),
    ]);
    expect(slices.map((slice) => slice.type)).toEqual(['veto', 'pension']);
  });

  it('treats a null amount as nothing rather than NaN', () => {
    const slices = sumByType([
      expense('2026-01-05', 'veto', 1000),
      makeEvent({ id: 'no-amount', date: '2026-01-06', type: 'veto', amountCents: null }),
    ]);
    expect(slices).toEqual([{ type: 'veto', cents: 1000 }]);
  });

  it('returns nothing for no events', () => {
    expect(sumByType([])).toEqual([]);
  });
});

describe('sumSlices', () => {
  it('totals the slices, and reads 0 for none', () => {
    expect(sumSlices(sumByType([expense('2026-01-05', 'veto', 10_000)]))).toBe(10_000);
    expect(sumSlices([])).toBe(0);
  });
});

describe('periodOptions', () => {
  const events = [
    expense('2025-03-04', 'veto', 1000),
    expense('2026-01-10', 'osteo', 2000),
    expense('2026-01-20', 'veto', 3000),
  ];

  it('offers today even when nothing was spent in it', () => {
    expect(periodOptions([], 'month', '2026-08-12')).toEqual([MONTH('2026-08')]);
  });

  it('lists every month present, newest first, without duplicating one', () => {
    expect(periodOptions(events, 'month', '2026-08-12')).toEqual([
      MONTH('2026-08'),
      MONTH('2026-01'),
      MONTH('2025-03'),
    ]);
  });

  it('does not add today twice when it already has expenses', () => {
    const withToday = [...events, expense('2026-08-01', 'pension', 500)];
    expect(periodOptions(withToday, 'month', '2026-08-12')).toEqual([
      MONTH('2026-08'),
      MONTH('2026-01'),
      MONTH('2025-03'),
    ]);
  });

  it('collapses to years for the year granularity', () => {
    expect(periodOptions(events, 'year', '2026-08-12')).toEqual([YEAR('2026'), YEAR('2025')]);
  });
});

describe('formatPeriod', () => {
  it('leaves the year off a month in the current year', () => {
    expect(formatPeriod(MONTH('2026-01'), '2026-08-12')).toBe('Janv.');
  });

  it('spells the year out for a month outside it', () => {
    expect(formatPeriod(MONTH('2025-03'), '2026-08-12')).toBe('Mars 2025');
  });

  it('renders a year as itself', () => {
    expect(formatPeriod(YEAR('2026'), '2026-08-12')).toBe('2026');
  });

  it('falls back to the raw key rather than throwing on a malformed month', () => {
    expect(formatPeriod(MONTH('2026-99'), '2026-08-12')).toBe('2026-99');
  });
});

describe('formatPeriodNote', () => {
  it('reads as a sentence fragment under the total', () => {
    expect(formatPeriodNote(MONTH('2026-01'))).toBe('en janvier');
    expect(formatPeriodNote(YEAR('2026'))).toBe('en 2026');
  });

  it('is empty rather than wrong for a malformed month', () => {
    expect(formatPeriodNote(MONTH('2026-99'))).toBe('');
  });
});

describe('formatPeriodHeading', () => {
  it('agrees with the granularity', () => {
    expect(formatPeriodHeading('month')).toBe('Dépenses mensuelles');
    expect(formatPeriodHeading('year')).toBe('Dépenses annuelles');
  });
});

describe('byDateDescending', () => {
  it('puts the newest first', () => {
    const events = [
      expense('2026-01-01', 'veto', 100),
      expense('2026-03-01', 'osteo', 100),
      expense('2026-02-01', 'pension', 100),
    ];
    expect([...events].sort(byDateDescending).map((event) => event.date)).toEqual([
      '2026-03-01',
      '2026-02-01',
      '2026-01-01',
    ]);
  });

  it('breaks a same-day tie on createdAt, newest first', () => {
    const older = expense('2026-01-01', 'veto', 100, {
      id: 'older',
      createdAt: '2026-01-01T08:00:00.000Z',
    });
    const newer = expense('2026-01-01', 'osteo', 100, {
      id: 'newer',
      createdAt: '2026-01-01T09:00:00.000Z',
    });
    expect([older, newer].sort(byDateDescending).map((event) => event.id)).toEqual([
      'newer',
      'older',
    ]);
  });
});
