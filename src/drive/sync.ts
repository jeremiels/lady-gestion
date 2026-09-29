/**
 * Keeping the mirror in step with the general folder (`docs/drive-spec.md`
 * §6.5), and fetching a file's bytes when it is opened.
 *
 * A sync first uploads what was joined in the app, then walks the general
 * folder's tree, one request per folder, and hands
 * the whole of it to `driveMirrorService.mirrorDrive` — which writes only
 * what changed. A folder of a horse's paperwork is a handful of requests, so
 * a full walk is cheaper to get right than following Drive's change feed.
 *
 * It runs when the sign-in or the folder changes, when the app returns to the
 * foreground and when the network comes back. Offline, or with the Worker
 * down, it fails quietly and the mirror keeps showing the last good state.
 */

import {
  documentFoldersRepo,
  documentsRepo,
  driveMirrorService,
  pendingDriveChange as pending,
  watchDriveSetup,
  type DriveSetup,
  type RemoteFile,
  type RemoteFolder,
} from "../data/index.ts";
import type { StoredDocument } from "../data/types.ts";
import {
  createFolder,
  downloadFile,
  FOLDER,
  listChildren,
  parentsOf,
  updateFile,
  uploadFile,
} from "./api.ts";

/** Google Drive shortcuts point at a file elsewhere; there is nothing to show. */
const SHORTCUT = "application/vnd.google-apps.shortcut";

/** A foreground return sooner than this after the last sync does not start another. */
const MIN_INTERVAL_MS = 30 * 1000;

let setup: DriveSetup = { account: undefined, folder: undefined };
let running: Promise<void> | null = null;
let again = false;
let lastRun = 0;

/**
 * Walks the tree under `rootId`, breadth first, a level's folders at once.
 * A folder reached twice — Drive allows more than one parent — is read once.
 */
export const walkFolder = async (
  rootId: string,
): Promise<{ folders: RemoteFolder[]; files: RemoteFile[] }> => {
  const folders: RemoteFolder[] = [];
  const files: RemoteFile[] = [];
  const seen = new Set([rootId]);
  let level = [rootId];

  while (level.length > 0) {
    const listings = await Promise.all(level.map((id) => listChildren(id)));
    const next: string[] = [];
    listings.forEach((items, index) => {
      const parentDriveId = level[index]!;
      for (const item of items) {
        if (item.mimeType === FOLDER) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          next.push(item.id);
          folders.push({
            driveId: item.id,
            name: item.name,
            parentDriveId,
            modifiedTime: item.modifiedTime,
          });
        } else if (item.mimeType !== SHORTCUT) {
          files.push({
            driveId: item.id,
            name: item.name,
            mimeType: item.mimeType,
            size: Number(item.size ?? 0),
            parentDriveId,
            modifiedTime: item.modifiedTime,
          });
        }
      }
    });
    level = next;
  }
  return { folders, files };
};

/**
 * One pass over the general folder: send what the app holds that the Drive
 * does not, then read the whole tree back into the mirror.
 */
export const syncFolder = async (rootId: string): Promise<void> => {
  await pushPending(rootId);
  const tree = await walkFolder(rootId);
  await driveMirrorService.mirrorDrive({ rootDriveId: rootId, ...tree });
};

/**
 * One sync, unless one is running — then that one's result. `force` skips the
 * interval check, for a change of sign-in or folder or a file just joined.
 */
export const syncDrive = (force = false): Promise<void> => {
  if (running) {
    // A forced sync asked mid-run — a file just joined — may have missed the
    // pending list this run read: one more pass follows it.
    if (force) again = true;
    return running;
  }
  if (!setup.account || !setup.folder) return Promise.resolve();
  if (!force && Date.now() - lastRun < MIN_INTERVAL_MS) {
    return Promise.resolve();
  }

  const rootId = setup.folder.id;
  running = syncFolder(rootId)
    .then(() => {
      lastRun = Date.now();
    })
    .catch((error: unknown) => {
      // Offline, Worker down, signed out meanwhile: the mirror stays as it
      // was, and the next foreground return tries again.
      console.warn("[drive] Synchronisation impossible :", error);
    })
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        void syncDrive(true);
      }
    });
  return running;
};

/**
 * Sends everything done in the app and not in the Drive yet, before the walk
 * — so the walk finds each row already as the Drive has it, rather than a
 * stranger to add a second row for, or a stale name to write back.
 *
 * Folders are created first, since files may be filed in them. One change at
 * a time; the first failure stops the run and leaves the rest pending for the
 * next sync — the walk does not run either, so nothing is written back over
 * them meanwhile.
 */
