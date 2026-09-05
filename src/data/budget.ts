import { todayISO, type IsoDate } from "./dates.ts";
import { formatMonthLong, formatMonthShort, monthOf } from "./seasons.ts";
import { EVENT_TYPES, type EventTypeKey } from "../types/event.types.ts";
import type { HorseEvent } from "./types.ts";

/**
 * The arithmetic behind the budget view.
 *
 * Pure functions over records the caller already fetched, in `src/data/` for the
 * same reason `forms.ts` and `seasons.ts` are: it is money arithmetic, which is
 * exactly the kind of thing the data-layer test rule exists to guard. The view
 * holds the query; this file holds the maths.
 */

export type BudgetGranularity = "month" | "year";

/**
 * A period is a **date prefix**, not a pair of bounds: `2026-01` or `2026`.
 *
 * Stored dates are `YYYY-MM-DD` strings, so a prefix test is exact, needs no
 * `Date` and cannot drift across a timezone the way a start/end pair built from
 * local midnights can.
 */
export type BudgetPeriod = { granularity: BudgetGranularity; key: string };

/** One wedge of the donut: a category and what was spent on it. */
export type BudgetSlice = { type: EventTypeKey; cents: number };

const PERIOD_KEY_LENGTH: Record<BudgetGranularity, number> = {
  month: 7,
  year: 4,
};

/** The period a given day belongs to. */
export const periodOf = (
  date: IsoDate,
  granularity: BudgetGranularity,
): BudgetPeriod => ({
  granularity,
  key: date.slice(0, PERIOD_KEY_LENGTH[granularity]),
});

/** The events falling inside a period, order preserved. */
export const inPeriod = (
  events: HorseEvent[],
  period: BudgetPeriod,
): HorseEvent[] => events.filter((event) => event.date.startsWith(period.key));

/**
 * Spend per category, in `EVENT_TYPES` order, categories with nothing spent on
 * them dropped.
 *
 * The fixed order matters more than it looks: it is what keeps a category — and
 * therefore its colour and its neighbours — in the same place in the ring from
 * one month to the next. Sorting by amount would reshuffle the whole donut every
 * time a single budget was added.
 */
export const sumByType = (events: HorseEvent[]): BudgetSlice[] => {
  const totals = new Map<EventTypeKey, number>();
  for (const event of events) {
    totals.set(
      event.type,
      (totals.get(event.type) ?? 0) + (event.amountCents ?? 0),
    );
  }

  return EVENT_TYPES.flatMap((type) => {
    const cents = totals.get(type) ?? 0;
    return cents === 0 ? [] : [{ type, cents }];
  });
};

export const sumSlices = (slices: BudgetSlice[]): number =>
  slices.reduce((total, slice) => total + slice.cents, 0);

/**
 * The periods the picker offers: every one present in the data, newest first,
 * plus today's own.
 *
 * Today is always included even when nothing has been spent in it — otherwise a
 * fresh install opens the picker on an empty list, or worse, on a period the
 * view is already showing.
 */
export const periodOptions = (
  events: HorseEvent[],
  granularity: BudgetGranularity,
  on: IsoDate = todayISO(),
): BudgetPeriod[] => {
  const keys = new Set(
    events.map((event) => periodOf(event.date, granularity).key),
  );
  keys.add(periodOf(on, granularity).key);

  return [...keys]
    .sort((a, b) => b.localeCompare(a))
    .map((key) => ({ granularity, key }));
};

/**
 * The picker's label: `Janv.` this year, `Janv. 2025` outside it, `2026` for a
 * year.
 *
 * The year is spelled out only when it is not the current one — the design's
 * pill is a bare month, and repeating "2026" on every option of a list that is
 * mostly 2026 is noise. Ambiguity only appears once the list reaches back into
 * another year, which is exactly when the suffix appears.
 */
export const formatPeriod = (
  period: BudgetPeriod,
  on: IsoDate = todayISO(),
): string => {
  if (period.granularity === "year") return period.key;

  const month = monthOf(`${period.key}-01`);
  if (month === null) return period.key;

  const label = formatMonthShort(month);
  const year = period.key.slice(0, 4);
  return year === on.slice(0, 4) ? label : `${label} ${year}`;
};

/** The donut's centre line: `en janvier`, `en 2026`. */
export const formatPeriodNote = (period: BudgetPeriod): string => {
  if (period.granularity === "year") return `en ${period.key}`;

  const month = monthOf(`${period.key}-01`);
  return month === null ? "" : `en ${formatMonthLong(month)}`;
};

/** `Dépenses mensuelles` / `Dépenses annuelles`. */
export const formatPeriodHeading = (granularity: BudgetGranularity): string =>
  granularity === "month" ? "Dépenses mensuelles" : "Dépenses annuelles";

/**
 * Sorts budget newest first.
 *
 * `listBudget` runs a range scan, so it comes back oldest first — the opposite
 * of how a ledger reads. Ties break on `createdAt` so two events on the same day
 * keep a stable order instead of depending on index insertion.
 */
export const byDateDescending = (a: HorseEvent, b: HorseEvent): number =>
  b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);
