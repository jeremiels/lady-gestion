import { liveQuery } from "./db.ts";
import { dataReady } from "./ready.ts";
import { createRecord, softDelete, touch } from "./record.ts";
import * as metaRepo from "./repositories/meta.repo.ts";
import type { DocumentFolder, DriveMeta, StoredDocument } from "./types.ts";

/**
 * How the user's Drive folder becomes rows on this device
 * (`docs/drive-spec.md` §6.5).
 *
 * The Drive is the reference for documents: what she adds, renames, moves or
 * trashes there — from the Google Drive app as much as from this one — is what
 * the mirror shows. The mirror keeps what the Drive cannot hold: which post a
 * document belongs to, rows not uploaded yet, and changes made in the app and
 * not sent yet (`pending`).
 *
 * Pure but for the ids and timestamps `record.ts` stamps: the caller reads the
 * local rows and writes the plan back, in one transaction.
 */

/** A folder under the general one, as Drive lists it. */
export type RemoteFolder = {
  driveId: string;
  name: string;
  /** The Drive id of the folder it sits in — the general folder's for the top level. */
  parentDriveId: string;
  modifiedTime: string;
};

/** A file under the general folder, as Drive lists it. */
export type RemoteFile = {
  driveId: string;
  name: string;
  mimeType: string;
  /** Bytes; Google Docs and Sheets have none until exported. */
  size: number;
  parentDriveId: string;
  modifiedTime: string;
  /**
   * The post its `appProperties.ladyPostId` names: the link, as the Drive
   * keeps it for a device that has not seen the file yet (spec §7.3).
   */
  postId: string | null;
};

export type MirrorInput = {
  /** The general folder's Drive id: its direct children have no local parent. */
  rootDriveId: string;
  folders: RemoteFolder[];
  files: RemoteFile[];
  /** Every local row, tombstones included — a file back from the trash revives its row. */
  localFolders: DocumentFolder[];
  localDocuments: StoredDocument[];
  /** Given to documents first seen in the Drive: the app has one horse. */
  horseId: string;
  /** The live posts: a file's Drive link counts only to one of them. */
  postIds: ReadonlySet<string>;
};

export type MirrorPlan = {
  /** Rows to write, new or changed; rows already matching the Drive are left out. */
  folders: DocumentFolder[];
  documents: StoredDocument[];
  /** Document ids whose cached bytes no longer match the Drive's. */
  staleBlobs: string[];
};

