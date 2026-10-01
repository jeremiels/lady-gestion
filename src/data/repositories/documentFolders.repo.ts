import { db } from "../db.ts";
import { syncedAsOf } from "../drive-mirror.ts";
import { createRecord, crud, liveOnly } from "../record.ts";
import type { DocumentFolder } from "../types.ts";

/**
 * The folders of the user's Drive, as mirrored on this device.
 *
 * Read whole and filtered in memory: a Drive folder tree for one horse's
 * paperwork is a few dozen rows at most.
 */

/** Every live folder, alphabetical — the order a Drive lists them in. */
export const list = async (): Promise<DocumentFolder[]> => {
  const folders = await db.documentFolders.toArray();
  return liveOnly(folders).sort((a, b) => a.name.localeCompare(b.name, "fr"));
};

export const { get, update, remove } = crud<DocumentFolder>(db.documentFolders);

/** A folder made in the app: created in the Drive by the next sync. */
export const create = async (
  name: string,
  parentId: string | null,
): Promise<DocumentFolder> => {
  const folder = createRecord<DocumentFolder>({
    name,
    parentId,
    driveFolderId: null,
    driveModifiedAt: null,
    driveSyncedAt: null,
  });
  await db.documentFolders.add(folder);
  return folder;
};

/** Every row, tombstones included — what the sync pushes from. */
export const listAll = (): Promise<DocumentFolder[]> =>
  db.documentFolders.toArray();

/**
 * Records that the Drive now matches the row as it stood at `asOf` — see
 * `documentsRepo.markSynced` — and its folder id, when the sync just created
 * it there.
 */
export const markSynced = async (
  id: string,
  drive: { driveFolderId?: string; driveModifiedAt: string | null },
  asOf: string,
): Promise<void> => {
  const existing = await db.documentFolders.get(id);
  if (!existing) return;
  await db.documentFolders.put({
    ...existing,
    ...drive,
    driveSyncedAt: syncedAsOf(existing, asOf),
  });
};

/**
 * Takes back a deletion the sync did not send — the folder is not empty in
 * the Drive — and records the row as in step with it as of `asOf`. A row
 * changed since `asOf` is left alone: that change is newer than the deletion.
 */
export const markRestored = async (id: string, asOf: string): Promise<void> => {
  const existing = await db.documentFolders.get(id);
  if (!existing || existing.updatedAt !== asOf) return;
  await db.documentFolders.put({
    ...existing,
    deletedAt: null,
    driveSyncedAt: asOf,
  });
};
