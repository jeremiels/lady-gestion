/**
 * Two distinct kinds of date live in this app, and mixing them causes bugs
 * that only show up for users an hour either side of midnight:
 *
 * - **Calendar dates** (`IsoDate`, `YYYY-MM-DD`) — a vet visit on the 15th is
 *   on the 15th everywhere. No time, no timezone.
 * - **Timestamps** (`IsoTimestamp`, full ISO 8601 UTC) — when a row was
 *   written. Used for ordering and conflict resolution, never displayed raw.
 *
 * Both are stored as strings. `Date` objects survive IndexedDB but not JSON
 * export, and string dates in these formats sort lexicographically, which is
 * exactly what an IndexedDB range index needs.
 */

/** `YYYY-MM-DD`. */
export type IsoDate = string;

/** Full ISO 8601 UTC, e.g. `2026-08-11T09:24:00.000Z`. */
export type IsoTimestamp = string;

export const nowISO = (): IsoTimestamp => new Date().toISOString();

/** Today as a *local* calendar date — not `toISOString()`, which shifts to UTC. */
export const todayISO = (): IsoDate => toIsoDate(new Date());

export const toIsoDate = (date: Date): IsoDate => {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isIsoDate = (value: unknown): value is IsoDate =>
  typeof value === 'string' && ISO_DATE.test(value);

/**
 * Splits `YYYY-MM-DD` into numeric year/month/day. A malformed string yields
 * `NaN` parts, which propagate to an Invalid Date or a `null` age rather than
 * silently reading as year zero.
 */
const isoDateParts = (value: IsoDate): [number, number, number] => {
  const [year = NaN, month = NaN, day = NaN] = value.split('-').map(Number);
  return [year, month, day];
};

/** Parses `YYYY-MM-DD` at local midnight. `new Date('2026-08-11')` would be UTC. */
export const fromIsoDate = (value: IsoDate): Date => {
  const [year, month, day] = isoDateParts(value);
  return new Date(year, month - 1, day);
};

/**
 * Calendar arithmetic. Every helper below takes and returns `IsoDate` strings —
 * a `Date` only ever exists inside one of these functions, which is what keeps
 * a timezone from leaking into a stored value.
 *
 * All of it goes through the local-midnight `Date` constructor rather than
 * adding milliseconds: `setDate` moves whole calendar days, so the day after a
 * daylight-saving change is still exactly one day later.
 */

export const addDays = (value: IsoDate, days: number): IsoDate => {
  const date = fromIsoDate(value);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
};

/**
 * `2026-01-15` +1 -> `2026-02-15`, but the day is **clamped** to the target
 * month: `2026-01-31` +1 is `2026-02-28`, not the March 3rd that
 * `setMonth` alone would roll over to.
 */
export const addMonths = (value: IsoDate, months: number): IsoDate => {
  const [year, month, day] = isoDateParts(value);
  // Day 0 of the following month is the last day of the one we want.
  const lastDay = new Date(year, month - 1 + months + 1, 0).getDate();
  return toIsoDate(new Date(year, month - 1 + months, Math.min(day, lastDay)));
};

export const startOfMonth = (value: IsoDate): IsoDate => {
  const [year, month] = isoDateParts(value);
  return toIsoDate(new Date(year, month - 1, 1));
};

export const endOfMonth = (value: IsoDate): IsoDate => {
  const [year, month] = isoDateParts(value);
  return toIsoDate(new Date(year, month, 0));
};

/**
 * Start of the week containing `value`.
 *
 * `weekStartIndex` is a `Date#getDay()` number (0 = Sunday, 1 = Monday), not an
 * iCalendar `WKST` code — the RFC vocabulary lives in `icalendar.ts`, which
 * converts before calling in here.
 */
export const startOfWeek = (value: IsoDate, weekStartIndex: number): IsoDate => {
  const date = fromIsoDate(value);
  const offset = (date.getDay() - weekStartIndex + 7) % 7;
  return addDays(value, -offset);
};

export const isSameMonth = (a: IsoDate, b: IsoDate): boolean => a.slice(0, 7) === b.slice(0, 7);

/**
 * The day-of-month number, for rendering a calendar cell: `2026-03-05` -> `5`.
 *
 * Here rather than at the call site because `YYYY-MM-DD` offsets are this
 * module's business.
 */
export const dayOfMonth = (value: IsoDate): number => isoDateParts(value)[2];

/** Whole years elapsed, or `null` when the birth date is unknown. */
export const ageInYears = (birthDate: IsoDate | null, on: IsoDate = todayISO()): number | null => {
  if (!isIsoDate(birthDate)) return null;

  const [birthYear, birthMonth, birthDay] = isoDateParts(birthDate);
  const [year, month, day] = isoDateParts(on);

  let age = year - birthYear;
  if (month < birthMonth || (month === birthMonth && day < birthDay)) age -= 1;
  return age < 0 || Number.isNaN(age) ? null : age;
};

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' });

/** `2026-03-15` -> `15/03/2026`. */
export const formatDate = (value: IsoDate): string => DATE_FORMAT.format(fromIsoDate(value));

const DATE_MEDIUM_FORMAT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });

