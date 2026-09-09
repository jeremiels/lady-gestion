import { todayISO, type IsoDate } from "./dates.ts";
import type { FieldError } from "./forms.ts";
import { formatCents } from "./money.ts";
import type { EventStatus, EventTypeDef, HorseEvent } from "./types.ts";

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
export const statusForDate = (
  date: IsoDate,
  on: IsoDate = todayISO(),
): EventStatus => (date > on ? "planned" : "done");

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
export type FollowUpUnit = "week" | "month";

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
export const DEFAULT_FOLLOW_UP: FollowUpInterval = { amount: 6, unit: "week" };

/** The intervals the form offers, shortest first. */
export const FOLLOW_UP_INTERVALS: FollowUpInterval[] = [
  { amount: 2, unit: "week" },
  { amount: 4, unit: "week" },
  DEFAULT_FOLLOW_UP,
  { amount: 8, unit: "week" },
  { amount: 3, unit: "month" },
  { amount: 6, unit: "month" },
  { amount: 12, unit: "month" },
];

/**
 * What was done in a schooling session — the entry form's Nom field on a
 * `travail` event (`#renderActivity` in `event-sheet.ts`).
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
export type BuiltInActivity =
  | "balade"
  | "longe"
  | "tap"
  | "liberte"
  | "plat"
  | "trotting";

/**
 * A built-in key, or a label the user typed.
 *
 * `(string & {})` rather than a bare `string`: the union keeps editor completion
 * on the six built-ins, which widening to `string` would silently drop.
 */
export type WorkActivity = BuiltInActivity | (string & {});

/** In the order the sheet offers them. */
const WORK_ACTIVITY_LABELS: Record<BuiltInActivity, string> = {
  balade: "Balade à pied",
  longe: "Longe",
  tap: "TAP",
  liberte: "Liberté",
  plat: "Plat",
  trotting: "Trotting",
};

/** Derived from the table above, so the list and the labels cannot drift. */
export const WORK_ACTIVITIES = Object.keys(
  WORK_ACTIVITY_LABELS,
) as BuiltInActivity[];

/**
 * A `Map` rather than indexing the `Record` above.
 *
 * That record's keys are literal, so reading it with an arbitrary
 * `WorkActivity` needs a cast — and the cast would type a miss as `string`
 * instead of `undefined`, which is the exact value the fallback below is built
 * on. The one that type-checks is the one that lies.
 */
const LABELS: ReadonlyMap<string, string> = new Map(
  Object.entries(WORK_ACTIVITY_LABELS),
);

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
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr-FR");

/**
 * The chips the day sheet offers: the six built-ins and the user's own,
 * alphabetically by their displayed label — so a custom activity takes its
 * place among the built-ins rather than always trailing them, and the list
 * stays scannable as it grows.
 *
 * Deduplicated on what each choice *reads as* rather than on what it stores, so
 * a user who types "Trotting" gets the built-in `trotting` back instead of a
 * second chip spelling the same word.
 */
export const activityChoices = (custom: string[]): WorkActivity[] => {
  const choices: WorkActivity[] = [...WORK_ACTIVITIES];
  const seen = new Set(
    choices.map((choice) => activityKey(formatWorkActivity(choice))),
  );

  for (const label of custom) {
    const key = activityKey(label);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    choices.push(label);
  }

  return choices.sort((a, b) =>
    formatWorkActivity(a).localeCompare(formatWorkActivity(b), "fr-FR"),
  );
};

/**
 * The choice a typed label already stands for, or `null` when it is a new one.
 *
 * The sheet's input and its chips must not be able to disagree: typing the name
 * of a chip already on screen has to select that chip, not write a second
 * activity that renders identically to it.
 */
