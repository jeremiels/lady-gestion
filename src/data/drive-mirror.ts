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
 * document belongs to, and rows not uploaded yet.
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
  const localFolderByDrive = new Map(
    input.localFolders
      .filter((folder) => folder.driveFolderId !== null)
      .map((folder) => [folder.driveFolderId!, folder]),
  );
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
  for (const folder of input.localFolders) {
    // A folder not in the Drive yet (`driveFolderId: null`) is the app's to
    // upload, not the Drive's to delete.
    if (
      folder.deletedAt === null &&
      folder.driveFolderId !== null &&
      !remoteFolderIds.has(folder.driveFolderId)
    ) {
      plan.folders.push(softDelete(folder));
    }
  }

  const localDocumentByDrive = new Map(
    input.localDocuments
      .filter((document) => document.driveFileId !== null)
      .map((document) => [document.driveFileId!, document]),
  );
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
            postId: null,
            issuedAt: null,
            driveFileId: remote.driveId,
            driveSyncedAt: null,
          }),
        ),
      );
      continue;
    }
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
  for (const document of input.localDocuments) {
    if (
      document.deletedAt === null &&
      document.driveFileId !== null &&
      !remoteFileIds.has(document.driveFileId)
    ) {
      plan.documents.push(softDelete(document));
      plan.staleBlobs.push(document.id);
    }
  }

  return plan;
};

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
