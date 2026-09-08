import { db } from "../db.ts";
import { todayISO, type IsoDate } from "../dates.ts";
import { sumByType } from "../budget.ts";
import { isAppointmentType } from "../event-types.ts";
import { sumCents } from "../money.ts";
import { createRecord, crud, liveOnly } from "../record.ts";
import type { EventTypeDef, HorseEvent, NewRecord } from "../types.ts";

/**
 * Queries over the unified events table.
 *
 * "Rendez-vous à venir" and "Dépenses" are two views of the same rows, not
 * two tables: an appointment is a future `date`, an budget is a non-null
 * `amountCents`. Both lean on the `[horseId+date]` compound index.
 */

// IndexedDB range bounds. '' sorts before every date string, '￿' after.
const MIN_DATE = "";
const MAX_DATE = "￿";

const byHorseAndDateRange = (horseId: string, from: IsoDate, to: IsoDate) =>
  db.events
    .where("[horseId+date]")
    .between([horseId, from], [horseId, to], true, true)
    .toArray();

export const { get, update, remove } = crud<HorseEvent>(db.events);

/** Every live event for a horse, newest first. */
export const listByHorse = async (horseId: string): Promise<HorseEvent[]> => {
  const events = await byHorseAndDateRange(horseId, MIN_DATE, MAX_DATE);
  return liveOnly(events).reverse();
};

/** Events falling inside a calendar range, oldest first. */
export const listInRange = async (
  horseId: string,
  from: IsoDate,
  to: IsoDate,
): Promise<HorseEvent[]> =>
  liveOnly(await byHorseAndDateRange(horseId, from, to));

/**
 * Still-to-happen appointments, soonest first.
 *
 * Narrowed to the types that are actually *taken* rather than logged — see
 * `isAppointmentType`. A planned purchase or lesson is a future event, not a
 * rendez-vous, and filtering it here rather than in the view is what keeps the
 * limit honest: the caller asks for three and gets three appointments.
 *
 * `types` is passed in rather than read here, the same way `sumByType` takes
 * it: this repository stays on the `events` table alone, and the caller
 * (`HomeView`) already holds the catalogue in its own `LiveQuery`. That query
 * is gated on writes to `events`, not to `eventTypes` — a type's
 * `isAppointment` flag changing after this ran would not retroactively
 * re-filter until the next write to `events` itself, an edge case with no
 * built-in UI to trigger it yet.
 */
export const listUpcoming = async (
  horseId: string,
  types: EventTypeDef[],
  limit?: number,
): Promise<HorseEvent[]> => {
  const events = await byHorseAndDateRange(horseId, todayISO(), MAX_DATE);
  const upcoming = liveOnly(events).filter(
    (event) =>
      event.status === "planned" && isAppointmentType(types, event.type),
  );
  return limit === undefined ? upcoming : upcoming.slice(0, limit);
};

/**
 * Events that cost something — i.e. the budget ledger.
 *
 * Reads `customFields.amountCents`, schema v6's replacement for the fixed
 * `amountCents` column — present, and a number, only for a type whose fields
 * carry an amount at all. A zero-cost row still counts: it was recorded
 * deliberately, and it is the *absence* of the field that means "this type
 * has no budget".
 */
export const listBudget = async (
  horseId: string,
  from: IsoDate = MIN_DATE,
  to: IsoDate = MAX_DATE,
): Promise<HorseEvent[]> => {
  const events = await listInRange(horseId, from, to);
  return events.filter(
    (event) =>
      typeof event.customFields.amountCents === "number" &&
      event.status !== "cancelled",
  );
};

/** Total spend in cents over a range. */
export const totalSpent = async (
  horseId: string,
  from: IsoDate = MIN_DATE,
  to: IsoDate = MAX_DATE,
): Promise<number> => {
  const budget = await listBudget(horseId, from, to);
  return sumCents(
    budget.map((event) => {
      const amount = event.customFields.amountCents;
      return typeof amount === "number" ? amount : null;
    }),
  );
};

/**
 * Spend broken down by category.
 *
 * The reduce itself lives in `budget.ts` so the budget view — which
 * aggregates in memory, because a `liveQuery` narrowed by a user-selected period
 * would go stale — and this query cannot disagree about what a breakdown is.
 * Returned as a record because that is the shape callers of this repository
 * expect; the ordered slice list is `sumByType`'s own return.
 */
export const totalSpentByType = async (
  horseId: string,
  types: EventTypeDef[],
  from: IsoDate = MIN_DATE,
  to: IsoDate = MAX_DATE,
): Promise<Partial<Record<string, number>>> => {
  const slices = sumByType(await listBudget(horseId, from, to), types);
  return Object.fromEntries(slices.map((slice) => [slice.type, slice.cents]));
};

export const create = async (
  fields: NewRecord<HorseEvent>,
): Promise<HorseEvent> => {
  const event = createRecord<HorseEvent>(fields);
  await db.events.add(event);
  return event;
};
