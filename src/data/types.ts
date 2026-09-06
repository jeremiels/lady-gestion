import type { EventTypeKey } from "../types/event.types.ts";
import type { DocumentCategory } from "../types/document.types.ts";
import type { RationSeason } from "./seasons.ts";
import type { FollowUpInterval, WorkActivity } from "./events.ts";

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
  type: EventTypeKey;
  /** Short user-facing label, e.g. "Ferrure". */
  title: string;
  /** Calendar date, `YYYY-MM-DD`. Local, timezone-free, sorts lexicographically. */
  date: string;
  /** `HH:mm`, or `null` for an all-day entry. */
  time: string | null;
  status: EventStatus;
  /** Integer cents — never a float. `null` means the entry costs nothing. */
  amountCents: number | null;
  /** ISO 4217 code. */
  currency: string;
  /** Vet, farrier, instructor… — the "Practicien" field on a care event. */
  providerName: string | null;
  /**
   * Where a purchase was made — a shop name or a website. The "Site" field on a
   * purchase event.
   *
   * Its own column rather than reusing `providerName` or `location`: a merchant
   * is neither a practitioner nor a place, and folding it into either would make
   * "who provided this" mean two different things depending on the event type.
   * Added in schema v3.
   */
  vendor: string | null;
  location: string | null;
  notes: string | null;
  /** Groups instances generated from one recurring charge, e.g. monthly pension. */
  recurrenceId: string | null;
  /**
   * How long until this should be repeated — a six-week farrier cycle. Set when
   * "Planifier un rendez-vous" is ticked on a care event.
   *
   * Recording the interval does **not** create a second event; nothing derives a
   * date from this yet. See `events.ts`. Added in schema v3.
   */
  followUpInterval: FollowUpInterval | null;
  /**
   * What was done in a schooling session — the entry form's Nom field on a
   * `travail` event.
   *
   * Its own column rather than folded into `title` or `notes`: it is the field
   * that says what the session *was*, which is what lets it be filtered and
   * counted later, and a free-text `title` that happens to read "Longe" is
   * neither. `null` on every other event type — the entry form writes it from
   * the layout, never from whatever the DOM still holds. Added in schema v4.
   *
   * One of six built-in keys, or a label the user added, stored **verbatim**
   * rather than as an id into `ActivityItem` below. `WorkActivity` in
   * `events.ts` has the whole reasoning; the short of it is that a session must
   * stay readable after its chip has been retired from the catalogue.
   */
  activity: WorkActivity | null;
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
 * The app's first user-editable taxonomy. Every other closed list here — event
 * types, document categories, ration units — is a TypeScript union with a
 * hardcoded label table, because the wording is a design decision. What the
 * horse worked on is not. Added in schema v5.
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
