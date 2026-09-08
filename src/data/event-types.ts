import type { IsoTimestamp } from "./dates.ts";
import type { CustomFieldDef, CustomFieldKind, EventTypeDef } from "./types.ts";

/**
 * Pure functions over the event-type catalogue, and its built-in seed data.
 *
 * Mirrors `events.ts`: that file holds pure functions over `HorseEvent`, this
 * one holds pure functions over `EventTypeDef` — the row `HorseEvent.type`
 * points at (`types.ts`). Deliberately does not import `events.ts` and is not
 * imported by it, even though both are needed together by the day-sheet write
 * path and the week strip: `events.ts` already owns the `FollowUpInterval`
 * encoding schema v6's migration needs, and either direction of import between
 * the two would be circular the moment the other reaches back.
 */

const counterpartyField = (label: string): CustomFieldDef => ({
  id: "counterparty",
  kind: "text",
  label,
  required: false,
});

const amountField = (): CustomFieldDef => ({
  id: "amountCents",
  kind: "cents",
  label: "Budget",
  required: false,
});

const followUpField = (): CustomFieldDef => ({
  id: "followUp",
  kind: "followUp",
  label: "Planifier un rendez-vous",
  required: false,
});

const activityField = (): CustomFieldDef => ({
  id: "activity",
  kind: "workActivity",
  label: "Nom",
  required: true,
});

/** A care appointment's fields: practitioner, follow-up, budget. */
const careFields = (): CustomFieldDef[] => [
  counterpartyField("Practicien"),
  followUpField(),
  amountField(),
];

/**
 * The type catalogue's seed data: the nine built-in types the app shipped
 * with, plus four more — `concours`, `soins`, `cures`, `traitement` — finished
 * in the same migration that introduced this table (schema v6).
 *
 * Those four already had a label, an icon and a theme in the old, compile-time
 * `EVENT_TYPE_META` table, uncommitted — but were never wired into a form
 * layout, and their theme (`blue`/`red`/`indigo`/`violet`) and icon
 * (`trophy`/`bandage`/`syringe`/`pills`) don't exist as real `ThemeKey`/
 * `IconName` values: no CSS token and no sprite entry was ever added for them.
 * Selecting one today renders a form with no fields at all beyond the fixed
 * base ones. Below, each is given a real icon and theme reused from an
 * existing type — a placeholder, changeable as a data edit rather than a
 * migration once real assets exist — and a field list drawn from whichever of
 * the four built-in layouts its meaning is closest to. `coucours`, that
 * table's misspelled key, is corrected to `concours` here and by the same
 * migration step that seeds this list (`migrateEventToCustomFields` in
 * `events.ts`).
 *
 * Read by both halves of the schema v6 migration — `db.ts`'s live upgrade and
 * `backup/snapshot.ts`'s `migrateSnapshot` — via `seedEventTypeDefs` below, so
 * a database upgraded in place and a backup file restored from an older build
 * seed identically. One array, the same rule `db.ts`'s `RECORD_TABLES` gives
 * for existing.
 */
export const BUILT_IN_EVENT_TYPES: Omit<
  EventTypeDef,
  "id" | "ownerId" | "createdAt" | "updatedAt" | "deletedAt"
>[] = [
  {
    key: "achat",
    label: "Achats",
    icon: "shoppingCart",
    theme: "taupe",
    isBuiltIn: true,
    isAppointment: false,
    tracksWork: false,
    archived: false,
    order: 0,
    fields: [counterpartyField("Site"), amountField()],
  },
  {
    key: "alimentation",
    label: "Alimentation",
    icon: "carrot",
    theme: "yellow",
    isBuiltIn: true,
    isAppointment: false,
    tracksWork: false,
    archived: false,
    order: 1,
    fields: [counterpartyField("Site"), amountField()],
  },
  {
    key: "travail",
    label: "Travail",
    icon: "cowboyHat",
    theme: "fuchsia",
    isBuiltIn: true,
    isAppointment: false,
    tracksWork: true,
    archived: false,
    order: 2,
    fields: [activityField()],
  },
  {
    key: "cours",
    label: "Cours",
    icon: "cactus",
    theme: "brown",
    isBuiltIn: true,
    isAppointment: false,
    tracksWork: false,
    archived: false,
    order: 3,
    fields: [amountField()],
  },
  {
    key: "dentiste",
    label: "Dentiste",
    icon: "tooth",
    theme: "purple",
    isBuiltIn: true,
    isAppointment: true,
    tracksWork: false,
    archived: false,
    order: 4,
    fields: careFields(),
  },
  {
    key: "marechal",
    label: "Maréchal",
    icon: "footprints",
    theme: "green",
    isBuiltIn: true,
    isAppointment: true,
    tracksWork: false,
    archived: false,
    order: 5,
    fields: careFields(),
  },
  {
    key: "veto",
    label: "Vétérinaire",
    icon: "firstAidKit",
    theme: "pink",
    isBuiltIn: true,
    isAppointment: true,
    tracksWork: false,
    archived: false,
    order: 6,
    fields: careFields(),
  },
  {
    key: "osteo",
    label: "Ostéopathe",
    icon: "pawPrint",
    theme: "orange",
    isBuiltIn: true,
    isAppointment: true,
    tracksWork: false,
    archived: false,
    order: 7,
    fields: careFields(),
  },
  {
    key: "pension",
    label: "Pension",
    icon: "farm",
    theme: "turquoise",
    isBuiltIn: true,
    isAppointment: false,
    tracksWork: false,
    archived: false,
    order: 8,
    fields: [amountField()],
  },
  {
    key: "concours",
    label: "Concours",
    // Placeholder — see the module doc comment. A real "trophy" icon doesn't
    // exist yet; a competition's venue is the fixed `location` field, so no
    // counterparty field is needed here the way the care types have one.
    icon: "dateFilled",
    theme: "turquoise",
    isBuiltIn: true,
    isAppointment: false,
    tracksWork: false,
    archived: false,
    order: 9,
    fields: [amountField()],
  },
  {
    key: "soins",
    label: "Soins",
    icon: "firstAidKit",
    theme: "pink",
    isBuiltIn: true,
    isAppointment: true,
    tracksWork: false,
    archived: false,
    order: 10,
    fields: careFields(),
  },
  {
    key: "cures",
    label: "Cures",
    icon: "pawPrint",
    theme: "purple",
    isBuiltIn: true,
    isAppointment: true,
    tracksWork: false,
    archived: false,
    order: 11,
    // No follow-up: a cure is a defined course, not a recurring visit.
    fields: [counterpartyField("Practicien"), amountField()],
  },
  {
    key: "traitement",
    label: "Traitement",
    icon: "info",
    theme: "orange",
    isBuiltIn: true,
    isAppointment: true,
    tracksWork: false,
    archived: false,
    order: 12,
    fields: careFields(),
  },
];