const pushPending = async (rootId: string): Promise<void> => {
  await createPendingFolders(rootId);
  await pushFolderChanges();
  await uploadPending(rootId);
  await pushDocumentChanges(rootId);
};

/** Where a mirrored folder is in the Drive; the general folder for `null`. */
const driveIdOf = async (
  folderId: string | null,
  rootId: string,
): Promise<string> => {
  if (folderId === null) return rootId;
  const folder = (await documentFoldersRepo.listAll()).find(
    ({ id }) => id === folderId,
  );
  return folder?.driveFolderId ?? rootId;
};

/**
 * Folders made in the app, parents before children: a child waits for the
 * pass that gives its parent a Drive id.
 */
const createPendingFolders = async (rootId: string): Promise<void> => {
  for (;;) {
    const folders = await documentFoldersRepo.listAll();
    const known = new Map(folders.map((folder) => [folder.id, folder]));
    const ready = folders.filter(
      (folder) =>
        folder.deletedAt === null &&
        folder.driveFolderId === null &&
        (folder.parentId === null ||
          known.get(folder.parentId)?.driveFolderId != null),
    );
    if (ready.length === 0) return;
    for (const folder of ready) {
      const parent =
        folder.parentId === null
          ? rootId
          : known.get(folder.parentId)!.driveFolderId!;
      const created = await createFolder(folder.name, parent);
      await documentFoldersRepo.markSynced(
        folder.id,
        { driveFolderId: created.id, driveModifiedAt: created.modifiedTime },
        folder.updatedAt,
      );
    }
  }
};

/** Renamed or deleted in the app: the name, or to the trash. */
const pushFolderChanges = async (): Promise<void> => {
  for (const folder of await documentFoldersRepo.listAll()) {
    if (folder.driveFolderId === null || !pending(folder)) continue;
    const modifiedTime = await updateFile(
      folder.driveFolderId,
      folder.deletedAt !== null ? { trashed: true } : { name: folder.name },
    );
    await documentFoldersRepo.markSynced(
      folder.id,
      { driveModifiedAt: modifiedTime },
      folder.updatedAt,
    );
  }
};

/**
 * Renamed, moved, linked or deleted in the app. A move reads the file's
 * current parents first: the Drive moves a file by adding the new folder and
 * removing the old.
 */
const pushDocumentChanges = async (rootId: string): Promise<void> => {
  for (const doc of await documentsRepo.listPendingChanges()) {
    const driveId = doc.driveFileId!;
    let modifiedTime: string;
    if (doc.deletedAt !== null) {
      modifiedTime = await updateFile(driveId, { trashed: true });
    } else {
      const target = await driveIdOf(doc.folderId, rootId);
      const parents = await parentsOf(driveId);
      modifiedTime = await updateFile(driveId, {
        name: doc.name,
        appProperties: { ladyPostId: doc.postId },
        ...(parents.includes(target) && parents.length === 1
          ? {}
          : { move: { from: parents, to: target } }),
      });
    }
    await documentsRepo.markSynced(doc.id, modifiedTime, doc.updatedAt);
  }
};

/**
 * Files joined in the app, oldest first. One whose bytes are gone from the
 * device cannot be sent and is skipped.
 */
const uploadPending = async (rootId: string): Promise<void> => {
  for (const doc of await documentsRepo.listPendingUpload()) {
    const blob = await documentsRepo.getBlob(doc.id);
    if (!blob) continue;
    const uploaded = await uploadFile(
      doc.name,
      blob,
      await driveIdOf(doc.folderId, rootId),
      doc.postId ? { ladyPostId: doc.postId } : {},
    );
    await documentsRepo.markUploaded(doc.id, {
      driveFileId: uploaded.id,
      driveModifiedAt: uploaded.modifiedTime,
    });
  }
};

/**
 * A document's bytes: from the device when cached, from the Drive otherwise —
 * and cached then, so it opens offline next time. `undefined` for a document
 * with neither.
 */
export const documentBytes = async (
  doc: StoredDocument,
): Promise<Blob | undefined> => {
  const cached = await documentsRepo.getBlob(doc.id);
  if (cached) return cached;
  if (!doc.driveFileId) return undefined;

  const blob = await downloadFile(doc.driveFileId, doc.mimeType);
  await documentsRepo.putBlob(doc.id, blob);
  return blob;
};

/** Starts keeping the mirror in step. Called once, after the database opens. */
export function initDriveSync() {
  watchDriveSetup((next) => {
    const changed =
      next.account?.sessionToken !== setup.account?.sessionToken ||
      next.folder?.id !== setup.folder?.id;
    setup = next;
    if (changed) void syncDrive(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncDrive();
  });
  window.addEventListener("online", () => void syncDrive(true));
}
