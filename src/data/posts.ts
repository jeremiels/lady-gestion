import { daysBetween, isIsoDate, todayISO, type IsoDate } from "./dates.ts";
import type { FieldError } from "./forms.ts";
import type { PostStatus, Category, Post } from "./types.ts";

/**
 * Event rules that are neither persistence nor iCalendar.
 *
 * `repositories/posts.repo.ts` owns reading and writing rows; `icalendar.ts`
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
): PostStatus => (date > on ? "planned" : "done");

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
 * What was done in a schooling session — the entry form's Nom field on a
 * `travail` event (`#renderActivity` in `post-sheet.ts`).
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
 * - nothing joins — `day-card` and `PostDetailView` keep the shape they had
 *   when this was a closed union.
 *
 * What it gives up is what the closed list used to buy: two spellings of
 * "carrière" are now two activities. `activityChoices` below is what stops that
 * happening by accident.
 */
export type BuiltInActivity =
  | "balade"
  | "baladeApied"
  | "carriere"
  | "longe"
  | "tap"
  | "liberte"
  | "plat"
  | "trotting"
  | "repos";

/**
 * A built-in key, or a label the user typed.
 *
 * `(string & {})` rather than a bare `string`: the union keeps editor completion
 * on the built-ins, which widening to `string` would silently drop.
 */
export type WorkActivity = BuiltInActivity | (string & {});

/** In the order the sheet offers them. */
const WORK_ACTIVITY_LABELS: Record<BuiltInActivity, string> = {
  balade: "Balade",
  baladeApied: "Balade à pied",
  carriere: "Carrière",
  longe: "Longe",
  tap: "TAP",
  liberte: "Liberté",
  plat: "Plat",
  trotting: "Trotting",
  repos: "Repos",
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
 * The built-ins and the given custom labels, alphabetically by their
 * displayed label — so a custom activity takes its place among the built-ins
 * rather than always trailing them, and the list stays scannable as it grows.
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
const compareSessions = (a: Post, b: Post): number => {
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
export type WorkSession = Post & { activity: WorkActivity };

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
  events: Post[],
  types: Category[],
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
      const fieldId = activityFieldIdByType.get(event.categoryKey);
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
 * The days this week that carry a `cours` event — the week strip's cue to
 * show "Cours" instead of a work activity.
 *
 * A `Set`, not a `Map` to something richer, because the strip shows nothing
 * about the lesson beyond the fact of it — no coach, no budget. Cancelled
 * events are skipped, as `workSessionByDate` skips them: a cancelled lesson
 * did not happen.
 */
export const courseDatesThisWeek = (events: Post[]): Set<IsoDate> =>
  new Set(
    events
      .filter(
        (event) =>
          event.categoryKey === "cours" && event.status !== "cancelled",
      )
      .map((event) => event.date),
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
 * The categories whose posts are courses — a start, an optional end and a
 * daily dose (`courseFields` in `categories.ts`). Stated by key here rather
 * than as a flag on the row: the two modules must not import each other, and
 * these are the only two built-ins with those fields.
 */
export const COURSE_CATEGORY_KEYS: readonly string[] = ["cures", "traitement"];

export const isCourse = (post: Post): boolean =>
  COURSE_CATEGORY_KEYS.includes(post.categoryKey);

/**
 * A cure or a traitement is a course: it starts on the post's `date` and runs
 * until `customFields.endDate` — or, with none set, is still running. `null`
 * for a course with no end, or an end that is not a date at all.
 */
export const courseEndDate = (post: Post): IsoDate | null => {
  const end = post.customFields.endDate;
  return isIsoDate(end) ? end : null;
};

/** Still running today: no end date, or one that has not passed yet. */
export const isCourseOngoing = (post: Post, today: IsoDate): boolean => {
  const end = courseEndDate(post);
  return end === null || end >= today;
};

/**
 * The last day a course covers on a calendar: its end date, or today while it
 * has none — a course with no end is drawn up to now, not forever. Never
 * before its own start, so one that has not begun still covers its first day.
 */
export const courseLastDay = (post: Post, today: IsoDate): IsoDate => {
  const last = courseEndDate(post) ?? today;
  return last < post.date ? post.date : last;
};

/** Whether a course covers `day`, by the same bounds its calendar bar uses. */
export const isCourseOnDay = (
  post: Post,
  day: IsoDate,
  today: IsoDate,
): boolean => post.date <= day && day <= courseLastDay(post, today);

/**
 * The "jours actifs" of a course: every day from its start to its end — or to
 * today, while it is still running — both ends counted. `0` for one that has
 * not started yet rather than a negative count.
 */
export const activeDays = (post: Post, today: IsoDate): number => {
  const end = courseEndDate(post);
  const last = end !== null && end < today ? end : today;
  return Math.max(0, daysBetween(post.date, last) + 1);
};

/**
 * `"40 mL"` -> `"40 mL/j"`: the dose a course's `dosage` field stores, read as
 * a daily amount. `null` when there is none to show.
 */
export const formatDosePerDay = (stored: unknown): string | null =>
  typeof stored === "string" && stored.trim() !== "" ? `${stored}/j` : null;

/**
 * A course cannot end before it starts. `{}` when there is no end date, or it
 * falls on or after the start. Keyed by the field's id so the form can put the
 * message under the right control.
 */
export const endDateErrors = (
  start: unknown,
  end: unknown,
): { endDate?: FieldError } =>
  isIsoDate(start) && isIsoDate(end) && end < start
    ? { endDate: "La date de fin précède la date de début." }
    : {};
