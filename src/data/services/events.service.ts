import { todayISO, type IsoDate } from "../dates.ts";
import { BASE_FIELD_IDS, fieldWithRole } from "../event-types.ts";
import {
  formatWorkActivity,
  statusForDate,
  type WorkActivity,
  type WorkSession,
} from "../events.ts";
import { DEFAULT_CURRENCY } from "../money.ts";
import * as eventsRepo from "../repositories/events.repo.ts";
import type {
  CustomFieldDef,
  EventTypeDef,
  HorseEvent,
  NewRecord,
} from "../types.ts";

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
  /** The type's `key` — validated against the live catalogue by the sheet. */
  type: string;
  /**
   * Every field's answer, keyed by `CustomFieldDef.id`, in one bag.
   *
   * The type's `fields` array describes the whole form — Nom, Date and Note
   * included — so there is nothing left for this type to name individually.
   * Which of these lands on a `HorseEvent` column and which in `customFields`
   * is decided below, by `BASE_FIELD_IDS`, not by the form.
   */
  values: Record<string, string | number | boolean | null>;
};

export type SaveEventCommand = {
  /**
   * The horse a new event belongs to. Unused when `existing` is set — an event
   * does not change horse, so an edit must not be able to move one.
   */
  horseId: string;
  /** The record being edited, or `null`/absent to create one. */
  existing?: HorseEvent | null;
  /**
   * The type `input.type` names, already resolved. Reading it back out of the
   * live catalogue is not this service's job — see the file's own rule above,
   * "No state": the sheet already holds the catalogue in a `LiveQuery` to
   * render the type picker, so it is the one place that resolution belongs.
   */
  type: EventTypeDef;
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
  type,
  input,
}: SaveEventCommand): Promise<HorseEvent | undefined> => {
  const fields = eventFields(type, input, existing);
  return existing
    ? eventsRepo.update(existing.id, fields)
    : eventsRepo.create({ horseId, ...fields });
};

export type SetDayActivityCommand = {
  horseId: string;
  date: IsoDate;
  /** The `tracksWork` type this session belongs to — resolved by the caller,
   * the same way `SaveEventCommand.type` is. */
  type: EventTypeDef;
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
  type,
  activity,
  existing = null,
}: SetDayActivityCommand): Promise<HorseEvent | undefined> => {
  const title = formatWorkActivity(activity);
  // Guaranteed by `type.tracksWork` being true, by construction: a
  // `tracksWork` type always carries exactly one `workActivity` field.
  const fieldId = fieldWithRole(type, "workActivity")?.id ?? "activity";

  if (!existing) {
    return eventsRepo.create({
      horseId,
      ...dayActivityFields(type, fieldId, date, activity, title),
    });
  }

  const renamed = existing.title === formatWorkActivity(existing.activity);
  // Merged rather than replaced: `existing.customFields` may hold other keys
  // in principle, and a plain overwrite would drop them.
  const customFields = { ...existing.customFields, [fieldId]: activity };
  return eventsRepo.update(
    existing.id,
    renamed ? { customFields, title } : { customFields },
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
  type: EventTypeDef,
  fieldId: string,
  date: IsoDate,
  activity: WorkActivity,
  title: string,
): EventFields => ({
  type: type.key,
  title,
  date,
  time: null,
  status: statusForDate(date),
  currency: DEFAULT_CURRENCY,
  location: null,
  notes: null,
  recurrenceId: null,
  customFields: { [fieldId]: activity },
});

/**
 * A work session's title, taken from the activity it recorded.
 *
 * On a `workActivity` type the Nom field is the Activité combobox rather than
 * a text field of its own, so the record's title comes from what it holds —
 * formatted the same way `dayActivityFields` derives one from a week-strip
 * tap, so a session reads the same whichever entry point wrote it. `null` when
 * the type has no such field, or the field was left blank.
 */
const workTitle = (
  activityField: CustomFieldDef | undefined,
  customFields: HorseEvent["customFields"],
): string | null => {
  if (!activityField) return null;
  const value = customFields[activityField.id];
  return typeof value === "string" && value !== ""
    ? formatWorkActivity(value)
    : null;
};

/**
 * The form's answers, resolved into a row.
 *
 * Not exported. The `.ics` import that `icalendar.ts` anticipates will want
 * exactly this half without the write, and exporting it then is one line —
 * `db.ts` states the rule this follows: add it back with its caller, not before.
 */
const eventFields = (
  type: EventTypeDef,
  input: EventInput,
  existing: HorseEvent | null,
): EventFields => {
  const activityField = fieldWithRole(type, "workActivity");
  const text = (id: string): string | null => {
    const value = input.values[id];
    return typeof value === "string" && value !== "" ? value : null;
  };

  // Driven by the type's own field list: a value for a field this type does
  // not declare can never reach the record, and a field it does declare is
  // always written — as `null` when left blank — so a row never carries a key
  // its type has no answer for.
  const customFields: HorseEvent["customFields"] = {};
  for (const field of type.fields) {
    if (BASE_FIELD_IDS.has(field.id)) continue;
    customFields[field.id] = input.values[field.id] ?? null;
  }

  return {
    type: type.key,
    // A `workActivity` field doubles as the record's title, so a type that has
    // one lists no Nom row at all.
    title: workTitle(activityField, customFields) ?? text("title") ?? "",
    date: (text("date") ?? existing?.date ?? todayISO()) as IsoDate,
    // No type has a time control, so a new event is all-day. An edit keeps
    // whatever time the record already had.
    time: existing?.time ?? null,
    // Derived rather than asked for: the date already says which is meant. A
    // cancelled event is the exception — re-deriving would quietly bring it
    // back to life on any edit that touches nothing else.
    status:
      existing?.status === "cancelled"
        ? existing.status
        : statusForDate(
            (text("date") ?? existing?.date ?? todayISO()) as IsoDate,
          ),
    currency: existing?.currency ?? DEFAULT_CURRENCY,
    location: existing?.location ?? null,
    notes: text("notes"),
    recurrenceId: existing?.recurrenceId ?? null,
    customFields,
  };
};
