import { todayISO, type IsoDate } from './dates.ts';
import type { EventStatus } from './types.ts';

/**
 * Event rules that are neither persistence nor iCalendar.
 *
 * `repositories/events.repo.ts` owns reading and writing rows; `icalendar.ts`
 * owns the RFC 5545 view of them. This is the small set of decisions the entry
 * forms and the views make about an event's meaning.
 */

/**
 * The status a newly entered event should carry.
 *
 * None of the three entry forms has a status control, because the date already
 * says which one is meant: you schedule a vet visit ahead of time and you log a
 * purchase after the fact. Today counts as `done` — an appointment entered on
 * the day it happened has happened.
 */
export const statusForDate = (date: IsoDate, on: IsoDate = todayISO()): EventStatus =>
  date > on ? 'planned' : 'done';

/**
 * How long until a care event should be repeated — a six-week farrier cycle, a
 * yearly vaccine booster.
 *
 * Stored as an amount plus a unit rather than a number of days, so "3 mois"
 * survives as three months instead of becoming 90 days and drifting against the
 * calendar. Structured for the same reason `RationSeason` is: the pair is only
 * ever meaningful together, so a half-set value cannot be represented.
 *
 * Recorded when "Planifier un rendez-vous" is ticked. **Nothing derives a date
 * from it yet** — ticking the box does not create a second event. Reminders
 * will be what reads this.
 */
export type FollowUpUnit = 'week' | 'month';

export type FollowUpInterval = {
  amount: number;
  unit: FollowUpUnit;
};

/**
 * What the select lands on when the box is ticked and the record has no
 * interval of its own — the farrier cycle, which is the common case.
 *
 * Named rather than reached for as `FOLLOW_UP_INTERVALS[2]`, which is what the
 * sheet used to do: under `noUncheckedIndexedAccess` that index needs a `??`
 * fallback, and the fallback there was a second copy of this very object. Two
 * values that had to agree, with a reorder of the list below silently able to
 * break the agreement.
 */
export const DEFAULT_FOLLOW_UP: FollowUpInterval = { amount: 6, unit: 'week' };

/** The intervals the form offers, shortest first. */
export const FOLLOW_UP_INTERVALS: FollowUpInterval[] = [
  { amount: 2, unit: 'week' },
  { amount: 4, unit: 'week' },
  DEFAULT_FOLLOW_UP,
  { amount: 8, unit: 'week' },
  { amount: 3, unit: 'month' },
  { amount: 6, unit: 'month' },
  { amount: 12, unit: 'month' },
];

/**
 * What was done in a schooling session — the "Activité" field on a `travail`
 * event.
 *
 * Short, stable keys in storage and French labels on screen, the same split
 * `EventTypeKey` makes: the wording is presentation and may be reworded, the key
 * is what a stored row means. A closed list rather than free text because it is
 * the field that says what the session *was*, and two spellings of "longe"
 * would make that unanswerable.
 */
export type WorkActivity = 'balade' | 'longe' | 'tap' | 'liberte' | 'plat' | 'trotting';

/** In the order the select offers them. */
const WORK_ACTIVITY_LABELS: Record<WorkActivity, string> = {
  balade: 'Balade à pied',
  longe: 'Longe',
  tap: 'TAP',
  liberte: 'Liberté',
  plat: 'Plat',
  trotting: 'Trotting',
};

/** Derived from the table above, so the list and the labels cannot drift. */
export const WORK_ACTIVITIES = Object.keys(WORK_ACTIVITY_LABELS) as WorkActivity[];

export const formatWorkActivity = (activity: WorkActivity): string =>
  WORK_ACTIVITY_LABELS[activity];

export const isFollowUpInterval = (value: unknown): value is FollowUpInterval => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<FollowUpInterval>;
  return (
    typeof candidate.amount === 'number' &&
    Number.isInteger(candidate.amount) &&
    candidate.amount > 0 &&
    (candidate.unit === 'week' || candidate.unit === 'month')
  );
};

/**
 * A stable string for a `<select>` option value — `6w`, `3m`.
 *
 * `FormData` only carries strings, so the structured interval has to survive a
 * round trip through one. Kept short and parseable rather than JSON so a stray
 * value in the DOM is still readable.
 */
export const followUpValue = (interval: FollowUpInterval): string =>
  `${interval.amount}${interval.unit === 'week' ? 'w' : 'm'}`;

/** The inverse of `followUpValue`. Returns `null` for anything unrecognised. */
export const parseFollowUpValue = (value: unknown): FollowUpInterval | null => {
  if (typeof value !== 'string') return null;

  const match = /^(\d+)([wm])$/.exec(value);
  if (!match) return null;

  const interval = {
    amount: Number(match[1]),
    unit: match[2] === 'w' ? 'week' : 'month',
  };
  return isFollowUpInterval(interval) ? interval : null;
};

/** `{ amount: 6, unit: 'week' }` -> `6 semaines`. `mois` is already invariant. */
export const formatFollowUpInterval = (interval: FollowUpInterval): string => {
  // A year reads as a year; "12 mois" is technically right and nobody says it.
  if (interval.unit === 'month' && interval.amount === 12) return '1 an';

  if (interval.unit === 'month') return `${interval.amount} mois`;
  return interval.amount === 1 ? '1 semaine' : `${interval.amount} semaines`;
};