export const planMirror = (input: MirrorInput): MirrorPlan => {
  const plan: MirrorPlan = { folders: [], documents: [], staleBlobs: [] };

  // Folders first: every remote folder gets its local id before any parent
  // or document is resolved, so the order Drive lists them in does not matter.
  const folderRows = oneRowPer(
    input.localFolders,
    (folder) => folder.driveFolderId,
    liveThenOldest,
  );
  const localFolderByDrive = folderRows.kept;
  for (const folder of folderRows.dropped) {
    if (folder.deletedAt === null) {
      plan.folders.push(synced(softDelete(folder)));
    }
  }
  const created = new Map<string, DocumentFolder>();
  for (const remote of input.folders) {
    if (!localFolderByDrive.has(remote.driveId)) {
      created.set(
        remote.driveId,
        createRecord<DocumentFolder>({
          name: remote.name,
          parentId: null,
          driveFolderId: remote.driveId,
          driveModifiedAt: remote.modifiedTime,
          driveSyncedAt: null,
        }),
      );
    }
  }
  const localIdOf = (driveId: string): string | null =>
    driveId === input.rootDriveId
      ? null
      : (localFolderByDrive.get(driveId)?.id ??
        created.get(driveId)?.id ??
        null);

  const remoteFolderIds = new Set(
    input.folders.map((folder) => folder.driveId),
  );
  for (const remote of input.folders) {
    const wanted = {
      name: remote.name,
      parentId: localIdOf(remote.parentDriveId),
      driveModifiedAt: remote.modifiedTime,
    };
    const fresh = created.get(remote.driveId);
    if (fresh) {
      plan.folders.push(synced({ ...fresh, ...wanted }));
      continue;
    }
    const existing = localFolderByDrive.get(remote.driveId)!;
    if (pending(existing)) continue;
    if (
      existing.deletedAt !== null ||
      existing.name !== wanted.name ||
      existing.parentId !== wanted.parentId ||
      existing.driveModifiedAt !== wanted.driveModifiedAt
    ) {
      // `deletedAt` cleared too: a folder back from the trash comes back.
      plan.folders.push(
        synced({ ...touch(existing, wanted), deletedAt: null }),
      );
    }
  }
  // Only rows with a Drive id, one per id: a folder not in the Drive yet is
  // the app's to upload, not the Drive's to delete.
  for (const [driveId, folder] of localFolderByDrive) {
    if (
      folder.deletedAt === null &&
      !pending(folder) &&
      !remoteFolderIds.has(driveId)
    ) {
      // Stamped as synced: this only records what the Drive already says. Left
      // pending, the next push would read it as deleted in the app and send
      // the folder to the Drive's trash — a folder merely outside the general
      // one, after a change of general folder, or moved away in the Drive.
      plan.folders.push(synced(softDelete(folder)));
    }
  }

  const documentRows = oneRowPer(
    input.localDocuments,
    (document) => document.driveFileId,
    // As for folders, but one linked to a post before one that is not: the
    // link is the one thing the Drive cannot give back.
    (a, b) =>
      Number(a.deletedAt !== null) - Number(b.deletedAt !== null) ||
      Number(a.postId === null) - Number(b.postId === null) ||
      a.createdAt.localeCompare(b.createdAt),
  );
  const localDocumentByDrive = documentRows.kept;
  for (const document of documentRows.dropped) {
    if (document.deletedAt === null) {
      plan.documents.push(synced(softDelete(document)));
      plan.staleBlobs.push(document.id);
    }
  }
  const remoteFileIds = new Set(input.files.map((file) => file.driveId));
  for (const remote of input.files) {
    const wanted = {
      name: remote.name,
      mimeType: remote.mimeType,
      size: remote.size,
      folderId: localIdOf(remote.parentDriveId),
      driveModifiedAt: remote.modifiedTime,
    };
    const existing = localDocumentByDrive.get(remote.driveId);
    if (!existing) {
      plan.documents.push(
        synced(
          createRecord<StoredDocument>({
            ...wanted,
            horseId: input.horseId,
            postId:
              remote.postId !== null && input.postIds.has(remote.postId)
                ? remote.postId
                : null,
            issuedAt: null,
            driveFileId: remote.driveId,
            driveSyncedAt: null,
          }),
        ),
      );
      continue;
    }
    if (pending(existing)) continue;
    if (existing.driveModifiedAt !== remote.modifiedTime) {
      plan.staleBlobs.push(existing.id);
    }
    if (
      existing.deletedAt !== null ||
      existing.name !== wanted.name ||
      existing.mimeType !== wanted.mimeType ||
      existing.size !== wanted.size ||
      existing.folderId !== wanted.folderId ||
      existing.driveModifiedAt !== wanted.driveModifiedAt
    ) {
      // `postId` is not in `wanted`: the link to a post is the one thing the
      // Drive does not know, so it rides through every sync untouched.
      plan.documents.push(
        synced({ ...touch(existing, wanted), deletedAt: null }),
      );
    }
  }
  for (const [driveId, document] of localDocumentByDrive) {
    if (
      document.deletedAt === null &&
      !pending(document) &&
      !remoteFileIds.has(driveId)
    ) {
      // Synced, like a folder above: gone from the Drive, not deleted here.
      plan.documents.push(synced(softDelete(document)));
      plan.staleBlobs.push(document.id);
    }
  }

  return plan;
};

/**
 * One row per Drive id, keyed by it, and the rows beyond that.
 *
 * Two live rows share one when a backup is restored after a sync already
 * mirrored the same files under new ids: the file's rows and the sync's.
 * Left in place, both would show, and the walk would only ever keep one of
 * them up to date. The first by `order` is kept; the others are for the
 * caller to let go of, on this device only.
 */
