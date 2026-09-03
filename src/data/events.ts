import { todayISO, type IsoDate } from './dates.ts';
import type { EventTypeKey } from '../types/event.types.ts';
import type { EventStatus, HorseEvent } from './types.ts';

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
 * The types the dashboard's "Rendez-vous à venir" list is about.
 *
 * A rendez-vous is booked with someone — the vet, the farrier, the dentist, the
 * osteopath. The other five types are either logged after the fact (a purchase,
 * a feed order, the boarding bill) or happen without one being taken (a lesson,
 * a schooling session), and a future row of any of them used to push a real
 * visit out of the dashboard's top three.
 *
 * Listed rather than derived from `eventFormSpec(type).followUp`, which picks
 * out the same four today: that flag says which layout draws the follow-up
 * checkbox, and what counts as a rendez-vous should not change because a form
 * grew or lost a field.
 */
const APPOINTMENT_TYPES = new Set<EventTypeKey>(['veto', 'marechal', 'dentiste', 'osteo']);

export const isAppointmentType = (type: EventTypeKey): boolean => APPOINTMENT_TYPES.has(type);

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
 * Six built-in keys, short and stable in storage with French labels on screen:
 * the same split `EventTypeKey` makes, where the wording is presentation and may
 * be reworded and the key is what a stored row means.
 *
 * The list is no longer closed. The week strip's day sheet lets the user add
 * their own, and one of those is stored as **its own label, verbatim** — not as
 * an id into the catalogue it came from. Both consequences are the point:
 *
 * - a session stays readable on its own, so deleting a row from the catalogue
 *   (`ActivityItem` in `types.ts`) retires a chip and never orphans an event;
 * - nothing joins — `day-card`, `EventDetailView` and `workActivityByDate` keep
 *   the shape they had when this was a closed union.
 *
 * What it gives up is what the closed list used to buy: two spellings of
 * "carrière" are now two activities. `activityChoices` below is what stops that
 * happening by accident.
 */
export type BuiltInActivity = 'balade' | 'longe' | 'tap' | 'liberte' | 'plat' | 'trotting';

/**
 * A built-in key, or a label the user typed.
 *
 * `(string & {})` rather than a bare `string`: the union keeps editor completion
 * on the six built-ins, which widening to `string` would silently drop.
 */
export type WorkActivity = BuiltInActivity | (string & {});

/** In the order the sheet offers them. */
const WORK_ACTIVITY_LABELS: Record<BuiltInActivity, string> = {
  balade: 'Balade à pied',
  longe: 'Longe',
  tap: 'TAP',
  liberte: 'Liberté',
  plat: 'Plat',
  trotting: 'Trotting',
};

/** Derived from the table above, so the list and the labels cannot drift. */
export const WORK_ACTIVITIES = Object.keys(WORK_ACTIVITY_LABELS) as BuiltInActivity[];

/**
 * A `Map` rather than indexing the `Record` above.
 *
 * That record's keys are literal, so reading it with an arbitrary
 * `WorkActivity` needs a cast — and the cast would type a miss as `string`
 * instead of `undefined`, which is the exact value the fallback below is built
 * on. The one that type-checks is the one that lies.
 */
const LABELS: ReadonlyMap<string, string> = new Map(Object.entries(WORK_ACTIVITY_LABELS));

/** A built-in key resolves to its French label; a user's activity is its own. */
export const formatWorkActivity = (activity: WorkActivity): string =>
  LABELS.get(activity) ?? activity;

/**
 * What two labels are compared on when deciding whether they are the same
 * activity — surrounding space, case and accents removed.
 *
 * Accents included deliberately. The comparison exists to stop a second chip
 * appearing that reads the same as one already there, and on a phone keyboard
 * "liberte" and "Liberté" are the same word typed twice.
 */
const activityKey = (label: string): string =>
  label
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('fr-FR');

/**
 * The chips the day sheet offers: the six built-ins in table order, then the
 * user's own in the order they were added.
 *
 * Deduplicated on what each choice *reads as* rather than on what it stores, so
 * a user who types "Trotting" gets the built-in `trotting` back instead of a
 * second chip spelling the same word.
 */
export const activityChoices = (custom: string[]): WorkActivity[] => {
  const choices: WorkActivity[] = [...WORK_ACTIVITIES];
  const seen = new Set(choices.map((choice) => activityKey(formatWorkActivity(choice))));

  for (const label of custom) {
    const key = activityKey(label);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    choices.push(label);
  }

  return choices;
};

/**
 * The choice a typed label already stands for, or `null` when it is a new one.
 *
 * The sheet's input and its chips must not be able to disagree: typing the name
 * of a chip already on screen has to select that chip, not write a second
 * activity that renders identically to it.
 */
export const matchActivity = (label: string, choices: WorkActivity[]): WorkActivity | null => {
  const key = activityKey(label);
  if (key === '') return null;

  return choices.find((choice) => activityKey(formatWorkActivity(choice)) === key) ?? null;
};

/**
 * All-day sessions before timed ones, then by start time.
 *
 * The same rule `compareOccurrences` applies in `icalendar.ts`, and stated again
 * rather than shared because that one sorts `CalendarEvent`s, which carry no
 * activity. It is needed at all because the repository returns rows in
 * `[horseId+date]` index order — by day, then by whatever IndexedDB kept — so
 * without it "the first session of the day" is not a stable answer.
 */
const compareSessions = (a: HorseEvent, b: HorseEvent): number => {
  if (a.time === null || b.time === null) {
    if (a.time !== b.time) return a.time === null ? -1 : 1;
    return 0;
  }
  return a.time.localeCompare(b.time);
};

/** A `travail` row that actually says what was done — what the strip draws. */
export type WorkSession = HorseEvent & { activity: WorkActivity };

/**
 * The session each day's activity comes from — the dashboard's week strip.
 *
 * One entry per day, the day's first session, so a cell keeps a fixed height
 * whatever the horse did. Cancelled events are skipped, as they are in
 * `occurrencesByDate`: a cancelled session did not happen and must not be the
 * one thing the week shows.
 *
 * The row rather than just its activity, because the strip's sheet now edits
 * what the strip shows: tapping a chip on a day that already has a session has
 * to update that row, not add a second one no view would ever draw.
 *
 * Pure, over rows the caller already fetched — the shape `budget.ts` uses, and
 * what puts this under the data-layer test rule rather than a component suite.
 */
export const workSessionByDate = (events: HorseEvent[]): Map<IsoDate, WorkSession> => {
  const sessions = events
    .filter(
      (event): event is WorkSession =>
        event.type === 'travail' && event.status !== 'cancelled' && event.activity !== null,
    )
    .sort(compareSessions);

  const byDate = new Map<IsoDate, WorkSession>();
  for (const session of sessions) {
    if (!byDate.has(session.date)) byDate.set(session.date, session);
  }
  return byDate;
};

/**
 * Just the activity per day, for the card that only draws a label.
 *
 * Derived from `workSessionByDate` rather than filtering a second time, so the
 * card and the sheet editing it cannot disagree about which row is the day's.
 */
export const workActivityByDate = (events: HorseEvent[]): Map<IsoDate, WorkActivity> =>
  new Map([...workSessionByDate(events)].map(([date, session]) => [date, session.activity]));

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
