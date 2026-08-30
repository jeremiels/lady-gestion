import { addDays, endOfMonth, startOfMonth, startOfWeek, type IsoDate } from './dates.ts';
import type { EventTypeKey } from '../types/event.types.ts';
import type { HorseEvent } from './types.ts';

/**
 * The calendar's view of an event, shaped after RFC 5545 (iCalendar) — the
 * format Google Calendar, Apple Calendar and Outlook all speak.
 *
 * The stored `HorseEvent` deliberately isn't iCalendar-shaped: it keeps a
 * `date` string, a nullable `time` and a French-flavoured `status`, which is
 * the right shape for a form and for an IndexedDB range index. This module is
 * the one place that translates, so the calendar UI works in standard terms
 * and an `.ics` export or an `RRULE` expansion can be added here later without
 * touching a component.
 *
 * Only the properties the month view actually needs are modelled. Everything
 * else on the record (amount, provider, notes) stays on `HorseEvent`, which
 * the day list renders directly.
 */

/**
 * Weekday codes from RFC 5545 §3.3.10, used by `WKST` and `BYDAY`. Ordered so
 * the array index is the `Date#getDay()` number.
 */
export const WEEK_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export type WeekDay = (typeof WEEK_DAYS)[number];

export const weekDayIndex = (day: WeekDay): number => WEEK_DAYS.indexOf(day);

/** `WKST` defaults to Monday in the RFC, which is also what a French calendar shows. */
export const DEFAULT_WEEK_START: WeekDay = 'MO';

/** The `STATUS` values RFC 5545 §3.8.1.11 allows on a `VEVENT`. */
export type VEventStatus = 'TENTATIVE' | 'CONFIRMED' | 'CANCELLED';

/**
 * `HorseEvent.status` -> `STATUS`.
 *
 * `planned` and `done` both map to `CONFIRMED`: the RFC has no notion of an
 * event being in the past, that is just the date. `TENTATIVE` has no source
 * value yet — it is what an "à confirmer" state would map to.
 */
const V_EVENT_STATUS: Record<HorseEvent['status'], VEventStatus> = {
  planned: 'CONFIRMED',
  done: 'CONFIRMED',
  cancelled: 'CANCELLED',
};

export type CalendarEvent = {
  /** `UID` §3.8.4.7 — the record id, already a client-generated UUID. */
  uid: string;
  /** `DTSTART` §3.8.2.4, date part. */
  start: IsoDate;
  /** `DTSTART` time part, `HH:mm`. `null` means `VALUE=DATE`, i.e. all-day. */
  startTime: string | null;
  /**
   * `DTEND` §3.8.2.2 — **exclusive**. An event on the 22nd alone ends on the
   * 23rd. `null` is the RFC's default duration: one day for a `DATE` start,
   * zero for a `DATE-TIME` one. Nothing produces a multi-day event yet; the
   * field exists so `occurrencesByDate` gets the boundary right when one does.
   */
  end: IsoDate | null;
  /** `STATUS` §3.8.1.11. */
  status: VEventStatus;
  /** `SUMMARY` §3.8.1.12. */
  summary: string;
  /** `CATEGORIES` §3.8.1.2 — the app's event type doubles as the category. */
  categories: EventTypeKey[];
};

export const toCalendarEvent = (event: HorseEvent): CalendarEvent => ({
  uid: event.id,
  start: event.date,
  startTime: event.time,
  end: null,
  status: V_EVENT_STATUS[event.status],
  summary: event.title,
  categories: [event.type],
});

/**
 * One week, as seven days.
 *
 * A tuple rather than `IsoDate[]` because the length is the whole promise:
 * under `noUncheckedIndexedAccess` a caller reading the first and last day of
 * the week — which is what a range query needs — would otherwise have to assert
 * away two `undefined`s the function can never return.
 */
export type WeekDates = [IsoDate, IsoDate, IsoDate, IsoDate, IsoDate, IsoDate, IsoDate];

const daysFrom = (start: IsoDate): WeekDates =>
  Array.from({ length: 7 }, (_, index) => addDays(start, index)) as WeekDates;

/**
 * The seven days of the week containing `date`, from its `weekStart` onwards.
 *
 * The dashboard's week strip reads this; `monthGrid` below builds its rows from
 * the same helper, so "a week is seven days from the Monday" is stated once.
 */
export const weekGrid = (date: IsoDate, weekStart: WeekDay = DEFAULT_WEEK_START): WeekDates =>
  daysFrom(startOfWeek(date, weekDayIndex(weekStart)));

/**
 * The weeks a month view has to draw: whole weeks, from the one containing the
 * 1st to the one containing the last day.
 *
 * The row count follows the month (5 for January 2026, 6 for May 2026) rather
 * than being padded to a fixed 6, so no month shows a full trailing week that
 * belongs to the next one.
 */
export const monthGrid = (month: IsoDate, weekStart: WeekDay = DEFAULT_WEEK_START): IsoDate[][] => {
  const startIndex = weekDayIndex(weekStart);
  const first = startOfWeek(startOfMonth(month), startIndex);
  const last = addDays(startOfWeek(endOfMonth(month), startIndex), 6);

  const weeks: IsoDate[][] = [];
  let cursor = first;
  while (cursor <= last) {
    // `cursor` is already a week start, so this is the same seven days
    // `weekGrid` would hand back — without re-deriving the Monday it sits on.
    weeks.push(daysFrom(cursor));
    cursor = addDays(cursor, 7);
  }
  return weeks;
};

/**
 * All-day entries before timed ones, then by start time — the order Google
 * Calendar lists a day in. `summary` breaks the remaining ties so the list is
 * stable across renders.
 */
const compareOccurrences = (a: CalendarEvent, b: CalendarEvent): number => {
  if (a.startTime === null || b.startTime === null) {
    if (a.startTime !== b.startTime) return a.startTime === null ? -1 : 1;
  } else if (a.startTime !== b.startTime) {
    return a.startTime.localeCompare(b.startTime);
  }
  return a.summary.localeCompare(b.summary);
};

/**
 * Buckets events by the days they occupy, over the inclusive `from`..`to`
 * range — the calendar's dots and the selected day's list both read this, so
 * the two can never disagree about what falls on a day.
 *
 * Cancelled events are dropped: RFC 5545 keeps a `CANCELLED VEVENT` in the
 * calendar so the cancellation itself can be published, but it is not an
 * occurrence and calendars don't draw it.
 */
export const occurrencesByDate = (
  events: CalendarEvent[],
  from: IsoDate,
  to: IsoDate,
): Map<IsoDate, CalendarEvent[]> => {
  const byDate = new Map<IsoDate, CalendarEvent[]>();

  for (const event of events) {
    if (event.status === 'CANCELLED') continue;

    // `end` is exclusive, so an event ending on the 23rd last occupies the
    // 22nd. Never earlier than the start: a zero-duration `DTEND` equal to
    // `DTSTART` is still shown on its day.
    const exclusiveEnd = event.end === null ? event.start : addDays(event.end, -1);
    const lastDay = exclusiveEnd < event.start ? event.start : exclusiveEnd;

    let day = event.start < from ? from : event.start;
    const until = lastDay > to ? to : lastDay;

    while (day <= until) {
      const bucket = byDate.get(day);
      if (bucket) bucket.push(event);
      else byDate.set(day, [event]);
      day = addDays(day, 1);
    }
  }

  for (const bucket of byDate.values()) bucket.sort(compareOccurrences);

  return byDate;
};