/**
 * `2026-01-10` -> `10 janv. 2026`.
 *
 * For somewhere a date is read rather than scanned — a detail page — where the
 * abbreviated month removes the 03/10 ambiguity that `formatDate`'s numeric
 * form carries for anyone used to month-first dates. Lists keep the short form:
 * it stays narrow and every row shares the same shape.
 */
export const formatDateMedium = (value: IsoDate): string =>
  DATE_MEDIUM_FORMAT.format(fromIsoDate(value));

/**
 * `10:30` -> `10h30`, the way a French clock time is written.
 *
 * Not `Intl`: its `fr-FR` time format uses a colon (`10:30`). The `h`
 * separator is a typographic convention it doesn't cover, so it's done here.
 * `null` (an all-day entry) formats as an empty string, which callers drop.
 */
export const formatTime = (time: string | null): string =>
  time === null ? '' : time.replace(':', 'h');

const MONTH_YEAR_FORMAT = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

/** `2026-01-22` -> `Janvier 2026`. French lowercases month names; a title doesn't. */
export const formatMonthYear = (value: IsoDate): string => {
  const label = MONTH_YEAR_FORMAT.format(fromIsoDate(value));
  return label.charAt(0).toUpperCase() + label.slice(1);
};

const DAY_LONG_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** `2026-01-22` -> `22 janvier 2026`. */
export const formatDayLong = (value: IsoDate): string => DAY_LONG_FORMAT.format(fromIsoDate(value));

const WEEKDAY_NARROW_FORMAT = new Intl.DateTimeFormat('fr-FR', { weekday: 'narrow' });
const WEEKDAY_LONG_FORMAT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });

/** The first Sunday of 2024 — an arbitrary week used only to read weekday names off. */
const REFERENCE_SUNDAY = new Date(2024, 0, 7);

export type WeekdayLabel = {
  /** Single letter for the column header: `L`, `M`, `M`, `J`, `V`, `S`, `D`. */
  narrow: string;
  /** Full name, for the header's accessible label. */
  long: string;
};

/**
 * Weekday names for a header row, rotated so the week starts on
 * `weekStartIndex` (a `Date#getDay()` number).
 *
 * Read from `Intl` rather than hardcoded: the narrow forms are already exactly
 * the `L M M J V S D` of the design, and a second locale would need no change
 * here.
 */
export const weekdayLabels = (weekStartIndex: number): WeekdayLabel[] =>
  Array.from({ length: 7 }, (_, index) => {
    const day = new Date(REFERENCE_SUNDAY);
    day.setDate(day.getDate() + ((weekStartIndex + index) % 7));
    return {
      narrow: WEEKDAY_NARROW_FORMAT.format(day),
      long: WEEKDAY_LONG_FORMAT.format(day),
    };
  });

/** `5` -> `5 ans`, `1` -> `1 an`, `null` -> `—`. */
export const formatAge = (age: number | null): string => {
  if (age === null) return '—';
  return age <= 1 ? `${age} an` : `${age} ans`;
};
