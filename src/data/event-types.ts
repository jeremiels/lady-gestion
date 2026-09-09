import { isIconName, type IconName } from "../components/app-icon/icons.ts";
import { isThemeKey } from "../theme/theme.ts";
import type { ThemeKey } from "../theme/theme.types.ts";
import type { IsoTimestamp } from "./dates.ts";
import type {
  CustomFieldDef,
  CustomFieldKind,
  EventTypeDef,
  HorseEvent,
} from "./types.ts";

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

/**
 * Exported: `db.ts`'s schema v7 migration and `migrateSnapshot`
 * (`backup/snapshot.ts`) both append this to an existing `alimentation` row
 * rather than reseeding it, so the definition has to be reachable from
 * outside this module too.
 */
export const quantityField = (): CustomFieldDef => ({
  id: "quantity",
  kind: "quantity",
  label: "Quantité du produit",
  required: false,
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
 * Two of those four stopped being roots in schema v9: `cures` files under
 * `alimentation` and `traitement` under `veto`, so both inherit their parent's
 * presentation and their spend rolls into its wedge. That is a product
 * decision rather than a migration detail — it repaints two types and redraws
 * the budget ring for anyone already using them — which is why it needed a
 * migration of its own rather than an edit to this array alone: the rows exist
 * on installed devices already, and changing the seed reaches only a fresh
 * install.
 *
 * Schema v10 does the same to one of the original nine: `osteo`, a root since
 * v1, files under `soins` too, alongside a brand-new sibling, `massage`, that
 * never shipped as a root at all — inserted fresh rather than moved. Ten of
 * the fourteen rows are roots today.
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
    parentId: null,
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
    parentId: null,
    icon: "carrot",
    theme: "yellow",
    isBuiltIn: true,
    isAppointment: false,
    tracksWork: false,
    archived: false,
    order: 1,
    fields: [counterpartyField("Site"), amountField(), quantityField()],
  },
  {
    key: "travail",
    label: "Travail",
    parentId: null,
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
    parentId: null,
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
    parentId: null,
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
    parentId: null,
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
    parentId: null,
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
    // A child of `soins` since schema v10, alongside `massage` below — both
    // are care appointments a client books through the same "Soins" entry
    // point. `parentId` holds the parent's `id`, not its `key` — see the note
    // on `cures` further down for why a literal slug is valid here.
    parentId: "soins",
    // Kept as an override rather than nulled: unlike `cures`/`traitement`'s
    // placeholder icons at v9, `pawPrint` was already this row's real,
    // shipped icon, and it is what tells it apart from its new sibling
    // `massage` inside the "Soins" group.
    icon: "pawPrint",
    theme: null,
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
    parentId: null,
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
    parentId: null,
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
    parentId: null,
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
    // A child of `alimentation`: a cure is a course of supplements, which is
    // what the group reads as. `parentId` holds the parent's `id`, not its
    // `key` — the two happen to be equal for a built-in because
    // `seedEventTypeDefs` below stamps `id: def.key` on purpose, and that is
    // the only reason a literal slug is writable here.
    parentId: "alimentation",
    // Both null: inherited from the parent. `theme` always is — a group reads
    // as one colour in the budget ring, and that is the invariant the whole
    // feature rests on. `icon` is inherited here because `pawPrint` was only
    // ever a placeholder (it is also Ostéopathe's); writing a real `IconName`
    // back on this row takes it over again, no migration needed.
    icon: null,
    theme: null,
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
    // A child of `veto`, the same way `cures` is one of `alimentation` — see
    // the note there for why a literal slug is a valid `id` in this table.
    parentId: "veto",
    // `info` was this row's placeholder icon, and it is also what
    // `resolveCatalogue` falls back to for a row carrying nothing usable —
    // inheriting Vétérinaire's `firstAidKit` says more than either.
    icon: null,
    theme: null,
    isBuiltIn: true,
    isAppointment: true,
    tracksWork: false,
    archived: false,
    order: 12,
    fields: careFields(),
  },
  {
    key: "massage",
    label: "Massage",
    // A new child of `soins`, introduced alongside `osteo`'s reparenting —
    // schema v10. Unlike `cures`/`traitement`, this type never shipped as a
    // root: it is inserted fresh by v10's migration rather than moved.
    parentId: "soins",
    // Both null: inherited from `soins`, the same as `cures`/`traitement` —
    // there is no dedicated icon for this type, and `pawPrint` is already
    // spoken for by its sibling `osteo`.
    icon: null,
    theme: null,
    isBuiltIn: true,
    isAppointment: true,
    tracksWork: false,
    archived: false,
    order: 13,
    fields: careFields(),
  },
];