export const matchActivity = (
  label: string,
  choices: WorkActivity[],
): WorkActivity | null => {
  const key = activityKey(label);
  if (key === "") return null;

  return (
    choices.find((choice) => activityKey(formatWorkActivity(choice)) === key) ??
    null
  );
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

/**
 * A `travail`-like row that actually says what was done — what the strip
 * draws. `activity` is a real property here, populated by `workSessionByDate`
 * from whichever `customFields` key the row's own type uses for it — not a
 * passthrough of a fixed column, since schema v6 stopped events having one.
 */
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
 * `types` says which type(s) track work (`tracksWork`) and which
 * `customFields` key each uses for the activity — generic over the type
 * rather than hardcoded to `"travail"`, so a second `tracksWork` type a future
 * builder UI creates is picked up here for free. Pure, over rows and types the
 * caller already fetched — the shape `budget.ts` uses, and what puts this
 * under the data-layer test rule rather than a component suite.
 */
export const workSessionByDate = (
  events: HorseEvent[],
  types: EventTypeDef[],
): Map<IsoDate, WorkSession> => {
  const activityFieldIdByType = new Map(
    types
      .filter((type) => type.tracksWork)
      .map(
        (type) =>
          [
            type.key,
            type.fields.find((field) => field.role === "workActivity")?.id,
          ] as const,
      )
      .filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

  const sessions = events
    .flatMap((event) => {
      const fieldId = activityFieldIdByType.get(event.type);
      if (!fieldId || event.status === "cancelled") return [];

      const activity = event.customFields[fieldId];
      if (typeof activity !== "string" || activity === "") return [];

      return [{ ...event, activity } satisfies WorkSession];
    })
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
export const workActivityByDate = (
  events: HorseEvent[],
  types: EventTypeDef[],
): Map<IsoDate, WorkActivity> =>
  new Map(
    [...workSessionByDate(events, types)].map(([date, session]) => [
      date,
      session.activity,
    ]),
  );

export const isFollowUpInterval = (
  value: unknown,
): value is FollowUpInterval => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FollowUpInterval>;
  return (
    typeof candidate.amount === "number" &&
    Number.isInteger(candidate.amount) &&
    candidate.amount > 0 &&
    (candidate.unit === "week" || candidate.unit === "month")
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
  `${interval.amount}${interval.unit === "week" ? "w" : "m"}`;

/** The inverse of `followUpValue`. Returns `null` for anything unrecognised. */
export const parseFollowUpValue = (value: unknown): FollowUpInterval | null => {
  if (typeof value !== "string") return null;

  const match = /^(\d+)([wm])$/.exec(value);
  if (!match) return null;

  const interval = {
    amount: Number(match[1]),
    unit: match[2] === "w" ? "week" : "month",
  };
  return isFollowUpInterval(interval) ? interval : null;
};

/** `{ amount: 6, unit: 'week' }` -> `6 semaines`. `mois` is already invariant. */
export const formatFollowUpInterval = (interval: FollowUpInterval): string => {
  // A year reads as a year; "12 mois" is technically right and nobody says it.
  if (interval.unit === "month" && interval.amount === 12) return "1 an";

  if (interval.unit === "month") return `${interval.amount} mois`;
  return interval.amount === 1 ? "1 semaine" : `${interval.amount} semaines`;
};

/**
 * A product quantity's unit — `alimentation`'s "Quantité du produit" field.
 *
 * Its own closed list rather than a reuse of `RationUnit` (`types.ts`): that
 * one belongs to the unrelated daily feed plan and carries six values built
 * for that plan's own needs (`dose`, `mesure`); coupling the two would make a
 * change to the ration vocabulary ripple into event storage for no reason.
 */
export type QuantityUnit = "mL" | "kg" | "L";

/** The options `app-unit-select` offers on the `quantity` field. */
export const QUANTITY_UNITS: readonly QuantityUnit[] = ["mL", "kg", "L"];

const isQuantityUnit = (value: string): value is QuantityUnit =>
  (QUANTITY_UNITS as readonly string[]).includes(value);

/**
 * `{ amount: 40, unit: 'mL' }` -> `"40 mL"` — the single scalar a `quantity`
 * field stores in `customFields`, French-locale formatted like
 * `formatRationAmount` (`types/horse.types.ts`) so "1,5 L" reads the same
 * wherever a quantity appears in this app.
 */
export const formatQuantity = (amount: number, unit: QuantityUnit): string =>
  `${amount.toLocaleString("fr-FR")} ${unit}`;

/**
 * The inverse of `formatQuantity`, for prefilling the amount/unit pair when
 * editing an event. `null` for anything that doesn't parse — an empty field
 * rather than a guess.
 */
export const parseQuantity = (
  stored: string,
): { amount: number; unit: QuantityUnit } | null => {
  const spaceAt = stored.lastIndexOf(" ");
  if (spaceAt === -1) return null;

  const unit = stored.slice(spaceAt + 1);
  if (!isQuantityUnit(unit)) return null;

  const amount = Number(stored.slice(0, spaceAt).replace(",", "."));
  return Number.isFinite(amount) ? { amount, unit } : null;
};

/**
 * The amount and the unit of a `quantity` field are required together — a
 * bare number with no unit, or a unit with nothing to measure, is worse than
 * asking again. `{}` when both or neither are present.
 *
 * A pure function rather than inline in `event-sheet.ts`'s submit handler, for
 * the same reason `events.service.ts` exists at all: this is record
 * arithmetic, and belongs under the data-layer test rule rather than reachable
 * only from a browser suite.
 */
export const quantityPairErrors = (
  amount: number | null,
  unit: string | null,
): { amount?: FieldError; unit?: FieldError } => {
  if ((amount === null) === (unit === null)) return {};
  return amount === null
    ? { amount: "Indiquez une quantité." }
    : { unit: "Choisissez une unité." };
};

/**
 * A pre-v6 event's fixed columns — `providerName`, `vendor`,
 * `followUpInterval`, `activity`, `amountCents` — before they folded into
 * `customFields`. Read by both halves of the schema v6 migration; see
 * `migrateEventToCustomFields` below.
 */
export type LegacyEventColumns = {
  providerName: string | null;
  vendor: string | null;
  followUpInterval: FollowUpInterval | null;
  activity: string | null;
  amountCents: number | null;
};

/**
 * Folds a pre-v6 event's fixed columns into a `customFields` bag, and
 * corrects the one built-in type whose key changed shape in the same
 * migration (`coucours` → `concours`, see `event-types.ts`).
 *
 * Takes and returns only the columns that change — `type` and the bag — so
 * `db.ts`'s live upgrade can assign the result onto a row it is mutating in
 * place, and `backup/snapshot.ts` onto a row it is rebuilding wholesale,
 * without either having to agree on the rest of the record's exact shape.
 * Shared by both for the reason `db.ts`'s own comment gives for why the two
 * migrations "must agree": a database upgraded on the device and a backup
 * file restored from an older build have to fold identically.
 *
 * `types` is the *target* schema's type list, with `BaseRecord` fields already
 * filled in (`seedEventTypeDefs` in `event-types.ts`): whether `amountCents`
 * survives depends on whether the row's type still has an amount field, which
 * only the new schema can say — the old one had no such concept.
 */
/**
 * Where a `travail` row's money would otherwise go.
 *
 * `amountCents` only survives the fold above when the row's *target* type
 * still carries an amount field, and one built-in does not: `travail` lost
 * its Budget field in `c60fc47`. Every other legacy column has a home on
 * every type that ever used it, so this is the one column the migration can
 * be handed with nowhere to put it — and dropping money silently is the
 * worst thing a migration can do to a budget app.
 *
 * The value is appended to `notes` rather than given a field: writing it to
 * a column the type does not have would be invalid, and adding the field to
 * `travail` would repaint a type on every installed device — a catalogue
 * change, which is exactly the class of edit this app is trying to stop
 * paying a schema version for. A note is inert, visible on the event itself,
 * and survives the backup round trip like any other text.
 *
 * Both halves of the v6 migration share it for the reason they share the
 * fold: a device upgraded in place and a file restored from an older build
 * have to strand identically.
 *
 * Zero is not stranded — it is the absence of a budget, not a lost one.
 */
const strandedAmountNotes = (
  row: { notes: string | null } & Pick<LegacyEventColumns, "amountCents">,
  has: (fieldId: string) => boolean,
): string | null => {
  const amount = row.amountCents;
  if (!amount || has("amountCents")) return row.notes;

  const line = `Budget conservé lors de la migration : ${formatCents(amount)}.`;
  return row.notes ? `${row.notes}\n${line}` : line;
};

export const migrateEventToCustomFields = (
  row: { type: string; notes: string | null } & LegacyEventColumns,
  types: EventTypeDef[],
): {
  type: string;
  customFields: HorseEvent["customFields"];
  notes: string | null;
} => {
  const type = row.type === "coucours" ? "concours" : row.type;
  const def = types.find((candidate) => candidate.key === type);
  const has = (fieldId: string) =>
    def?.fields.some((field) => field.id === fieldId) ?? false;

  const customFields: HorseEvent["customFields"] = {};
  if (has("counterparty")) {
    customFields.counterparty = row.providerName ?? row.vendor ?? null;
  }
  if (has("followUp")) {
    customFields.followUp = row.followUpInterval
      ? followUpValue(row.followUpInterval)
      : null;
  }
  if (has("activity")) customFields.activity = row.activity;
  if (has("amountCents")) customFields.amountCents = row.amountCents;

  return { type, customFields, notes: strandedAmountNotes(row, has) };
};
