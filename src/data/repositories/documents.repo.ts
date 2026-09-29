import { db } from "../db.ts";
import { createRecord, crud, liveOnly, softDelete, touch } from "../record.ts";
import { pending } from "../drive-mirror.ts";
import type { NewRecord, StoredDocument } from "../types.ts";

/**
 * Document metadata and file bytes are stored in two tables and joined here.
 *
 * Listing documents must never deserialize the blobs — a folder view with
 * thirty scanned invoices would otherwise pull thirty PDFs into memory just
 * to render thirty file names. `getBlob()` fetches bytes only on demand.
 */

export const listByHorse = async (
  horseId: string,
): Promise<StoredDocument[]> => {
  const documents = await db.documents
    .where("horseId")
    .equals(horseId)
    .toArray();
  return sortByIssueDate(liveOnly(documents));
};

export const listByPost = async (postId: string): Promise<StoredDocument[]> => {
  const documents = await db.documents.where("postId").equals(postId).toArray();
  return sortByIssueDate(liveOnly(documents));
};

/** The documents filed in one folder, newest first; `null` for the general folder itself. */
export const listByFolder = async (
  folderId: string | null,
): Promise<StoredDocument[]> => {
  // `null` is not an IndexedDB key, so the general folder's are found in memory.
  const documents =
    folderId === null
      ? (await db.documents.toArray()).filter((row) => row.folderId === null)
      : await db.documents.where("folderId").equals(folderId).toArray();
  return sortByIssueDate(liveOnly(documents));
};

/**
 * Document counts per folder id, for the folder tiles on the documents view.
 * Documents filed directly in the general folder (`folderId: null`) are not
 * counted: no tile stands for it.
 */
export const countByFolder = async (
  horseId: string,
): Promise<Record<string, number>> => {
  const documents = await listByHorse(horseId);
  const counts: Record<string, number> = {};
  for (const { folderId } of documents) {
    if (folderId !== null) counts[folderId] = (counts[folderId] ?? 0) + 1;
  }
  return counts;
};

/**
 * Two of the three, deliberately. The shared `remove` writes a tombstone and
 * stops; this table's deletion also has to drop the file bytes, in the same
 * transaction — so it is written out below instead.
 */
export const { get, update } = crud<StoredDocument>(db.documents);

/** Stores metadata and bytes together, so the two can never diverge. */
export const create = async (
  fields: Omit<
    NewRecord<StoredDocument>,
    "mimeType" | "size" | "driveFileId" | "driveModifiedAt" | "driveSyncedAt"
  >,
  file: Blob,
): Promise<StoredDocument> => {
  const document = createRecord<StoredDocument>({
    ...fields,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    driveFileId: null,
    driveModifiedAt: null,
    driveSyncedAt: null,
  });

  await db.transaction("rw", [db.documents, db.documentBlobs], async () => {
    await db.documents.add(document);
    await db.documentBlobs.put({ documentId: document.id, blob: file });
  });

  return document;
};

export const getBlob = async (id: string): Promise<Blob | undefined> =>
  (await db.documentBlobs.get(id))?.blob;

/**
 * Documents added in the app and not in the Drive yet, oldest first — the
 * order they were joined in.
 */
export const listPendingUpload = async (): Promise<StoredDocument[]> =>
  liveOnly(await db.documents.toArray())
    .filter((document) => document.driveFileId === null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

/** Records the Drive file an upload created, as in step with it. */
export const markUploaded = async (
  id: string,
  drive: { driveFileId: string; driveModifiedAt: string },
): Promise<void> => {
  const existing = await get(id);
  if (!existing) return;
  const uploaded = touch(existing, drive);
  await db.documents.put({ ...uploaded, driveSyncedAt: uploaded.updatedAt });
};

/**
 * Documents already in the Drive and changed in the app since — renamed,
 * moved, linked or deleted — tombstones included: a deletion has to reach
 * the Drive too.
 */
export const listPendingChanges = async (): Promise<StoredDocument[]> =>
  (await db.documents.toArray()).filter(
    (document) => document.driveFileId !== null && pending(document),
  );

/**
 * Records that the Drive now matches the row as it stood at `asOf` — the
 * `updatedAt` of the version that was sent. An edit made while it was on its
 * way is newer than that, so the row stays pending for the next push rather
 * than being taken as sent. `updatedAt` is not restamped, which would make
 * the row look changed again.
 */
export const markSynced = async (
  id: string,
  driveModifiedAt: string,
  asOf: string,
): Promise<void> => {
  const existing = await db.documents.get(id);
  if (!existing) return;
  await db.documents.put({ ...existing, driveModifiedAt, driveSyncedAt: asOf });
};

/** Caches bytes fetched from the Drive, so the file opens offline next time. */
export const putBlob = async (id: string, blob: Blob): Promise<void> => {
  await db.documentBlobs.put({ documentId: id, blob });
};

/**
 * An object URL for rendering the document. Callers own the URL and must
 * call `URL.revokeObjectURL` when done, or the blob stays pinned in memory.
 */
export const getObjectUrl = async (id: string): Promise<string | undefined> => {
  const blob = await getBlob(id);
  return blob && URL.createObjectURL(blob);
};

/**
 * Soft-deletes the metadata and hard-deletes the bytes.
 *
 * The tombstone is what has to survive so the deletion can propagate; the
 * file itself does not, and keeping megabytes of deleted scans around would
 * fill the origin's storage quota for no benefit.
 */
export const remove = async (id: string): Promise<void> => {
  const existing = await get(id);
  if (!existing) return;

  await db.transaction("rw", [db.documents, db.documentBlobs], async () => {
    await db.documents.put(softDelete(existing));
    await db.documentBlobs.delete(id);
  });
};

const sortByIssueDate = (documents: StoredDocument[]): StoredDocument[] =>
  documents.sort((a, b) =>
    (b.issuedAt ?? b.createdAt).localeCompare(a.issuedAt ?? a.createdAt),
  );