const oneRowPer = <T extends DocumentFolder | StoredDocument>(
  rows: T[],
  driveIdOf: (row: T) => string | null,
  order: (a: T, b: T) => number,
): { kept: Map<string, T>; dropped: T[] } => {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const driveId = driveIdOf(row);
    if (driveId !== null) {
      groups.set(driveId, [...(groups.get(driveId) ?? []), row]);
    }
  }
  const kept = new Map<string, T>();
  const dropped: T[] = [];
  for (const [driveId, group] of groups) {
    const [first, ...rest] = group.sort(order);
    kept.set(driveId, first!);
    dropped.push(...rest);
  }
  return { kept, dropped };
};

/** A live row before a deleted one, then the oldest: a restored backup's. */
const liveThenOldest = (
  a: DocumentFolder | StoredDocument,
  b: DocumentFolder | StoredDocument,
): number =>
  Number(a.deletedAt !== null) - Number(b.deletedAt !== null) ||
  a.createdAt.localeCompare(b.createdAt);

/**
 * What the mirror keeps when she picks another general folder. The previous
 * folder's rows have no reason to be here any more: soft-deleted on this
 * device only and stamped synced — a change made there and not sent yet
 * included — so no sync writes to a folder the app no longer shows (§6.6).
 * The Drive keeps all of it; picking that folder again brings the rows back,
 * post links included.
 *
 * What is not in the Drive yet stays, moved to the top level when its folder
 * goes: this device holds its only copy, and the next sync sends it into the
 * new folder.
 */
export const planFolderChange = (
  localFolders: DocumentFolder[],
  localDocuments: StoredDocument[],
): MirrorPlan => {
  const plan: MirrorPlan = { folders: [], documents: [], staleBlobs: [] };
  const gone = new Set(
    localFolders
      .filter((folder) => folder.driveFolderId !== null)
      .map((folder) => folder.id),
  );
  const letGo = <T extends DocumentFolder | StoredDocument>(row: T): T[] =>
    row.deletedAt === null
      ? [synced(softDelete(row))]
      : pending(row)
        ? [synced(row)]
        : [];

  for (const folder of localFolders) {
    if (folder.driveFolderId !== null) {
      plan.folders.push(...letGo(folder));
    } else if (
      folder.deletedAt === null &&
      folder.parentId !== null &&
      gone.has(folder.parentId)
    ) {
      plan.folders.push(touch(folder, { parentId: null }));
    }
  }
  for (const document of localDocuments) {
    if (document.driveFileId !== null) {
      plan.documents.push(...letGo(document));
      if (document.deletedAt === null) plan.staleBlobs.push(document.id);
    } else if (
      document.deletedAt === null &&
      document.folderId !== null &&
      gone.has(document.folderId)
    ) {
      plan.documents.push(touch(document, { folderId: null }));
    }
  }
  return plan;
};

/**
 * Changed in the app since its last sync — renamed, moved, linked, deleted —
 * and not sent yet. The Drive does not know yet, so what it says about the
 * row is out of date: the walk leaves it for the next push to settle.
 */
export const pending = (row: DocumentFolder | StoredDocument): boolean =>
  row.driveSyncedAt !== null && row.updatedAt > row.driveSyncedAt;

/** Stamped as in step with the Drive as of its own write. */
const synced = <T extends DocumentFolder | StoredDocument>(row: T): T => ({
  ...row,
  driveSyncedAt: row.updatedAt,
});

/** What a sync needs to run: someone signed in, and a folder to read. */
export type DriveSetup = {
  account: DriveMeta["googleAccount"] | undefined;
  folder: DriveMeta["driveFolder"] | undefined;
};

/**
 * Calls `next` with the Drive sign-in and folder now and on every change —
 * the moments a sync has something new to do. Outside Lit, like
 * `watchReminders`.
 */
export const watchDriveSetup = (next: (setup: DriveSetup) => void): void => {
  void dataReady().then(() => {
    liveQuery(async () => ({
      account: await metaRepo.get<DriveMeta["googleAccount"]>("googleAccount"),
      folder: await metaRepo.get<DriveMeta["driveFolder"]>("driveFolder"),
    })).subscribe({
      next,
      error: (error: unknown) => {
        console.warn("[drive] Lecture de la connexion impossible :", error);
      },
    });
  });
};
