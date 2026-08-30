import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEEK_START,
  monthGrid,
  occurrencesByDate,
  toCalendarEvent,
  weekDayIndex,
  weekGrid,
  type CalendarEvent,
} from './icalendar.ts';
import type { HorseEvent } from './types.ts';

const horseEvent = (fields: Partial<HorseEvent> = {}): HorseEvent => ({
  id: 'event-1',
  ownerId: 'owner-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  horseId: 'horse-1',
  type: 'veto',
  title: 'Contrôle œil',
  date: '2026-01-22',
  time: '14:00',
  status: 'planned',
  amountCents: null,
  currency: 'EUR',
  providerName: null,
  vendor: null,
  location: null,
  notes: null,
  recurrenceId: null,
  followUpInterval: null,
  activity: null,
  ...fields,
});

const calendarEvent = (fields: Partial<CalendarEvent> = {}): CalendarEvent => ({
  uid: 'event-1',
  start: '2026-01-22',
  startTime: '14:00',
  end: null,
  status: 'CONFIRMED',
  summary: 'Contrôle œil',
  categories: ['veto'],
  ...fields,
});

describe('weekDayIndex', () => {
  it('matches Date#getDay() numbering', () => {
    expect(weekDayIndex('SU')).toBe(0);
    expect(weekDayIndex('MO')).toBe(1);
    expect(weekDayIndex('SA')).toBe(6);
  });

  it('defaults the week start to Monday, as RFC 5545 does', () => {
    expect(DEFAULT_WEEK_START).toBe('MO');
  });
});

describe('toCalendarEvent', () => {
  it('maps a timed event onto a DATE-TIME DTSTART', () => {
    expect(toCalendarEvent(horseEvent())).toEqual({
      uid: 'event-1',
      start: '2026-01-22',
      startTime: '14:00',
      end: null,
      status: 'CONFIRMED',
      summary: 'Contrôle œil',
      categories: ['veto'],
    });
  });

  it('keeps a null time, which is what marks an all-day VALUE=DATE entry', () => {
    expect(toCalendarEvent(horseEvent({ time: null })).startTime).toBeNull();
  });

  it.each([
    ['planned', 'CONFIRMED'],
    ['done', 'CONFIRMED'],
    ['cancelled', 'CANCELLED'],
  ] as const)('status %s -> %s', (status, expected) => {
    expect(toCalendarEvent(horseEvent({ status })).status).toBe(expected);
  });
});

describe('weekGrid', () => {
  it('runs Monday to Sunday for a day mid-week', () => {
    // 2026-08-12 is a Wednesday.
    expect(weekGrid('2026-08-12')).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
      '2026-08-16',
    ]);
  });

  it('puts a Sunday in the week that opened the Monday before, not the one after', () => {
    // The off-by-one a `getDay()`-based week start invites: Sunday is 0, so a
    // naive offset walks forward six days instead of back.
    expect(weekGrid('2026-08-16')[0]).toBe('2026-08-10');
    expect(weekGrid('2026-08-10')[0]).toBe('2026-08-10');
  });

  it('crosses a month and a year boundary without a gap', () => {
    expect(weekGrid('2026-01-01')).toEqual([
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
    ]);
  });

  it('honours a different week start', () => {
    expect(weekGrid('2026-08-12', 'SU')[0]).toBe('2026-08-09');
  });
});

describe('monthGrid', () => {
  it('covers January 2026 in five Monday-first weeks', () => {
    // The month starts on a Thursday and ends on a Saturday, so the grid runs
    // from 29 December to 1 February — exactly the design's five rows.
    const weeks = monthGrid('2026-01-01');

    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toEqual([
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
    ]);
    expect(weeks.at(-1)?.at(-1)).toBe('2026-02-01');
  });

  it('takes six rows when the month needs them', () => {
    // August 2026 starts on a Saturday and has 31 days, so it spills into a
    // sixth week. February 2026 starts on a Sunday and fits in five.
    expect(monthGrid('2026-08-01')).toHaveLength(6);
    expect(monthGrid('2026-02-01')).toHaveLength(5);
  });

  it('honours WKST=SU', () => {
    const weeks = monthGrid('2026-01-01', 'SU');

    expect(weeks[0]?.[0]).toBe('2025-12-28');
    expect(weeks.at(-1)?.at(-1)).toBe('2026-01-31');
  });

  it('is built from any day of the month, not just the first', () => {
    expect(monthGrid('2026-01-22')).toEqual(monthGrid('2026-01-01'));
  });

  it('gives every week seven days', () => {
    for (const week of monthGrid('2026-02-01')) expect(week).toHaveLength(7);
  });
});

describe('occurrencesByDate', () => {
  it('buckets an event on its start day', () => {
    const event = calendarEvent();
    const byDate = occurrencesByDate([event], '2026-01-01', '2026-01-31');

    expect(byDate.get('2026-01-22')).toEqual([event]);
    expect(byDate.get('2026-01-23')).toBeUndefined();
  });

  it('treats DTEND as exclusive', () => {
    // 22 -> 25 exclusive occupies the 22nd, 23rd and 24th.
    const event = calendarEvent({ end: '2026-01-25' });
    const byDate = occurrencesByDate([event], '2026-01-01', '2026-01-31');

    expect([...byDate.keys()].sort()).toEqual(['2026-01-22', '2026-01-23', '2026-01-24']);
  });

  it('still shows a zero-duration event on its start day', () => {
    const event = calendarEvent({ end: '2026-01-22' });

    expect(occurrencesByDate([event], '2026-01-01', '2026-01-31').get('2026-01-22')).toEqual([
      event,
    ]);
  });

  it('drops cancelled events', () => {
    const event = calendarEvent({ status: 'CANCELLED' });

    expect(occurrencesByDate([event], '2026-01-01', '2026-01-31').size).toBe(0);
  });

  it('clips to the requested range', () => {
    const event = calendarEvent({ start: '2026-01-28', end: '2026-02-05' });
    const byDate = occurrencesByDate([event], '2026-01-01', '2026-01-31');

    expect([...byDate.keys()].sort()).toEqual([
      '2026-01-28',
      '2026-01-29',
      '2026-01-30',
      '2026-01-31',
    ]);
  });

  it('ignores events outside the range entirely', () => {
    const before = calendarEvent({ uid: 'before', start: '2025-12-31' });
    const after = calendarEvent({ uid: 'after', start: '2026-02-01' });

    expect(occurrencesByDate([before, after], '2026-01-01', '2026-01-31').size).toBe(0);
  });

  it('lists all-day entries first, then by time', () => {
    const timedLate = calendarEvent({ uid: 'late', startTime: '16:00', summary: 'Cours' });
    const timedEarly = calendarEvent({ uid: 'early', startTime: '09:30', summary: 'Ferrure' });
    const allDay = calendarEvent({ uid: 'all-day', startTime: null, summary: 'Pension' });

    const day = occurrencesByDate([timedLate, timedEarly, allDay], '2026-01-01', '2026-01-31').get(
      '2026-01-22',
    );

    expect(day?.map((event) => event.uid)).toEqual(['all-day', 'early', 'late']);
  });

  it('breaks ties on the summary so the order is stable', () => {
    const b = calendarEvent({ uid: 'b', summary: 'Ostéopathe' });
    const a = calendarEvent({ uid: 'a', summary: 'Dentiste' });

    const day = occurrencesByDate([b, a], '2026-01-01', '2026-01-31').get('2026-01-22');

    expect(day?.map((event) => event.uid)).toEqual(['a', 'b']);
  });
});
