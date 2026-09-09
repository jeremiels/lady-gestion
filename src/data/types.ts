import type { IconName } from "../components/app-icon/icons.ts";
import type { DocumentCategory } from "../types/document.types.ts";
import type { ThemeKey } from "../theme/theme.types.ts";
import type { RationSeason } from "./seasons.ts";

/**
 * Fields shared by every persisted entity.
 *
 * These exist from day one so the local-only database can become a
 * multi-user server database without a schema migration:
 *
 * - `id` is a client-generated UUID, so a record has a permanent, globally
 *   unique identity before it ever reaches a server.
 * - `ownerId` is the future tenant key. It holds a locally generated UUID
 *   until Google sign-in provides a real account id.
 * - `updatedAt` is what makes last-write-wins restore/sync possible.
 * - `deletedAt` is a soft delete: a row that is simply gone cannot be
 *   propagated to another device or backup.
 */
export type BaseRecord = {
  id: string;
  ownerId: string;
  /** ISO 8601 UTC timestamp. */
  createdAt: string;
  /** ISO 8601 UTC timestamp. */
  updatedAt: string;
  /** ISO 8601 UTC timestamp, or `null` when the record is live. */
  deletedAt: string | null;
};

/** A record as accepted by a repository's `create` — the base is filled in for you. */
export type NewRecord<T extends BaseRecord> = Omit<T, keyof BaseRecord> &
  Partial<Pick<T, "id">>;

/** The mutable half of a record — everything except identity and bookkeeping. */
export type RecordPatch<T extends BaseRecord> = Partial<
  Omit<T, keyof BaseRecord>
>;

export type HorseSex = "jument" | "hongre" | "etalon";

export type Horse = BaseRecord & {
  name: string;
  sex: HorseSex;
  /**
   * Calendar date, `YYYY-MM-DD`. Age is always derived from this — never
   * store an age, it is wrong within a year.
   */
  birthDate: string | null;
  /** e.g. "Selle Français". */
  breed: string | null;
  /** Robe, e.g. "Bai cerise". */
  coat: string | null;
  /** Numéro SIRE, e.g. "2139236F". */
  sireNumber: string | null;
  /** Père. */
  sireName: string | null;
  /** Mère. */
  damName: string | null;
  /** `Document.id` of the cover photo, or `null` to use the bundled fallback. */
  photoDocumentId: string | null;
  /** Sold, retired or otherwise no longer tracked. Distinct from deleted. */
  archivedAt: string | null;
};

export type EventStatus = "planned" | "done" | "cancelled";

/**
 * The core record: one dated thing that happened (or will happen) to a horse.
 *
 * Deliberately unified rather than split into events and budget. A farrier
 * visit is a single row that has both a date and a price — "rendez-vous à
 * venir" is a future `date`, "dépenses" is `amountCents != null`. Splitting
 * would mean entering the same visit twice and joining it back together in
 * every summary.
 *
 * Named `HorseEvent` rather than `Event` on purpose: `Event` is a DOM global,
 * and shadowing it inside view files that also handle `SubmitEvent` is a trap.
 */
export type HorseEvent = BaseRecord & {
  horseId: string;
  /** Slug into `EventTypeDef.key` below — see `event-types.ts`. */
  type: string;
  /** Short user-facing label, e.g. "Ferrure". */
  title: string;
  /** Calendar date, `YYYY-MM-DD`. Local, timezone-free, sorts lexicographically. */
  date: string;
  /** `HH:mm`, or `null` for an all-day entry. */
  time: string | null;
  status: EventStatus;
  /** ISO 4217 code. Only meaningful for a type whose `fields` carry an amount. */
  currency: string;
  location: string | null;
  notes: string | null;
  /** Groups instances generated from one recurring charge, e.g. monthly pension. */
  recurrenceId: string | null;
  /**
   * Everything the event's *type* decides it needs: a practitioner or a
   * merchant, a follow-up interval, what was done in a schooling session, a
   * budget. Keyed by `CustomFieldDef.id` (`event-types.ts`).
   *
   * Replaces what used to be fixed columns — `providerName`, `vendor`,
   * `followUpInterval`, `activity`, `amountCents` — added in schema v6 when
   * event types stopped being a closed, compile-time union (see
   * `EventTypeDef` below). Which of these a given event carries is now a
   * property of its type's `fields`, not of the record's own shape, so a field
   * one type needs no longer widens every event of every other type.
   *
   * Scalar values only: a structured one (the follow-up interval) is encoded
   * the same way the entry form already hands it over to the record
   * (`followUpValue`/`parseFollowUpValue` in `events.ts`), so the bag never
   * holds anything a plain object literal couldn't survive a JSON round trip
   * as — which is what lets it travel through a backup file unchanged.
   */
  customFields: Record<string, string | number | boolean | null>;
};

/**
 * The shapes a custom field can take.
 *
 * `text`, `cents` and `bool` are general-purpose. `followUp`, `workActivity`
 * and `quantity` are not: `followUp` pairs a checkbox with the interval
 * `FOLLOW_UP_INTERVALS` offers (`events.ts`), `workActivity` is the `travail`
 * layout's Nom combobox, backed by the activities catalogue (`ActivityItem`
 * below) rather than free text, and `quantity` pairs a decimal amount with one
 * of `QUANTITY_UNITS` (`events.ts`), stored as the two concatenated
 * (`formatQuantity`) — a scalar, like every other custom field's value has to
 * be. All three exist because a built-in type already needs them, not because
 * a generic field could reproduce what they do.
 */
