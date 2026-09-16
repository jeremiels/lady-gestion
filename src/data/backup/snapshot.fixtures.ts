import { db, SCHEMA_VERSION, type BackupTables } from "../db.ts";
import { BUILT_IN_CATEGORIES } from "../categories.ts";
import { setOwnerId } from "../owner.ts";
import type {
  Category,
  Horse,
  Post,
  RationItem,
  StoredDocument,
} from "../types.ts";
import type { BackupSnapshot } from "./snapshot.ts";

/**
 * Rows and envelopes shared by the backup tests (`snapshot.test.ts`,
 * `snapshot.v13.test.ts`). Not a test file itself.
 */

export const LOCAL_OWNER = "owner-local";
export const REMOTE_OWNER = "owner-remote";

export const horse = (over: Partial<Horse> = {}): Horse => ({
  id: "horse-1",
  ownerId: REMOTE_OWNER,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
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

export const ration = (over: Partial<RationItem> = {}): RationItem => ({
  id: "ration-1",
  ownerId: REMOTE_OWNER,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  horseId: "horse-1",
  label: "Fib & fib",
  quantity: 2,
  unit: "kg",
  season: null,
  sortOrder: 0,
  ...over,
});

export const post = (over: Partial<Post> = {}): Post => ({
  id: "event-1",
  ownerId: REMOTE_OWNER,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  horseId: "horse-1",
  categoryKey: "veto",
  title: "Contrôle œil",
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

/** A post row as a pre-v13 file carries it: `type` where `categoryKey` is now. */
export type LegacyEvent = Omit<Post, "categoryKey"> & { type: string };

export const event = (
  over: Partial<Omit<Post, "categoryKey">> & { type?: string } = {},
): LegacyEvent => {
  const { categoryKey, ...rest } = post();
  return { ...rest, type: categoryKey, ...over };
};

/** The tables of a pre-v13 file, under the names it wrote them with. */
export type LegacyTables = Omit<BackupTables, "posts" | "categories"> & {
  events: LegacyEvent[];
  eventTypes: Category[];
};

export const document = (
  over: Partial<StoredDocument> = {},
): StoredDocument => ({
  id: "doc-1",
  ownerId: REMOTE_OWNER,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  horseId: "horse-1",
  postId: null,
  category: "facture",
  name: "facture.pdf",
  mimeType: "application/pdf",
  size: 1,
  issuedAt: null,
  driveFileId: null,
  driveSyncedAt: null,
  ...over,
});

export const STAMP = "2026-01-01T00:00:00.000Z";

/** The 14 built-in types, stamped — what a current-schema snapshot carries. */
export const categoryRows: Category[] = BUILT_IN_CATEGORIES.map((def) => ({
  ...def,
  id: `type-${def.key}`,
  ownerId: REMOTE_OWNER,
  createdAt: STAMP,
  updatedAt: STAMP,
  deletedAt: null,
}));

/**
 * A well-formed snapshot, overridden where a test cares.
 *
 * `tables` merges rather than replaces, so a case names only the table it is
 * about. Every case used to restate all four to satisfy `BackupTables`, which
 * meant adding a table to the schema broke seven literals that were never the
 * point of their own test.
 *
 * A file older than v13 gets `events`/`eventTypes` rather than
 * `posts`/`categories`, the names it was written with.
 */
export const snapshot = (
  over: Partial<Omit<BackupSnapshot, "tables">> & {
    tables?: Partial<BackupTables> | Partial<LegacyTables>;
  } = {},
): BackupSnapshot => {
  const schemaVersion = over.schemaVersion ?? SCHEMA_VERSION;
  const renamed =
    schemaVersion < 13
      ? { events: [], eventTypes: [] }
      : { posts: [], categories: [] };
  return {
    app: "lady-gestion",
    exportedAt: "2026-08-11T00:00:00.000Z",
    ownerId: REMOTE_OWNER,
    ...over,
    schemaVersion,
    tables: {
      horses: [],
      documents: [],
      rationItems: [],
      activities: [],
      profiles: [],
      ...renamed,
      ...over.tables,
    } as unknown as BackupTables,
  };
};

/** A snapshot's tables read under their pre-v13 names. */
export const legacy = (backup: BackupSnapshot) =>
  backup.tables as unknown as LegacyTables;

/** Every test starts from an empty database owned by `LOCAL_OWNER`. */
export const resetDatabase = async (): Promise<void> => {
  await db.open();
  await Promise.all([
    db.horses.clear(),
    db.posts.clear(),
    db.documents.clear(),
    db.documentBlobs.clear(),
    db.rationItems.clear(),
    db.activities.clear(),
    db.categories.clear(),
    db.profiles.clear(),
    db.meta.clear(),
  ]);
  await setOwnerId(LOCAL_OWNER);
};
