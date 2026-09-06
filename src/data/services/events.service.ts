import type { IsoDate } from "../dates.ts";
import {
  formatWorkActivity,
  parseFollowUpValue,
  statusForDate,
  type WorkActivity,
  type WorkSession,
} from "../events.ts";
import { DEFAULT_CURRENCY } from "../money.ts";
import * as eventsRepo from "../repositories/events.repo.ts";
import type { HorseEvent, NewRecord } from "../types.ts";
import {
  eventFormSpec,
  type CounterpartyField,
  type EventTypeKey,
} from "../../types/event.types.ts";

/**
 * Composing and writing an event record.
 *
 * The first module in `src/data/services/`, so it sets what one is: a
 * **command** — the write-side rules for one part of the domain, as plain
 * functions over plain objects. Reads deliberately do not come through here. A
 * view holds a `LiveQuery` over a repository and that is already the right
 * shape; a service standing in between would only be a layer for Dexie's
 * reactivity to see through.
 *
 * What belongs here is everything between "the form parsed" and "the row is
 * written": which column a counterparty lands in, which fields a layout is
 * allowed to contribute at all, what an edit carries over from the record it
 * replaces. All of it used to sit in `event-sheet.ts`'s submit handler, which
 * meant a dialog component owned the definition of an event and the only way to
 * test any of it was to drive a real form in a real browser. It is record
 * arithmetic, and it belongs under the data-layer test rule with the rest of it.
 *
 * The rules a service follows here:
 *
 * - **No state.** Dexie is the store — `live.ts` says so — and a copy held up
 *   here would be a second one, stale from the next write onwards.
 * - **Never called from inside a `LiveQuery` callback.** A command that runs
 *   inside a live query re-triggers the query that ran it.
 * - **It may span repositories, and owns the transaction when it does.** A
 *   repository stays on one table; deleting a horse, or expanding a follow-up
 *   into a real appointment, has no other home. `backup/snapshot.ts` is the
 *   same kind of thing and predates the folder.
 */

/**
 * An event as the entry form describes it — the parsed output of
 * `EVENT_SCHEMA` in `event-sheet.ts`, before anything has been decided about
 * what to store.
 *
 * Deliberately the *form's* shape rather than the record's: `counterparty` has
 * no column yet, the follow-up is still the checkbox and the select rather than
 * an interval, and any of these may arrive filled in from a layout that never
 * asked for them. Taking that as the input is what puts the sorting-out below
 * instead of in every caller.
 */
export type EventInput = {
  type: EventTypeKey;
  /**
   * `null` on the `work` layout, whose Nom field is the Activité combobox
   * (`activity` below) rather than a text field of its own — `eventFields`
   * derives the record's title from that instead of reading one back here.
   */
  title: string | null;
  date: IsoDate;
  amountCents: number | null;
  notes: string | null;
  /** Practitioner or merchant — the layout decides which, and whether either. */
  counterparty: string | null;
  activity: WorkActivity | null;
  planFollowUp: boolean;
  /** `followUpValue()`'s encoding, e.g. `6w`. Parsed below. */
  followUpInterval: string | null;
};

export type SaveEventCommand = {
  /**
   * The horse a new event belongs to. Unused when `existing` is set — an event
   * does not change horse, so an edit must not be able to move one.
   */
  horseId: string;
  /** The record being edited, or `null`/absent to create one. */
  existing?: HorseEvent | null;
  input: EventInput;
};

/**
 * Everything an event row holds except its identity and its horse.
 *
 * Derived from the record rather than restated, so a column added to
 * `HorseEvent` is a type error here — in the one function that has to decide
 * what to put in it — rather than a field silently left `undefined`.
 */
type EventFields = Omit<NewRecord<HorseEvent>, "horseId" | "id">;

/**
 * Creates or updates the event, whichever `existing` calls for.
 *
 * Returns `undefined` only in one case: an edit whose record was soft-deleted
 * between being loaded and being saved — `crud.update` reports a missing row
 * that way rather than throwing. There is nothing left to write and nothing for
 * the caller to do about it, so the sheet treats it as a save.
 */
export const saveEvent = async ({
  horseId,
  existing = null,
  input,
}: SaveEventCommand): Promise<HorseEvent | undefined> => {
  const fields = eventFields(input, existing);
  return existing
    ? eventsRepo.update(existing.id, fields)
    : eventsRepo.create({ horseId, ...fields });
};

export type SetDayActivityCommand = {
  horseId: string;
  date: IsoDate;
  activity: WorkActivity;
  /**
   * The day's session, or `null`/absent when it has none.
   *
   * Passed in rather than looked up here, the same way `SaveEventCommand` takes
   * the record it is replacing: the week strip already holds the whole week in
   * a `LiveQuery`, so the row is in hand at the call site and a read from
   * inside a command would be a second source for the same answer.
   */
  existing?: WorkSession | null;
};