/**
 * The nestings schema v9 introduces, by `key`: child first, then parent.
 *
 * Exported because both halves of that migration need it — `db.ts`'s live
 * upgrade and `migrateSnapshot` (`backup/snapshot.ts`) — for the same reason
 * `quantityField` above is: two copies of a migration's payload are two things
 * that can drift, and a live upgrade disagreeing with a restore is a
 * divergence nothing later detects.
 *
 * **Frozen.** It describes what v9 did, not what the catalogue's hierarchy is.
 * Nesting another built-in later means a new version with its own table, not a
 * line here: adding one would silently change what v9 does to every device
 * still upgrading through it, which is the one thing a shipped migration must
 * never do.
 *
 * By `key` rather than `id`, even though `parentId` stores an `id`: `key` is
 * the identity every other lookup in this app resolves a type by, and it is
 * the only half of a row a restored file is guaranteed to agree with us on.
 * The migrations resolve the parent's real `id` from the table they are
 * looking at.
 */
export const SCHEMA_V9_NESTINGS: readonly { key: string; parentKey: string }[] =
  [
    { key: "cures", parentKey: "alimentation" },
    { key: "traitement", parentKey: "veto" },
  ];

/**
 * The one nesting schema v10 introduces: `osteo`, a root since v1, files
 * under `soins`. Same shape and same reason as `SCHEMA_V9_NESTINGS` above —
 * shared between `db.ts`'s live upgrade and `migrateSnapshot`, frozen, and
 * addressed by `key`.
 *
 * v10 does **not** null `osteo`'s `icon` the way v9 nulled `cures`' and
 * `traitement`'s: those were unused placeholders, but `pawPrint` is `osteo`'s
 * real, already-shipped icon, and keeping it as an override is what tells it
 * apart from its new sibling `massage` inside the "Soins" group. `theme` is
 * still cleared — that half of the invariant (a group is one colour) is not
 * optional.
 */
export const SCHEMA_V10_NESTINGS: readonly {
  key: string;
  parentKey: string;
}[] = [{ key: "osteo", parentKey: "soins" }];

/**
 * The one brand-new type schema v10 introduces: `massage`, seeded directly as
 * a child of `soins` — never a root, so there is no existing row to move the
 * way `SCHEMA_V10_NESTINGS` moves `osteo`.
 *
 * Unlike an edit to an already-shipped row, inserting a row that never
 * existed before is safe to source straight from `BUILT_IN_EVENT_TYPES` (via
 * `seedEventTypeDefs`) rather than a frozen duplicate: nothing about editing
 * `massage`'s definition *after* it ships can retroactively change what this
 * key list did, because any such edit needs its own version and its own
 * migration step, addressed by `key`, the same way v7 edited `alimentation`.
 * This constant exists only so `db.ts` and `migrateSnapshot` agree on
 * *which* keys v10 is responsible for inserting.
 */
export const SCHEMA_V10_NEW_TYPES: readonly string[] = ["massage"];

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
 * *different* 14 rows for the same 14 types, so restoring a backup onto an
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

/**
 * A type whose presentation is settled: no `null` left to think about.
 *
 * What every view consumes — `event-types.repo.ts`'s `listResolved` produces
 * it, and it stays assignable to `EventTypeDef`, so the accessors below take
 * either. The raw row is still what the type editor wants: only it needs to
 * see the `null` that means "inherited" in order to say so.
 */
export type ResolvedEventType = Omit<EventTypeDef, "icon" | "theme"> & {
  icon: IconName;
  theme: ThemeKey;
};

