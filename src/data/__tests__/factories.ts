import { BUILT_IN_EVENT_TYPES } from "../event-types.ts";
import { db, RECORD_TABLES } from "../db.ts";
import { setOwnerId } from "../owner.ts";
import { markDataReady } from "../ready.ts";
import type {
  EventTypeDef,
  Horse,
  HorseEvent,
  RationItem,
  StoredDocument,
} from "../types.ts";

/**
 * Shared fixtures for the repository tests.
 *
 * Records are built whole rather than through the repositories so a test can
 * put a row into a state the repository would never produce — an old
 * `updatedAt`, a tombstone, a horse that is archived but not deleted — which is
 * exactly what the read paths need to be exercised against.
 *
 * Not named `*.test.ts`, so Vitest treats it as a module rather than a suite.
 */

export const OWNER = "owner-test";
export const HORSE_ID = "horse-1";

const STAMP = "2026-01-01T00:00:00.000Z";

const base = (id: string) => ({
  id,
  ownerId: OWNER,
  createdAt: STAMP,
  updatedAt: STAMP,
  deletedAt: null,
});

export const makeHorse = (over: Partial<Horse> = {}): Horse => ({
  ...base(HORSE_ID),
  name: "Ladympala",
  sex: "jument",
  birthDate: "2021-05-01",
  breed: null,
  coat: null,
  sireNumber: null,
  sireName: null,
  damName: null,
  photoDocumentId: null,
  archivedAt: null,
  ...over,
});

export const makeEvent = (over: Partial<HorseEvent> = {}): HorseEvent => ({
  ...base("event-1"),
  horseId: HORSE_ID,
  type: "veto",
  title: "Visite",
  date: "2026-06-15",
  time: null,
  status: "planned",
  currency: "EUR",
  location: null,
  notes: null,
  recurrenceId: null,
  customFields: {},
  ...over,
});

export const makeEventType = (
  over: Partial<EventTypeDef> = {},
): EventTypeDef => ({
  ...base("event-type-1"),
  key: "veto",
  label: "Vétérinaire",
  icon: "firstAidKit",
  theme: "pink",
  isBuiltIn: true,
  isAppointment: true,
  tracksWork: false,
  archived: false,
  order: 0,
  fields: [],
  ...over,
});

/**
 * The 13 built-in `EventTypeDef` rows, stamped with fresh `BaseRecord` fields
 * — the same shape `seedEventTypeDefs` (`event-types.ts`) produces, but with
 * stable, key-derived ids so a test can address one by name.
 */
export const BUILT_IN_EVENT_TYPE_ROWS: EventTypeDef[] =
  BUILT_IN_EVENT_TYPES.map((def) => ({
    ...base(`event-type-${def.key}`),
    ...def,
  }));

/**
 * Seeds the real 13 built-in types into `db.eventTypes` — what any component
 * test whose `LiveQuery` reads the live catalogue needs, the same way a real
 * install always has them from the schema v6 migration.
 */
export const seedBuiltInEventTypes = (): Promise<unknown> =>
  db.eventTypes.bulkAdd(BUILT_IN_EVENT_TYPE_ROWS);

export const makeRation = (over: Partial<RationItem> = {}): RationItem => ({
  ...base("ration-1"),
  horseId: HORSE_ID,
  label: "Fib & Fib",
  quantity: 1.5,
  unit: "L",
  season: null,
  sortOrder: 0,
  ...over,
});

export const makeDocument = (
  over: Partial<StoredDocument> = {},
): StoredDocument => ({
  ...base("document-1"),
  horseId: HORSE_ID,
  eventId: null,
  category: "facture",
  name: "facture.pdf",
  mimeType: "application/pdf",
  size: 1024,
  issuedAt: null,
  driveFileId: null,
  driveSyncedAt: null,
  ...over,
});

/**
 * Clears every table and re-establishes the owner id.
 *
 * `createRecord` throws without an owner, so this stands in for the `initData()`
 * the app runs at start-up. Tables are cleared rather than the database being
 * deleted — only `db.test.ts` needs a real version change.
 *
 * It opens the data-ready gate for the same reason: standing in for `initData()`
 * means standing in for all of it, and a `LiveQuery` under test would otherwise
 * wait on a gate nothing in the suite ever opens.
 */
export const resetDb = async (): Promise<void> => {
  await db.open();
  markDataReady();
  // Driven by `RECORD_TABLES` rather than a hand-written list, for the reason
  // `db.ts` gives for that constant existing. A table missing from here does not
  // fail — it leaks rows into the next test, which surfaces as a failure in some
  // other file with nothing pointing back at the cause. `documentBlobs` and
  // `meta` are named separately because they are deliberately not record tables.
  await Promise.all([
    ...Object.values(RECORD_TABLES).map((table) => table.clear()),
    db.documentBlobs.clear(),
    db.meta.clear(),
  ]);
  await setOwnerId(OWNER);
  // The 13 built-ins, present the same way a real install always has them
  // after the schema v6 migration — so a suite testing something else
  // entirely does not also have to seed the event-type catalogue just to keep
  // a `LiveQuery` over it from settling empty. A test with different types in
  // mind overrides by writing its own rows on top.
  await seedBuiltInEventTypes();
};
