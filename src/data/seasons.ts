import { todayISO, type IsoDate } from './dates.ts';

/**
 * Seasonal feeding windows.
 *
 * A ration line is either fed all year (`season === null`) or only during a
 * recurring stretch of the calendar — linseed oil and vitamin E go in from
 * October through April, when there is no grass.
 *
 * The window is two **month numbers**, not two dates, because it repeats every
 * year: storing `2025-10-01`/`2026-04-30` would make the record silently wrong
 * on 1 May 2026. Months also keep the whole thing timezone-free, like the rest
 * of `dates.ts`.
 *
 * Both ends are **inclusive**, and `to` may be earlier than `from` — a winter
 * window wraps the year boundary, which here is the normal case rather than the
 * edge one. Every helper below handles that wrap; don't compare `from`/`to`
 * directly at a call site.
 */

/** 1 = January. Deliberately not `Date#getMonth()`'s 0-based number. */
export type MonthNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export type RationSeason = {
  /** First month the line is fed, inclusive. */
  from: MonthNumber;
  /** Last month the line is fed, inclusive. May be `< from` (wraps the year). */
  to: MonthNumber;
};

/**
 * October → April.
 *
 * The sheet offers seasonality as a single checkbox, so ticking it has to pick
 * a window. This is the one the feed plan actually uses — the winter
 * supplements. Month-by-month editing can come later without touching the
 * stored shape, which already carries both ends.
 */
export const DEFAULT_SEASON: RationSeason = { from: 10, to: 4 };

export const isMonthNumber = (value: unknown): value is MonthNumber =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12;

export const isRationSeason = (value: unknown): value is RationSeason =>
  typeof value === 'object' &&
  value !== null &&
  isMonthNumber((value as Partial<RationSeason>).from) &&
  isMonthNumber((value as Partial<RationSeason>).to);

/** The month component of an `IsoDate`, or `null` if the string is malformed. */
export const monthOf = (date: IsoDate): MonthNumber | null => {
  const month = Number(date.slice(5, 7));
  return isMonthNumber(month) ? month : null;
};

/**
 * Whether a line is being fed on a given day.
 *
 * A `null` season means all year. An unparseable date also reads as in season:
 * the failure mode of this predicate is a struck-out row on the feed plan, and
 * showing a line that shouldn't be fed is safer than hiding one that should.
 */
export const isInSeason = (season: RationSeason | null, on: IsoDate = todayISO()): boolean => {
  if (season === null) return true;

  const month = monthOf(on);
  if (month === null) return true;

  return season.from <= season.to
    ? month >= season.from && month <= season.to
    : // Wraps the year: October..December OR January..April.
      month >= season.from || month <= season.to;
};

/** Reference year for reading month names off `Intl`. Any non-leap year does. */
const monthDate = (month: MonthNumber): Date => new Date(2001, month - 1, 1);

const MONTH_SHORT_FORMAT = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const MONTH_LONG_FORMAT = new Intl.DateTimeFormat('fr-FR', { month: 'long' });

const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

/** `10` -> `Oct.`. French only abbreviates the long ones, which is what `Intl` gives. */
export const formatMonthShort = (month: MonthNumber): string =>
  capitalize(MONTH_SHORT_FORMAT.format(monthDate(month)));

/** `10` -> `octobre`. Lowercase: it appears mid-sentence. */
export const formatMonthLong = (month: MonthNumber): string =>
  MONTH_LONG_FORMAT.format(monthDate(month));

/**
 * `10` -> `d’octobre`, `5` -> `de mai`.
 *
 * French elides `de` before a vowel, which among month names hits avril, août
 * and octobre. Exported because more than one sentence in the app needs it —
 * the suspension footnote and the budget card's "Budget d’août".
 */
export const formatMonthDe = (month: MonthNumber): string => {
  const name = formatMonthLong(month);
  return /^[aeiouâàéèêîôû]/i.test(name) ? `d’${name}` : `de ${name}`;
};

/** `{ from: 10, to: 4 }` -> `Oct. → Avr.` — the subtitle under a seasonal line. */
export const formatSeasonRange = (season: RationSeason): string =>
  `${formatMonthShort(season.from)} → ${formatMonthShort(season.to)}`;

/**
 * The *gap*, not the window: `{ from: 10, to: 4 }` -> `d’avril à octobre`.
 *
 * Phrased from the season's own endpoints rather than the strictly-suspended
 * months (May..September) because that is how the plan reads out loud — "off
 * from April until October" — and it keeps the two months a user recognises
 * from the row above in the sentence.
 */
export const formatSuspensionRange = (season: RationSeason): string =>
  `${formatMonthDe(season.to)} à ${formatMonthLong(season.from)}`;

const sameSeason = (a: RationSeason, b: RationSeason): boolean =>
  a.from === b.from && a.to === b.to;

/**
 * The footnote under the feed plan: `2 produits saisonniers suspendus d’avril
 * à octobre.`, or `null` when nothing is currently suspended.
 *
 * Takes the seasons of every line (nulls included) rather than the records, so
 * it stays a pure function of the windows. The shared-window phrasing collapses
 * to a bare count when the suspended lines don't all agree — one sentence
 * cannot name two different gaps without lying about one of them.
 */
export const summariseSuspension = (
  seasons: (RationSeason | null)[],
  on: IsoDate = todayISO(),
): string | null => {
  const suspended = seasons.filter(
    (season): season is RationSeason => season !== null && !isInSeason(season, on),
  );
  if (suspended.length === 0) return null;

  const [first] = suspended;
  const plural = suspended.length > 1 ? 's' : '';
  const subject = `${suspended.length} produit${plural} saisonnier${plural} suspendu${plural}`;

  return first && suspended.every((season) => sameSeason(season, first))
    ? `${subject} ${formatSuspensionRange(first)}.`
    : `${subject}.`;
};

/**
 * Reads a v1 `RationItem.seasonal` boolean as a window.
 *
 * Shared by the Dexie upgrade and the backup migration so the two can't
 * disagree about what an old row meant. v1 recorded *that* a line was seasonal
 * but never *when*, so there is nothing to recover — every seasonal row adopts
 * the default window.
 */
export const seasonFromLegacyFlag = (seasonal: unknown): RationSeason | null =>
  seasonal === true ? { ...DEFAULT_SEASON } : null;