/**
 * What a root falls back to when it carries no usable presentation of its own.
 *
 * Not reachable from the app's own write paths — the editor requires both on a
 * root — but very reachable from a restored backup, which `assertSnapshot`
 * checks for `id` and `updatedAt` and nothing else. `"info"` is already what
 * `event-card` fell back to in that case before this file did; `"taupe"` is the
 * catalogue's most neutral tone.
 */
const DEFAULT_ICON: IconName = "info";
const DEFAULT_THEME: ThemeKey = "taupe";

/** The stored value if it is one this build can actually draw, else nothing. */
const ownIcon = (type: EventTypeDef): IconName | undefined =>
  type.icon !== null && isIconName(type.icon) ? type.icon : undefined;

const ownTheme = (type: EventTypeDef): ThemeKey | undefined =>
  type.theme !== null && isThemeKey(type.theme) ? type.theme : undefined;

/**
 * This type's parent, or `undefined` when it is a root.
 *
 * A `parentId` that resolves to nothing in the caller's own list counts as a
 * root, not as an error: the parent may have been soft-deleted on another
 * device, or a partial backup merge may have brought the child over without it.
 * Rendering the child as a root is the one outcome that keeps it visible and
 * editable — dropping it, or throwing, loses it. `rootsOf` applies the same
 * rule from the other side, so the two can never disagree about what a root is.
 */
const parentOf = <T extends EventTypeDef>(
  types: T[],
  type: T,
): T | undefined =>
  type.parentId === null
    ? undefined
    : types.find((candidate) => candidate.id === type.parentId);

/**
 * Fills in every row's `icon`/`theme` from its parent, in one pass.
 *
 * A single hop, because the depth cap says a parent is a root
 * (`canBeParentOf`). A deeper chain is only reachable from data this build did
 * not write, and resolves against its immediate parent's *own* values, falling
 * back to the defaults above rather than walking — bounded by construction, so
 * no cycle in imported data can hang a render.
 *
 * This is also the app's only guard on those two columns. `THEME_META[key]` is
 * a mapped type, so an unknown theme string from a backup file is a `TypeError`
 * at render rather than a missing colour; `ownTheme`/`ownIcon` above turn it
 * into the default here instead, once, for every read site at the same time.
 */
export const resolveCatalogue = (
  types: EventTypeDef[],
): ResolvedEventType[] => {
  const byId = new Map(types.map((type) => [type.id, type]));

  return types.map((type) => {
    const parent = type.parentId === null ? undefined : byId.get(type.parentId);

    return {
      ...type,
      // A dangling parent is normalised away here, so a resolved catalogue can
      // be filtered on `parentId === null` directly.
      parentId: parent ? type.parentId : null,
      icon: ownIcon(type) ?? (parent && ownIcon(parent)) ?? DEFAULT_ICON,
      theme: ownTheme(type) ?? (parent && ownTheme(parent)) ?? DEFAULT_THEME,
    };
  });
};

/** The types with no parent, in `order` — the top level of the picker, the
 * chips and the budget ring. The whole shipped catalogue is one of these. */
export const rootsOf = <T extends EventTypeDef>(types: T[]): T[] => {
  const ids = new Set(types.map((type) => type.id));
  return byOrder(
    types.filter((type) => type.parentId === null || !ids.has(type.parentId)),
  );
};

/** The direct children of `parentId`, in `order`. Empty for a leaf. */
export const childrenOf = <T extends EventTypeDef>(
  types: T[],
  parentId: string,
): T[] => byOrder(types.filter((type) => type.parentId === parentId));

/** The root this type hangs under — itself when it is one. */
export const rootOf = <T extends EventTypeDef>(types: T[], type: T): T =>
  parentOf(types, type) ?? type;

/**
 * The `HorseEvent.type` slugs a filter on `key` should match: the type's own,
 * plus its children's.
 *
 * Keys rather than ids because this is compared against `HorseEvent.type`,
 * which stores the slug. A flat catalogue makes this a singleton, which is
 * exactly today's `event.type === filter`.
 */
export const subtreeKeys = (
  types: EventTypeDef[],
  key: string,
): Set<string> => {
  const type = findEventType(types, key);
  if (!type) return new Set([key]);
  return new Set([
    key,
    ...childrenOf(types, type.id).map((child) => child.key),
  ]);
};