/**
 * Records what the horse did on one day — the week strip's day sheet.
 *
 * **Replaces, never appends.** The strip shows one activity per day and the
 * sheet is titled for that day, so a second row would be invisible in the very
 * place it was entered — `workSessionByDate` keeps the day's first session and
 * nothing would ever draw the rest. Tapping a second chip changes the day's
 * activity, which is what the gesture reads as.
 *
 * On an update the title follows the activity **only while it still is the
 * activity**: a session titled by an earlier tap gets the new label, and one
 * the user renamed in the event sheet ("Séance dressage") keeps their wording.
 * `status` is deliberately not recomputed — the date has not moved, and a
 * cancelled session stays cancelled, as `eventFields` has it.
 *
 * A cancelled row is not a session, so `workSessionByDate` never hands one over
 * and a day whose only `travail` row was cancelled gets a new one. That is the
 * intent: the horse did work after all.
 *
 * Returns `undefined` under the same single condition `saveEvent` does — the
 * row was soft-deleted between the week being read and the chip being tapped.
 */
export const setDayActivity = ({
  horseId,
  date,
  activity,
  existing = null,
}: SetDayActivityCommand): Promise<HorseEvent | undefined> => {
  const title = formatWorkActivity(activity);

  if (!existing) {
    return eventsRepo.create({
      horseId,
      ...dayActivityFields(date, activity, title),
    });
  }

  const renamed = existing.title === formatWorkActivity(existing.activity);
  return eventsRepo.update(
    existing.id,
    renamed ? { activity, title } : { activity },
  );
};

/**
 * A session as the sheet creates one: a date, an activity, and nothing else.
 *
 * Spelled out against `EventFields` rather than filled in loosely, for the same
 * reason `eventFields` is — the type is derived from the record, so a column
 * added to `HorseEvent` fails to compile here instead of arriving `undefined`
 * on every event the strip writes.
 */
const dayActivityFields = (
  date: IsoDate,
  activity: WorkActivity,
  title: string,
): EventFields => ({
  type: "travail",
  title,
  date,
  time: null,
  status: statusForDate(date),
  amountCents: null,
  currency: DEFAULT_CURRENCY,
  providerName: null,
  vendor: null,
  location: null,
  notes: null,
  recurrenceId: null,
  followUpInterval: null,
  activity,
});

/**
 * The form's answers, resolved into a row.
 *
 * Not exported. The `.ics` import that `icalendar.ts` anticipates will want
 * exactly this half without the write, and exporting it then is one line —
 * `db.ts` states the rule this follows: add it back with its caller, not before.
 */
const eventFields = (
  input: EventInput,
  existing: HorseEvent | null,
): EventFields => {
  // Read from the type being *saved*, not from whichever layout the form was
  // last showing. The record's own type is what decides its columns, which is
  // the rule `EventDetailView` already reads its Informations rows by and the
  // sheet reads its prefill by — so the column a value was written to and the
  // column it is read back from cannot disagree.
  const spec = eventFormSpec(input.type);

  // Written from the layout rather than from whatever the form still holds, so
  // a field this layout does not draw can never reach the record — and only
  // ever one of the two, because a layout has at most one counterparty.
  const columns: Record<CounterpartyField["column"], string | null> = {
    providerName: null,
    vendor: null,
  };
  if (spec.counterparty) columns[spec.counterparty.column] = input.counterparty;

  return {
    type: input.type,
    // On the `work` layout the Nom field is the Activité combobox
    // (`#renderActivity` in `event-sheet.ts`), not a text field of its own, so
    // the title comes from what it holds — formatted the same way
    // `dayActivityFields` derives one from a week-strip tap, so a session
    // reads the same whichever entry point wrote it.
    title:
      spec.activity && input.activity !== null
        ? formatWorkActivity(input.activity)
        : (input.title ?? ""),
    date: input.date,
    // No layout has a time control, so a new event is all-day. An edit keeps
    // whatever time the record already had rather than discarding it through a
    // form that cannot show it.
    time: existing?.time ?? null,
    // Derived rather than asked for: the date already says which is meant. A
    // cancelled event is the exception — re-deriving would quietly bring it
    // back to life on any edit that touches nothing else.
    status:
      existing?.status === "cancelled"
        ? existing.status
        : statusForDate(input.date),
    // Same rule as `activity` below: `work` is the one layout with no Budget
    // field, so an edit must not carry over a value entered under a
    // different type — or, now, one saved before `work` stopped asking.
    amountCents: spec.amount ? input.amountCents : null,
    currency: existing?.currency ?? DEFAULT_CURRENCY,
    ...columns,
    location: existing?.location ?? null,
    notes: input.notes,
    recurrenceId: existing?.recurrenceId ?? null,
    // The checkbox is not proof on its own. The sheet seeds it from the record
    // being edited, so an event saved under a type whose layout has no
    // follow-up field at all can still arrive here with it ticked.
    followUpInterval:
      spec.followUp && input.planFollowUp
        ? parseFollowUpValue(input.followUpInterval)
        : null,
    // Same rule as the columns above, and the same reason: a layout that does
    // not ask what was done must not carry an answer left over from the type
    // the user picked before.
    activity: spec.activity ? input.activity : null,
  };
};