/**
 * Stamps `BUILT_IN_EVENT_TYPES` into real rows.
 *
 * Called from both halves of the schema v6 migration with whichever owner id
 * and timestamp that caller has to hand — `db.ts`'s live upgrade resolves the
 * owner id itself, before `owner.ts`'s usual cache exists; `migrateSnapshot`
 * already has one on the snapshot's own envelope. Also called by
 * `seedIfEmpty` (`seed.ts`) for a brand-new install, which never runs
 * `db.ts`'s `.upgrade()` at all — Dexie only fires one when a database
 * already exists at an older version.
 *
 * `id` is the type's own `key`, not a fresh `newId()`: every one of those
 * three call sites can run against the *same* built-in catalogue — a fresh
 * install seeds it once, then restoring an old backup seeds it again via
 * `migrateSnapshot` (the file itself predates the `eventTypes` table, so it
 * carries none of its own) — and `importBackup`'s merge is per-`id`. A
 * random id each time would make every one of those calls produce a
 * *different* 13 rows for the same 13 types, so restoring a backup onto an
 * already-seeded device would double them rather than merge them, the same
 * way `import a snapshot twice` must not double every other table either.
 * Deriving `id` from `key` is what makes two independent seed calls agree on
 * what the row *is* without either one having to ask the other first.
 */
export const seedEventTypeDefs = (
  ownerId: string,
  timestamp: IsoTimestamp,
): EventTypeDef[] =>
  BUILT_IN_EVENT_TYPES.map((def) => ({
    ...def,
    id: def.key,
    ownerId,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }));

/** The type whose `key` matches, or `undefined` if the caller's list has none. */
export const findEventType = (
  types: EventTypeDef[],
  key: string,
): EventTypeDef | undefined => types.find((type) => type.key === key);

/** Alphabetical by label — the order a filter list or a type picker offers them in. */
export const byLabel = (types: EventTypeDef[]): EventTypeDef[] =>
  [...types].sort((a, b) => a.label.localeCompare(b.label, "fr"));

/**
 * By `order` — the stable sequence that keeps a category, and therefore its
 * colour and its neighbours, in the same place in the budget donut from one
 * month to the next. Replaces the fixed `EVENT_TYPES` array `sumByType` used
 * to iterate before types became data.
 */
export const byOrder = (types: EventTypeDef[]): EventTypeDef[] =>
  [...types].sort((a, b) => a.order - b.order);

/** The one field of a given kind on a type, if it has one — a type has at most one. */
export const fieldOfKind = (
  type: EventTypeDef,
  kind: CustomFieldKind,
): CustomFieldDef | undefined =>
  type.fields.find((field) => field.kind === kind);

/**
 * The types the dashboard's "Rendez-vous à venir" list is about.
 *
 * Replaces the hardcoded `APPOINTMENT_TYPES` Set `events.ts` used to keep: a
 * rendez-vous is booked with someone, and which types that is is now a
 * property of the type itself (`isAppointment`) rather than a closed list in
 * code — `event-types.repo.ts`'s seed sets it exactly the way the old Set did.
 */
export const isAppointmentType = (
  types: EventTypeDef[],
  key: string,
): boolean => findEventType(types, key)?.isAppointment ?? false;