export type CustomFieldKind =
  | "text"
  | "cents"
  | "bool"
  | "followUp"
  | "workActivity"
  | "quantity";

/** One field a type's entry form draws, beyond the fixed base fields above. */
export type CustomFieldDef = {
  /** Stable key into `HorseEvent.customFields`. Immutable once created. */
  id: string;
  kind: CustomFieldKind;
  label: string;
  required: boolean;
};

/**
 * What an event type is: its presentation, and the fields its entry form shows.
 *
 * Was a closed TypeScript union (`EventTypeKey`, `types/event.types.ts`) with a
 * compile-time label/icon/theme table and a four-layout form-spec table beside
 * it — the one taxonomy in this app users could not extend without a release.
 * This is what it became in schema v6: a row, so a type can be added,
 * relabelled, or given a different field list, from data.
 *
 * The nine types the app shipped with, plus four more finished in the same
 * migration, are seeded with `isBuiltIn: true` — informative only, it does not
 * block editing. `ActivityItem` below is code for its six built-ins for the
 * opposite reason: that is a closed vocabulary nothing there ever edits: this
 * one is the opposite from day one.
 */
export type EventTypeDef = BaseRecord & {
  /** Stable slug — what `HorseEvent.type` stores. Immutable once created. */
  key: string;
  label: string;
  icon: IconName;
  theme: ThemeKey;
  /** True for the seeded rows. Informative only — it does not block editing. */
  isBuiltIn: boolean;
  /** Drives the dashboard's "Rendez-vous à venir" list — see `event-types.ts`. */
  isAppointment: boolean;
  /** Drives the week strip's day-activity tracking — see `event-types.ts`. */
  tracksWork: boolean;
  /** Soft-hide from pickers; still resolves for historical events. */
  archived: boolean;
  /** Explicit, stable order — drives the budget donut/legend order. */
  order: number;
  fields: CustomFieldDef[];
};

/**
 * A work activity the user added themselves — the chips the week strip's day
 * sheet offers beyond the six built into `events.ts`.
 *
 * A catalogue, not a parent table. Nothing holds a foreign key to it: a
 * `travail` event stores this row's `label`, so deleting the row retires a chip
 * and leaves every session that used it saying exactly what it always said.
 * That is what lets the list be edited freely without a cascade.
 *
 * The app's first user-editable taxonomy — `EventTypeDef` above is the second,
 * added a schema version later. Every other closed list here — document
 * categories, ration units — is a TypeScript union with a hardcoded label
 * table, because the wording is a design decision. What the horse worked on
 * is not. Added in schema v5.
 */
export type ActivityItem = BaseRecord & {
  horseId: string;
  /**
   * As typed, trimmed — and exactly what a `travail` row stores in `activity`.
   *
   * There is no separate key because there is nothing for one to be stable
   * against: the user picked this wording and the user can retire it.
   */
  label: string;
};

export type StoredDocument = BaseRecord & {
  horseId: string;
  /** The event this document supports (an invoice for a vet visit), if any. */
  eventId: string | null;
  category: DocumentCategory;
  /** File name as shown to the user. */
  name: string;
  mimeType: string;
  /** Size in bytes. */
  size: number;
  /** The date printed on the document itself, `YYYY-MM-DD`. */
  issuedAt: string | null;
  /** Google Drive file id once uploaded. */
  driveFileId: string | null;
  /** ISO timestamp of the last successful upload; compare against `updatedAt`. */
  driveSyncedAt: string | null;
};

/**
 * File bytes, kept in their own table and keyed by document id.
 *
 * IndexedDB deserializes whole records, so listing documents must not drag
 * every PDF into memory alongside its metadata.
 */
export type DocumentBlob = {
  documentId: string;
  blob: Blob;
};

export type RationUnit = "kg" | "g" | "L" | "mL" | "dose" | "mesure";

/**
 * One line of the daily feed plan.
 *
 * A row per line rather than fixed columns for the current feeds — the list
 * changes with the season and the horse, and this maps onto a child table.
 */
export type RationItem = BaseRecord & {
  horseId: string;
  /** e.g. "Fib & fib", "CMV Minéral Oligovit". */
  label: string;
  quantity: number;
  unit: RationUnit;
  /**
   * The annual window this line is fed in, or `null` when it is fed all year.
   *
   * Replaced a `seasonal: boolean` in schema v2. A flag could say *that* a feed
   * was seasonal but not *when*, so the plan could never work out which lines
   * are suspended today — which is the whole point of showing seasonality.
   * See `seasons.ts`; both ends are inclusive and the window may wrap the year.
   */
  season: RationSeason | null;
  sortOrder: number;
};

/** Local app state. Not an entity: never exported, never synced. */
export type MetaEntry = {
  key: MetaKey;
  value: unknown;
};

export type MetaKey =
  | "ownerId"
  | "activeHorseId"
  | "lastBackupAt"
  | "driveFolderId"
  | "googleAccount"
  | "notificationsEnabled"
  | "seededAt"
  | "seedRecordIds";
