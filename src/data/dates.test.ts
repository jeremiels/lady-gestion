import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addDays,
  addMonths,
  ageInYears,
  endOfMonth,
  formatAge,
  formatDate,
  formatDateMedium,
  formatDayLong,
  formatMonthYear,
  formatTime,
  fromIsoDate,
  isIsoDate,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  todayISO,
  weekdayLabels,
} from './dates.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('todayISO', () => {
  it('reads the local calendar date, not the UTC one', () => {
    // 23:30 UTC on the 11th is already 01:30 on the 12th in Europe/Paris.
    // `new Date().toISOString().slice(0, 10)` would answer '2026-08-11' here,
    // which is the bug this helper exists to avoid.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T23:30:00.000Z'));

    expect(todayISO()).toBe('2026-08-12');
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-08-11');
  });
});

describe('isIsoDate', () => {
  it.each([
    ['2026-08-11', true],
    ['2026-8-11', false],
    ['2026-08-11T00:00:00.000Z', false],
    ['', false],
    [null, false],
    [undefined, false],
    [20260811, false],
  ])('%s -> %s', (value, expected) => {
    expect(isIsoDate(value)).toBe(expected);
  });
});

describe('fromIsoDate', () => {
  it('parses at local midnight rather than UTC midnight', () => {
    const date = fromIsoDate('2026-08-11');

    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(7); // zero-based
    expect(date.getDate()).toBe(11);
    expect(date.getHours()).toBe(0);
  });
});

describe('ageInYears', () => {
  it('counts whole years once the birthday has passed', () => {
    expect(ageInYears('2021-05-01', '2026-08-11')).toBe(5);
  });

  it('does not count the current year before the birthday', () => {
    expect(ageInYears('2021-05-01', '2026-04-30')).toBe(4);
  });

  it('counts the birthday itself', () => {
    expect(ageInYears('2021-05-01', '2026-05-01')).toBe(5);
  });

  it('does not count the day before the birthday', () => {
    expect(ageInYears('2021-05-01', '2026-04-30')).toBe(4);
  });

  it('handles a 29 February birth date in a non-leap year', () => {
    // Born on the leap day: on 28 Feb the birthday has not arrived yet, on
    // 1 March it has.
    expect(ageInYears('2020-02-29', '2026-02-28')).toBe(5);
    expect(ageInYears('2020-02-29', '2026-03-01')).toBe(6);
  });

  it('returns null for an unknown or malformed birth date', () => {
    expect(ageInYears(null)).toBeNull();
    expect(ageInYears('')).toBeNull();
    expect(ageInYears('pas une date')).toBeNull();
  });

  it('returns null rather than a negative age for a future birth date', () => {
    expect(ageInYears('2030-01-01', '2026-08-11')).toBeNull();
  });
});

describe('formatAge', () => {
  it.each([
    [null, '—'],
    [0, '0 an'],
    [1, '1 an'],
    [2, '2 ans'],
    [5, '5 ans'],
  ])('%s -> %s', (age, expected) => {
    expect(formatAge(age)).toBe(expected);
  });
});

describe('formatDate', () => {
  it('renders a French short date', () => {
    expect(formatDate('2026-03-15')).toBe('15/03/2026');
  });
});

describe('formatDateMedium', () => {
  it('renders a French medium date', () => {
    expect(formatDateMedium('2026-01-10')).toBe('10 janv. 2026');
  });

  it('reads the date as local, not UTC', () => {
    // `new Date('2026-01-01')` parses as UTC midnight, which is the 31st of
    // December in any negative offset. `fromIsoDate` builds it at local
    // midnight, so the day printed is the day stored.
    expect(formatDateMedium('2026-01-01')).toBe('1 janv. 2026');
  });
});

