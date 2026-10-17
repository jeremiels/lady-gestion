import { onTestFinished } from "vitest";
import { db, SCHEMA_VERSION, type BackupTables } from "../db.ts";
import { seedCategories } from "../categories.ts";
import { setOwnerId } from "../owner.ts";
import type { Category, Horse, Post, RationItem } from "../types.ts";
import type { BackupSnapshot } from "./snapshot.ts";
import { checkBackup, type CheckedBackup } from "./validate.ts";

/**
 * Rows and envelopes for the backup tests (`snapshot.test.ts`,
 * `validate.test.ts`, and the restore in `ProfileView.test.ts`). Not a test
 * file itself.
 */

export const LOCAL_OWNER = "owner-local";
export const REMOTE_OWNER = "owner-remote";

export const horse = (over: Partial<Horse> = {}): Horse => ({
  id: "horse-1",
  ownerId: REMOTE_OWNER,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  firstName: "Ladympala",
  lastName: null,
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

export const STAMP = "2026-01-01T00:00:00.000Z";

/**
 * The 14 built-in types as another device seeded them (`seedCategories`) —
 * what a current-schema snapshot carries.
 */
export const categoryRows: Category[] = seedCategories(REMOTE_OWNER, STAMP);

/**
 * A well-formed snapshot, overridden where a test cares.
 *
 * `tables` is laid over a full set of empty tables, so a case names only the
 * table it is about, and adding a table to the schema breaks no literal that
 * was never the point of its own test.
 */
export const snapshot = (
  over: Partial<Omit<BackupSnapshot, "tables">> & {
    tables?: Partial<BackupTables>;
  } = {},
): BackupSnapshot => ({
  app: "lady-gestion",
  schemaVersion: SCHEMA_VERSION,
  exportedAt: "2026-08-11T00:00:00.000Z",
  ownerId: REMOTE_OWNER,
  ...over,
  tables: {
    horses: [],
    posts: [],
    documents: [],
    documentFolders: [],
    rationItems: [],
    activities: [],
    categories: [],
    profiles: [],
    ...over.tables,
  },
});

/**
 * `snapshot(over)` read the way the app reads a picked file, through
 * `checkBackup`: what `importBackup` takes.
 */
export const checked = (
  over: Parameters<typeof snapshot>[0] = {},
): CheckedBackup => checkBackup(snapshot(over));

/** `content` as the file "Restaurer un fichier" picks: what `planRestore` reads. */
export const pickedFile = (content: unknown): File =>
  new File([JSON.stringify(content)], "backup.json", {
    type: "application/json",
  });

/**
 * Stands in for the share sheet until the test ends, and returns the files it
 * was handed. `answer` is how the sheet answers: taken by default,
 * `dismissed` for the user closing it.
 *
 * Defined on `navigator` rather than replacing it, so the browser suites keep
 * every other property of the real one.
 */
export const stubShare = (
  answer: () => Promise<void> = async () => {},
): File[] => {
  const shared: File[] = [];
  Object.defineProperties(navigator, {
    canShare: { configurable: true, value: () => true },
    share: {
      configurable: true,
      value: async ({ files = [] }: ShareData) => {
        shared.push(...files);
        await answer();
      },
    },
  });
  onTestFinished(() => {
    delete (navigator as { share?: unknown }).share;
    delete (navigator as { canShare?: unknown }).canShare;
  });
  return shared;
};

/** The share sheet closed without taking the file. */
export const dismissed = async (): Promise<void> => {
  throw new DOMException("dismissed", "AbortError");
};

/** Every test starts from an empty database owned by `LOCAL_OWNER`. */
export const resetDatabase = async (): Promise<void> => {
  await db.open();
  await Promise.all([
    db.horses.clear(),
    db.posts.clear(),
    db.documents.clear(),
    db.documentFolders.clear(),
    db.documentBlobs.clear(),
    db.rationItems.clear(),
    db.activities.clear(),
    db.categories.clear(),
    db.profiles.clear(),
    db.meta.clear(),
  ]);
  await setOwnerId(LOCAL_OWNER);
};
