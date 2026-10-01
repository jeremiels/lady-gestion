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
  metaRepo,
  pendingDriveChange as pending,
  sendsTo,
  watchDriveSetup,
  type DriveSetup,
  type RemoteFile,
  type RemoteFolder,
} from "../data/index.ts";
import type {
  DocumentDriveChange,
  DocumentFolder,
  DriveMeta,
  StoredDocument,
} from "../data/types.ts";
import { DriveSignedOutError, getFolder } from "./auth.ts";
import {
  createFolder,
  downloadFile,
  DriveRequestError,
  findByAppProperty,
  FOLDER,
  listChildren,
  parentsOf,
  updateFile,
  uploadFile,
  visibility,
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
 * Anything reached twice — Drive allows more than one parent — is read once,
 * filed where it was first found.
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
        if (item.mimeType === SHORTCUT || seen.has(item.id)) continue;
        seen.add(item.id);
        if (item.mimeType === FOLDER) {
          next.push(item.id);
          folders.push({
            driveId: item.id,
            name: item.name,
            parentDriveId,
            modifiedTime: item.modifiedTime,
          });
        } else {
          files.push({
            driveId: item.id,
            name: item.name,
            mimeType: item.mimeType,
            size: Number(item.size ?? 0),
            parentDriveId,
            modifiedTime: item.modifiedTime,
            postId: item.appProperties?.ladyPostId ?? null,
            docId: item.appProperties?.ladyDocId ?? null,
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
 *
 * First, whether the account signed in can see the folder at all. One of
 * another Google account — she signed out and in again with a different one
 * — or deleted for good is forgotten, and she is asked to pick one again;
 * walked regardless, it would read as empty and every row would go. One in
 * the Drive's trash is left alone until she takes it out: walked, it would
 * read as empty too, and anything sent into it would go to the trash with it.
 * That is the one way a pass ends without having synced and without an
 * error, so it resolves `trashed` then, and nothing otherwise.
 */
export const syncFolder = async (
  rootId: string,
): Promise<"trashed" | undefined> => {
  const root = await visibility(rootId);
  if (root === "gone") {
    await driveMirrorService.forgetFolder(rootId);
    return undefined;
  }
  if (root === "trashed") {
    console.warn("[drive] Le dossier général est dans la corbeille du Drive.");
    return "trashed";
  }
  await pushPending(rootId);
  const tree = await walkFolder(rootId);
  await driveMirrorService.mirrorDrive({ rootDriveId: rootId, ...tree });
  return undefined;
};

/**
 * Keeps what stood in the way of the last sync (`driveSyncProblem`) for the
 * Documents page to say; `undefined` once one went through. Written only when
 * it changes, and never a reason for a sync to fail in its turn.
 */
const recordProblem = async (
  problem: DriveMeta["driveSyncProblem"] | undefined,
): Promise<void> => {
  try {
    const known =
      await metaRepo.get<DriveMeta["driveSyncProblem"]>("driveSyncProblem");
    if (known === problem) return;
    if (problem) await metaRepo.set("driveSyncProblem", problem);
    else await metaRepo.remove("driveSyncProblem");
  } catch (error: unknown) {
    console.warn("[drive] État de la synchronisation non enregistré :", error);
  }
};

/**
 * Whether a failed sync is one to tell her about. Not when it will pass on
 * its own or is already on screen: no connection, signed out — "Connecter
 * Google Drive" is back — or another general folder picked while it ran,
 * which the sync that change started settles.
 */
const standsInTheWay = (error: unknown): boolean =>
  !(
    error instanceof DriveSignedOutError ||
    error instanceof GeneralFolderChanged ||
    (error instanceof DriveRequestError && error.status === 0)
  );

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
    .then((problem) => {
      lastRun = Date.now();
      return recordProblem(problem);
    })
    .catch((error: unknown) => {
      // Offline, Worker down, signed out meanwhile: the mirror stays as it
      // was, and the next foreground return tries again.
      console.warn("[drive] Synchronisation impossible :", error);
      if (standsInTheWay(error)) return recordProblem("failed");
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
 * Folders are created first, since files may be filed in them; folders are
 * deleted last, once the files moved or deleted out of them have gone. One
 * change at a time. A failure that may pass — offline, the Worker down —
 * stops the run and leaves the rest pending for the next sync, walk included.
 * One the Drive will give every time (`isPermanent`) is given up on instead:
 * left to block, it would stop every sync after it for good, and the app
 * would never see the Drive again. A refusal that is neither leaves its one
 * change pending and the run going (`givesUpOn`).
 */
const pushPending = async (rootId: string): Promise<void> => {
  await createPendingFolders(rootId);
  await uploadPending(rootId);
  await pushDocumentChanges(rootId);
  await pushFolderChanges(rootId);
};

/**
 * Where a mirrored folder is in the Drive: the general folder for `null`,
 * `undefined` for one not there — never created, or gone from the Drive as of
 * the last walk.
 */
const mirroredDriveId = async (
  folderId: string | null,
  rootId: string,
): Promise<string | undefined> => {
  if (folderId === null) return rootId;
  const folder = (await documentFoldersRepo.listAll()).find(
    ({ id }) => id === folderId,
  );
  return (folder?.deletedAt === null && folder.driveFolderId) || undefined;
};

/**
 * Whether something can be filed in `driveId` now. Asked of the Drive rather
 * than the mirror, which is as of the last walk: a folder she has put in the
 * trash since would take whatever is filed into it along, and one she has
 * moved out of the general folder would take it out of the app's sight.
 */
const canFileIn = async (driveId: string, rootId: string): Promise<boolean> =>
  driveId === rootId ||
  ((await visibility(driveId)) === "visible" &&
    (await inGeneralFolder(driveId, rootId)));

/**
 * Whether `driveId` is the general folder or sits under it, asked of the
 * Drive: up through its parents, as many levels as there are. Not of the
 * mirror, which is as of the last walk — a folder she has moved out of the
 * general folder since still reads there as part of it, and so does
 * everything in it.
 */
const inGeneralFolder = async (
  driveId: string,
  rootId: string,
): Promise<boolean> => {
  if (driveId === rootId) return true;
  for (const parent of await parentsOf(driveId)) {
    if (await inGeneralFolder(parent, rootId)) return true;
  }
  return false;
};

/**
 * Drive's words for a request refused only for now: too many, too fast, or
 * the day's allowance spent. It says so with a 403, the status it also uses
 * for a refusal that holds.
 */
const RATE_LIMITED = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "dailyLimitExceeded",
]);

const isRateLimited = (error: DriveRequestError): boolean =>
  error.status === 429 ||
  (error.status === 403 && RATE_LIMITED.has(error.reason ?? ""));

/**
 * Drive's words for a 403 that holds: the file or folder is hers to read but
 * not to change. Any other 403 is about the app or the account as a whole —
 * the API switched off, a policy — and says nothing lasting about the file.
 */
const NOT_HERS_TO_CHANGE = new Set([
  "insufficientFilePermissions",
  "appNotAuthorizedToFile",
]);

/**
 * A refusal the Drive will repeat on every try: the file is gone (404), hers
 * to read but not to change (403, `NOT_HERS_TO_CHANGE`), or the request is
 * one it will not take (400). Offline, the Worker down, a rate limit: those
 * pass, and are not.
 */
const isPermanent = (error: unknown): boolean =>
  error instanceof DriveRequestError &&
  (error.status === 400 ||
    error.status === 404 ||
    (error.status === 403 && NOT_HERS_TO_CHANGE.has(error.reason ?? "")));

/**
 * Whether to give up on a change the Drive refused: `true` for a refusal it
 * will repeat every time (`isPermanent`), `false` for a 403 it gives no
 * lasting reason for — the change then stays pending, hers rather than thrown
 * away, and the run goes on. Rethrows anything else: nothing gets through now.
 */
const givesUpOn = (error: unknown): boolean => {
  if (isPermanent(error)) {
    console.warn("[drive] Refusé par le Drive, abandonné :", error);
    return true;
  }
  if (
    error instanceof DriveRequestError &&
    error.status === 403 &&
    !isRateLimited(error)
  ) {
    console.warn("[drive] Refusé par le Drive, réessayé plus tard :", error);
    return false;
  }
  throw error;
};

/**
 * Whether a failed upload stops the run: nothing will get through now —
 * offline, signed out, the Worker down, a rate limit. Anything else is this
 * file's alone, and one file the Drive keeps refusing must not keep the walk,
 * and every other upload, from ever running again.
 */
const stopsTheRun = (error: unknown): boolean =>
  !(error instanceof DriveRequestError) ||
  error.status === 0 ||
  error.status === 401 ||
  isRateLimited(error);

/**
 * Whether the Drive will refuse an upload every time it is sent: her Drive is
 * full (403 `storageQuotaExceeded`), the file too large (413), the folder not
 * hers to write into (403, `NOT_HERS_TO_CHANGE`), or a request it will not
 * take (400). Sent again on every sync, it would cost the whole file each
 * time, for nothing.
 */
const refusesUpload = (error: unknown): boolean =>
  error instanceof DriveRequestError &&
  (error.status === 400 ||
    error.status === 413 ||
    (error.status === 403 &&
      (error.reason === "storageQuotaExceeded" ||
        NOT_HERS_TO_CHANGE.has(error.reason ?? ""))));

/**
 * Stops the run once she has picked another general folder: what it was about
 * to send belongs in the new one, or — a change to the previous folder's
 * files — nowhere, which the sync that change started settles.
 */
const assertStillGeneral = async (rootId: string): Promise<void> => {
  if ((await getFolder())?.id !== rootId) throw new GeneralFolderChanged();
};

class GeneralFolderChanged extends Error {
  constructor() {
    super("Le dossier général a changé pendant la synchronisation.");
  }
}

/**
 * The Drive's copy of a row an earlier sync created there, found by the row
 * id it was tagged with, `undefined` when there is none.
 *
 * A creation whose answer is lost — iOS suspends the app mid-upload, the
 * network drops — has happened in the Drive all the same, and sending it
 * again would leave two copies there and two rows here. A lookup the Drive
 * refuses for good only costs that protection, not the creation itself.
 */
const alreadySent = (
  key: "ladyDocId" | "ladyFolderId",
  id: string,
): Promise<{ id: string; modifiedTime: string } | undefined> =>
  findByAppProperty(key, id).catch((error: unknown) => {
    if (!isPermanent(error)) throw error;
    console.warn("[drive] Recherche refusée par le Drive :", error);
    return undefined;
  });

/**
 * Folders made in the app, parents before children: a child waits for the
 * pass that gives its parent a Drive id. One whose parent is gone from the
 * Drive, or in its trash, is made at the top level instead, on the next pass.
 * One held back for another general folder, or kept on this phone, is not
 * made (`sendsTo`).
 */
const createPendingFolders = async (rootId: string): Promise<void> => {
  const refused = new Set<string>();
  for (;;) {
    const folders = await documentFoldersRepo.listAll();
    const known = new Map(folders.map((folder) => [folder.id, folder]));
    const ready = folders.filter(
      (folder) =>
        folder.deletedAt === null &&
        folder.driveFolderId === null &&
        !refused.has(folder.id) &&
        sendsTo(folder, known, rootId) &&
        (folder.parentId === null ||
          known.get(folder.parentId)?.driveFolderId != null),
    );
    if (ready.length === 0) return;
    for (const folder of ready) {
      const parent =
        folder.parentId === null
          ? rootId
          : known.get(folder.parentId)!.driveFolderId!;
      await assertStillGeneral(rootId);
      let created: { id: string; modifiedTime: string } | undefined;
      try {
        created = await alreadySent("ladyFolderId", folder.id);
        if (!created && !(await canFileIn(parent, rootId))) {
          await documentFoldersRepo.update(folder.id, { parentId: null });
          continue;
        }
        created ??= await createFolder(folder.name, parent, {
          ladyFolderId: folder.id,
        });
      } catch (error: unknown) {
        // Refused for good or only for now, it is not made in this run.
        givesUpOn(error);
        refused.add(folder.id);
        continue;
      }
      await documentFoldersRepo.markSynced(
        folder.id,
        { driveFolderId: created.id, driveModifiedAt: created.modifiedTime },
        folder.updatedAt,
      );
    }
  }
};

/**
 * Renamed or deleted in the app: the name, or to the trash. A change the
 * Drive refuses for good is marked sent all the same, so the walk that
 * follows writes the Drive's version over it — and so is one to a folder she
 * has moved out of the general folder in the Drive, which is no longer the
 * app's to write to: the walk lets it go.
 *
 * A folder is deleted in the app only when empty, but empty on this device
 * is as of the last walk: a file put in it from the Google Drive app since
 * would go to the trash with it, unseen. So the Drive is asked first, and a
 * folder with anything in it there is kept — the walk then shows what is in
 * it. Children go first, so a parent emptied of them reads as empty.
 */
const pushFolderChanges = async (rootId: string): Promise<void> => {
  const folders = await documentFoldersRepo.listAll();
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const depth = (folder: DocumentFolder): number => {
    const parent =
      folder.parentId === null ? undefined : byId.get(folder.parentId);
    return parent ? depth(parent) + 1 : 0;
  };
  const changed = folders
    .filter((folder) => folder.driveFolderId !== null && pending(folder))
    .sort((a, b) => depth(b) - depth(a));

  for (const folder of changed) {
    await assertStillGeneral(rootId);
    let modifiedTime = folder.driveModifiedAt;
    try {
      if (await inGeneralFolder(folder.driveFolderId!, rootId)) {
        if (
          folder.deletedAt !== null &&
          (await listChildren(folder.driveFolderId!)).length > 0
        ) {
          await documentFoldersRepo.markRestored(folder.id, folder.updatedAt);
          continue;
        }
        modifiedTime = await updateFile(
          folder.driveFolderId!,
          folder.deletedAt !== null ? { trashed: true } : { name: folder.name },
        );
      }
    } catch (error: unknown) {
      if (!givesUpOn(error)) continue;
    }
    await documentFoldersRepo.markSynced(
      folder.id,
      { driveModifiedAt: modifiedTime },
      folder.updatedAt,
    );
  }
};

/**
 * Renamed, moved, linked or deleted in the app. A change the Drive refuses
 * for good is marked sent, like a folder's above: the walk then shows the
 * file as the Drive has it, or drops it if it is gone.
 */
const pushDocumentChanges = async (rootId: string): Promise<void> => {
  for (const doc of await documentsRepo.listPendingChanges()) {
    await assertStillGeneral(rootId);
    let modifiedTime = doc.driveModifiedAt;
    try {
      const change = await changeToSend(doc, rootId);
      if (change) modifiedTime = await updateFile(doc.driveFileId!, change);
    } catch (error: unknown) {
      if (!givesUpOn(error)) continue;
    }
    await documentsRepo.markSynced(doc.id, modifiedTime, doc.updatedAt);
  }
};

/**
 * What to send the Drive for a document changed in the app: only the fields
 * the app changed (`driveChanges`), so whatever she did in the Drive
 * meanwhile to the others stands. `null` when there is nothing to send — or
 * nothing the app may send: a file she moved out of the general folder in the
 * Drive, itself or with a folder above it, is no longer the app's to write
 * to, and the walk lets it go.
 *
 * A move reads the file's parents first: the Drive moves a file by adding the
 * new folder and removing the old. Only a folder of the general one is ever
 * removed — a file also filed elsewhere in her Drive stays filed there — and
 * nothing is moved into a folder she has put in the trash, or moved out of
 * the general folder, since the last walk (`canFileIn`).
 */
const changeToSend = async (
  doc: StoredDocument,
  rootId: string,
): Promise<Parameters<typeof updateFile>[1] | null> => {
  const parents = await parentsOf(doc.driveFileId!);
  const inGeneral: string[] = [];
  for (const parent of parents) {
    if (await inGeneralFolder(parent, rootId)) inGeneral.push(parent);
  }
  if (inGeneral.length === 0) return null;
  if (doc.deletedAt !== null) return { trashed: true };

  const sends = (field: DocumentDriveChange): boolean =>
    doc.driveChanges?.includes(field) ?? true;
  const change: Parameters<typeof updateFile>[1] = {};
  if (sends("name")) change.name = doc.name;
  if (sends("postId")) change.appProperties = { ladyPostId: doc.postId };
  if (sends("folderId")) {
    const target = await mirroredDriveId(doc.folderId, rootId);
    if (
      target !== undefined &&
      !parents.includes(target) &&
      (await canFileIn(target, rootId))
    ) {
      change.move = { from: inGeneral, to: target };
    }
  }
  return Object.keys(change).length > 0 ? change : null;
};

/**
 * Files joined in the app, oldest first. One whose bytes are gone from the
 * device — a backup restored on a new phone carries none — cannot be sent: it
 * takes up the copy an earlier sync left in the Drive (`alreadySent`), and is
 * skipped when there is none. So is one held back for another general folder
 * or kept on this phone (`sendsTo`). One the Drive refuses stays on the
 * device: tried again next time when the refusal may pass, not until it
 * changes or she retries when it will not (`uploadRefused`). One whose folder
 * is gone from the Drive, or in its trash, goes to the general folder
 * instead.
 *
 * Bytes that do not get through — the connection too weak for them, or gone
 * as they went — end the uploads, not the run: the requests that follow are
 * small, and a photo that cannot be sent from where she stands must not keep
 * the app from reading the Drive. Truly offline, the next request stops the
 * run. The file may have reached the Drive all the same, its answer lost: the
 * walk leaves it for the next sync to take up (`planMirror`).
 */
const uploadPending = async (rootId: string): Promise<void> => {
  const folders = new Map(
    (await documentFoldersRepo.listAll()).map((folder) => [folder.id, folder]),
  );
  for (const doc of await documentsRepo.listPendingUpload()) {
    if (!sendsTo(doc, folders, rootId)) continue;
    if (doc.uploadRefused === doc.updatedAt) continue;
    const blob = await documentsRepo.getBlob(doc.id);
    await assertStillGeneral(rootId);
    let row = doc;
    let uploaded: { id: string; modifiedTime: string } | undefined;
    let sendingBytes = false;
    try {
      uploaded = await alreadySent("ladyDocId", doc.id);
      if (!uploaded) {
        if (!blob) continue;
        let parent = (await mirroredDriveId(doc.folderId, rootId)) ?? rootId;
        if (!(await canFileIn(parent, rootId))) {
          row = (await documentsRepo.update(doc.id, { folderId: null })) ?? row;
          parent = rootId;
        }
        sendingBytes = true;
        uploaded = await uploadFile(row.name, blob, parent, {
          ladyDocId: row.id,
          ...(row.postId ? { ladyPostId: row.postId } : {}),
        });
      }
    } catch (error: unknown) {
      if (
        sendingBytes &&
        error instanceof DriveRequestError &&
        error.status === 0
      ) {
        console.warn("[drive] Envoi interrompu, repris plus tard :", error);
        return;
      }
      if (stopsTheRun(error)) throw error;
      if (refusesUpload(error)) {
        console.warn("[drive] Envoi refusé par le Drive :", error);
        await documentsRepo.markRefused(doc.id, row.updatedAt);
      } else {
        console.warn("[drive] Envoi refusé, réessayé plus tard :", error);
      }
      continue;
    }
    await documentsRepo.markUploaded(
      doc.id,
      { driveFileId: uploaded.id, driveModifiedAt: uploaded.modifiedTime },
      row.updatedAt,
    );
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

  const blob = await downloadFile(doc.driveFileId, doc.mimeType, doc.size);
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
