import { db } from '../db.ts';
import { createRecord, crud, liveOnly, softDelete } from '../record.ts';
import type { DocumentCategory } from '../../types/document.types.ts';
import type { NewRecord, StoredDocument } from '../types.ts';

/**
 * Document metadata and file bytes are stored in two tables and joined here.
 *
 * Listing documents must never deserialize the blobs — a folder view with
 * thirty scanned invoices would otherwise pull thirty PDFs into memory just
 * to render thirty file names. `getBlob()` fetches bytes only on demand.
 */

export const listByHorse = async (horseId: string): Promise<StoredDocument[]> => {
  const documents = await db.documents.where('horseId').equals(horseId).toArray();
  return sortByIssueDate(liveOnly(documents));
};

export const listByEvent = async (eventId: string): Promise<StoredDocument[]> => {
  const documents = await db.documents.where('eventId').equals(eventId).toArray();
  return sortByIssueDate(liveOnly(documents));
};

/** Document counts per category, for the folder tiles on the documents view. */
export const countByCategory = async (
  horseId: string,
): Promise<Partial<Record<DocumentCategory, number>>> => {
  const documents = await listByHorse(horseId);
  const counts: Partial<Record<DocumentCategory, number>> = {};
  for (const document of documents) {
    counts[document.category] = (counts[document.category] ?? 0) + 1;
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
  fields: Omit<NewRecord<StoredDocument>, 'mimeType' | 'size' | 'driveFileId' | 'driveSyncedAt'>,
  file: Blob,
): Promise<StoredDocument> => {
  const document = createRecord<StoredDocument>({
    ...fields,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    driveFileId: null,
    driveSyncedAt: null,
  });

  await db.transaction('rw', [db.documents, db.documentBlobs], async () => {
    await db.documents.add(document);
    await db.documentBlobs.put({ documentId: document.id, blob: file });
  });

  return document;
};

export const getBlob = async (id: string): Promise<Blob | undefined> =>
  (await db.documentBlobs.get(id))?.blob;

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

  await db.transaction('rw', [db.documents, db.documentBlobs], async () => {
    await db.documents.put(softDelete(existing));
    await db.documentBlobs.delete(id);
  });
};

const sortByIssueDate = (documents: StoredDocument[]): StoredDocument[] =>
  documents.sort((a, b) => (b.issuedAt ?? b.createdAt).localeCompare(a.issuedAt ?? a.createdAt));