/**
 * The depth-2 invariant, as one predicate — the only thing standing between
 * this table and a cycle.
 *
 * Four rules, and together they make a cycle unrepresentable without any
 * recursive check: a type cannot be its own parent, both rows must exist, the
 * proposed parent must itself be a root, and a type that already has children
 * cannot be given one. The last two are the same rule seen from each end, and
 * dropping either would let a three-deep chain in.
 */
export const canBeParentOf = (
  types: EventTypeDef[],
  childId: string,
  parentId: string,
): boolean => {
  if (childId === parentId) return false;

  const child = types.find((type) => type.id === childId);
  const parent = types.find((type) => type.id === parentId);
  if (!child || !parent) return false;

  if (parentOf(types, parent) !== undefined) return false;
  return childrenOf(types, childId).length === 0;
};

/**
 * The type whose `key` matches, or `undefined` if the caller's list has none.
 *
 * Generic over the row rather than fixed to `EventTypeDef` — the views hand it
 * a `ResolvedEventType[]` and would otherwise get a raw `EventTypeDef` back,
 * losing exactly the non-null `icon`/`theme` they resolved the catalogue for.
 * Same reason for `byLabel` and `byOrder` below.
 */
export const findEventType = <T extends EventTypeDef>(
  types: T[],
  key: string,
): T | undefined => types.find((type) => type.key === key);

/** Alphabetical by label — the order a filter list or a type picker offers them in. */
export const byLabel = <T extends EventTypeDef>(types: T[]): T[] =>
  [...types].sort((a, b) => a.label.localeCompare(b.label, "fr"));

/**
 * By `order` — the stable sequence that keeps a category, and therefore its
 * colour and its neighbours, in the same place in the budget donut from one
 * month to the next. Replaces the fixed `EVENT_TYPES` array `sumByType` used
 * to iterate before types became data.
 */
export const byOrder = <T extends EventTypeDef>(types: T[]): T[] =>
  [...types].sort((a, b) => a.order - b.order);

/**
 * The one field of a given *kind* on a type, if it has one.
 *
 * Only safe for `followUp` and `workActivity`: those two are not
 * general-purpose (see `CustomFieldKind`'s doc comment) — a type gets one or
 * none, by construction, and nothing a field-builder UI adds can create a
 * second. `text`/`cents`/`bool` **are** general-purpose, so a type could one
 * day carry more than one of a kind; for the fixed slots built from those
 * kinds (counterparty, budget), use `fieldById` below instead — looking those
 * up by kind would silently resolve to whichever field happens to be first.
 */
export const fieldOfKind = (
  type: EventTypeDef,
  kind: CustomFieldKind,
): CustomFieldDef | undefined =>
  type.fields.find((field) => field.kind === kind);

/**
 * The field with this stable `id`, if the type has one.
 *
 * The right lookup for a fixed slot built from a general-purpose kind —
 * `"counterparty"`, `"amountCents"` — where `fieldOfKind` would risk matching
 * a *different* field of the same kind once a type can carry more than one.
 */
export const fieldById = (
  type: EventTypeDef,
  id: string,
): CustomFieldDef | undefined => type.fields.find((field) => field.id === id);

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

/**
 * Narrows a list of events to the ones that are actually *appointments* — see
 * `isAppointmentType` — capped to `limit`.
 *
 * Pure, over events and types the caller already fetched: `HomeView` holds
 * both in their own `LiveQuery`, and joining them here rather than inside
 * `eventsRepo.listUpcoming`'s own query is what keeps the dashboard reactive
 * to a type's `isAppointment` flag changing — a Dexie `liveQuery` only re-runs
 * for tables its own query function reads, and `eventTypes` is not one of
 * them for a query that receives the catalogue as a plain argument instead.
 */
export const upcomingAppointments = (
  events: HorseEvent[],
  types: EventTypeDef[],
  limit?: number,
): HorseEvent[] => {
  const appointments = events.filter((event) =>
    isAppointmentType(types, event.type),
  );
  return limit === undefined ? appointments : appointments.slice(0, limit);
};