describe('addDays', () => {
  it.each([
    ['2026-01-22', 1, '2026-01-23'],
    ['2026-01-22', -1, '2026-01-21'],
    ['2026-01-31', 1, '2026-02-01'],
    ['2025-12-31', 1, '2026-01-01'],
    ['2026-01-01', -1, '2025-12-31'],
    ['2024-02-28', 1, '2024-02-29'],
    ['2026-01-22', 0, '2026-01-22'],
  ])('%s %+d -> %s', (value, days, expected) => {
    expect(addDays(value, days)).toBe(expected);
  });

  it('crosses a daylight-saving boundary as one whole day', () => {
    // 2026-03-29 is the spring-forward night in Europe/Paris: that day is 23
    // hours long. Adding 86_400_000 ms would land back on the 29th at 01:00.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    // And the autumn 25-hour day.
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
  });
});

describe('addMonths', () => {
  it.each([
    ['2026-01-15', 1, '2026-02-15'],
    ['2026-01-15', -1, '2025-12-15'],
    ['2026-01-15', 12, '2027-01-15'],
    // Clamped: February has no 31st, and `setMonth` alone would roll to March.
    ['2026-01-31', 1, '2026-02-28'],
    ['2024-01-31', 1, '2024-02-29'],
    ['2026-03-31', -1, '2026-02-28'],
    ['2026-05-31', 1, '2026-06-30'],
  ])('%s %+d month -> %s', (value, months, expected) => {
    expect(addMonths(value, months)).toBe(expected);
  });
});

describe('startOfMonth / endOfMonth', () => {
  it.each([
    ['2026-01-22', '2026-01-01', '2026-01-31'],
    ['2026-02-10', '2026-02-01', '2026-02-28'],
    ['2024-02-10', '2024-02-01', '2024-02-29'],
  ])('%s -> %s .. %s', (value, first, last) => {
    expect(startOfMonth(value)).toBe(first);
    expect(endOfMonth(value)).toBe(last);
  });
});

describe('startOfWeek', () => {
  it('walks back to Monday for a Monday-first week', () => {
    // 2026-01-22 is a Thursday.
    expect(startOfWeek('2026-01-22', 1)).toBe('2026-01-19');
    expect(startOfWeek('2026-01-19', 1)).toBe('2026-01-19');
    expect(startOfWeek('2026-01-18', 1)).toBe('2026-01-12');
  });

  it('walks back to Sunday for a Sunday-first week', () => {
    expect(startOfWeek('2026-01-22', 0)).toBe('2026-01-18');
    expect(startOfWeek('2026-01-18', 0)).toBe('2026-01-18');
  });

  it('crosses into the previous month and year', () => {
    expect(startOfWeek('2026-01-01', 1)).toBe('2025-12-29');
  });
});

describe('isSameMonth', () => {
  it.each([
    ['2026-01-01', '2026-01-31', true],
    ['2026-01-31', '2026-02-01', false],
    ['2025-01-15', '2026-01-15', false],
  ])('%s vs %s -> %s', (a, b, expected) => {
    expect(isSameMonth(a, b)).toBe(expected);
  });
});

describe('formatMonthYear', () => {
  it('capitalises the French month name', () => {
    expect(formatMonthYear('2026-01-22')).toBe('Janvier 2026');
    expect(formatMonthYear('2026-08-01')).toBe('Août 2026');
  });
});

describe('formatTime', () => {
  it.each([
    ['10:30', '10h30'],
    ['14:00', '14h00'],
    ['09:05', '09h05'],
    [null, ''],
  ])('%s -> %s', (time, expected) => {
    expect(formatTime(time)).toBe(expected);
  });
});

describe('formatDayLong', () => {
  it('renders the day heading', () => {
    expect(formatDayLong('2026-01-22')).toBe('22 janvier 2026');
  });
});

describe('weekdayLabels', () => {
  it('starts on Monday and reads L M M J V S D', () => {
    expect(weekdayLabels(1).map((day) => day.narrow)).toEqual(['L', 'M', 'M', 'J', 'V', 'S', 'D']);
    expect(weekdayLabels(1)[0]?.long).toBe('lundi');
    expect(weekdayLabels(1)[6]?.long).toBe('dimanche');
  });

  it('rotates for a Sunday-first week', () => {
    expect(weekdayLabels(0).map((day) => day.narrow)).toEqual(['D', 'L', 'M', 'M', 'J', 'V', 'S']);
  });
});
