import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db.ts";
import {
  HORSE_ID,
  makeDocument,
  makeDocumentFolder,
  makeHorse,
  resetDb,
} from "./__tests__/factories.ts";
import {
  planMirror,
  type MirrorInput,
  type RemoteFile,
  type RemoteFolder,
} from "./drive-mirror.ts";
import { mirrorDrive } from "./services/driveMirror.service.ts";

const ROOT = "drive-root";
const T1 = "2026-09-01T10:00:00.000Z";
const T2 = "2026-09-20T10:00:00.000Z";

const remoteFolder = (over: Partial<RemoteFolder> = {}): RemoteFolder => ({
  driveId: "d-osteo",
  name: "Ostéopathe",
  parentDriveId: ROOT,
  modifiedTime: T1,
  ...over,
});

const remoteFile = (over: Partial<RemoteFile> = {}): RemoteFile => ({
  driveId: "d-facture",
  name: "Facture 04/08/2026.pdf",
  mimeType: "application/pdf",
  size: 64_700,
  parentDriveId: "d-osteo",
  modifiedTime: T1,
  ...over,
});

const input = (over: Partial<MirrorInput> = {}): MirrorInput => ({
  rootDriveId: ROOT,
  folders: [],
  files: [],
  localFolders: [],
  localDocuments: [],
  horseId: HORSE_ID,
  ...over,
});

beforeEach(resetDb);

describe("planMirror", () => {
  it("adds what the Drive holds, filed in the right folders", () => {
    const plan = planMirror(
      input({
        folders: [
          remoteFolder(),
          remoteFolder({
            driveId: "d-2025",
            name: "2025",
            parentDriveId: "d-osteo",
          }),
        ],
        files: [
          remoteFile(),
          remoteFile({
            driveId: "d-loose",
            name: "carnet.jpg",
            parentDriveId: ROOT,
          }),
        ],
      }),
    );

    const osteo = plan.folders.find(
      (folder) => folder.driveFolderId === "d-osteo",
    )!;
    const year = plan.folders.find(
      (folder) => folder.driveFolderId === "d-2025",
    )!;
    expect(osteo.parentId).toBe(null);
    expect(year.parentId).toBe(osteo.id);

    const facture = plan.documents.find(
      (doc) => doc.driveFileId === "d-facture",
    )!;
    expect(facture).toMatchObject({
      folderId: osteo.id,
      horseId: HORSE_ID,
      postId: null,
      size: 64_700,
      driveModifiedAt: T1,
    });
    expect(facture.driveSyncedAt).toBe(facture.updatedAt);
    expect(
      plan.documents.find((doc) => doc.driveFileId === "d-loose")!.folderId,
    ).toBe(null);
  });

  it("resolves a folder listed before its parent", () => {
    const plan = planMirror(
      input({
        folders: [
          remoteFolder({
            driveId: "d-child",
            name: "2025",
            parentDriveId: "d-osteo",
          }),
          remoteFolder(),
        ],
      }),
    );

    const parent = plan.folders.find(
      (folder) => folder.driveFolderId === "d-osteo",
    )!;
    expect(
      plan.folders.find((folder) => folder.driveFolderId === "d-child")!
        .parentId,
    ).toBe(parent.id);
  });

  it("writes nothing when the Drive has not changed", () => {
    const folder = makeDocumentFolder({
      id: "osteo",
      name: "Ostéopathe",
      driveFolderId: "d-osteo",
      driveModifiedAt: T1,
    });
    const document = makeDocument({
      name: "Facture 04/08/2026.pdf",
      folderId: "osteo",
      size: 64_700,
      driveFileId: "d-facture",
      driveModifiedAt: T1,
    });

    const plan = planMirror(
      input({
        folders: [remoteFolder()],
        files: [remoteFile()],
        localFolders: [folder],
        localDocuments: [document],
      }),
    );

    expect(plan).toEqual({ folders: [], documents: [], staleBlobs: [] });
  });

  it("follows a rename and a move, keeps the post link, and drops outdated bytes", () => {
    const document = makeDocument({
      postId: "post-1",
      folderId: null,
      driveFileId: "d-facture",
      driveModifiedAt: T1,
    });

    const plan = planMirror(
      input({
        folders: [remoteFolder()],
        localFolders: [
          makeDocumentFolder({
            id: "osteo",
            driveFolderId: "d-osteo",
            name: "Ostéopathe",
            driveModifiedAt: T1,
          }),
        ],
        files: [remoteFile({ name: "Renommée.pdf", modifiedTime: T2 })],
        localDocuments: [document],
      }),
    );

    expect(plan.documents).toHaveLength(1);
    expect(plan.documents[0]).toMatchObject({
      id: document.id,
      name: "Renommée.pdf",
      folderId: "osteo",
      postId: "post-1",
      driveModifiedAt: T2,
    });
    expect(plan.staleBlobs).toEqual([document.id]);
  });

  it("deletes what left the Drive, but not a row still waiting to be uploaded", () => {
    const gone = makeDocument({ id: "gone", driveFileId: "d-gone" });
    const pending = makeDocument({ id: "pending", driveFileId: null });
    const goneFolder = makeDocumentFolder({
      id: "old",
      driveFolderId: "d-old",
    });

    const plan = planMirror(
      input({ localDocuments: [gone, pending], localFolders: [goneFolder] }),
    );

    expect(
      plan.documents.map((doc) => [doc.id, doc.deletedAt !== null]),
    ).toEqual([["gone", true]]);
    expect(
      plan.folders.map((folder) => [folder.id, folder.deletedAt !== null]),
    ).toEqual([["old", true]]);
    expect(plan.staleBlobs).toEqual(["gone"]);
    // Only what the Drive already says: nothing for the next push to send.
    for (const row of [...plan.documents, ...plan.folders]) {
      expect(row.driveSyncedAt).toBe(row.updatedAt);
    }
  });

  it("brings a file back from the trash onto its old row, post link included", () => {
    const trashed = makeDocument({
      id: "back",
      postId: "post-1",
      driveFileId: "d-facture",
      driveModifiedAt: T1,
      deletedAt: T2,
    });

    const plan = planMirror(
      input({
        files: [remoteFile({ parentDriveId: ROOT })],
        localDocuments: [trashed],
      }),
    );

    expect(plan.documents[0]).toMatchObject({
      id: "back",
      postId: "post-1",
      deletedAt: null,
    });
  });
});

describe("mirrorDrive", () => {
  beforeEach(async () => {
    await db.horses.add(makeHorse());
  });

  it("writes the plan in one go, and reports nothing to do the second time", async () => {
    const tree = {
      rootDriveId: ROOT,
      folders: [remoteFolder()],
      files: [remoteFile()],
    };

    expect(await mirrorDrive(tree)).toBe(2);
    expect(await mirrorDrive(tree)).toBe(0);

    const [folder] = await db.documentFolders.toArray();
    const [document] = await db.documents.toArray();
    expect(document!.folderId).toBe(folder!.id);
  });

  it("drops cached bytes the Drive has replaced", async () => {
    await mirrorDrive({
      rootDriveId: ROOT,
      folders: [],
      files: [remoteFile({ parentDriveId: ROOT })],
    });
    const [document] = await db.documents.toArray();
    await db.documentBlobs.put({
      documentId: document!.id,
      blob: new Blob(["old"]),
    });

    await mirrorDrive({
      rootDriveId: ROOT,
      folders: [],
      files: [remoteFile({ parentDriveId: ROOT, modifiedTime: T2 })],
    });

    expect(await db.documentBlobs.count()).toBe(0);
  });
});

describe("planMirror — changes made in the app, not sent yet", () => {
  const STAMP = "2026-09-10T10:00:00.000Z";
  const LATER = "2026-09-11T10:00:00.000Z";

  it("keeps a local rename and a local delete over what the Drive still says", () => {
    const renamed = makeDocument({
      id: "renamed",
      name: "Nouveau nom.pdf",
      folderId: null,
      driveFileId: "d-facture",
      driveModifiedAt: T1,
      driveSyncedAt: STAMP,
      updatedAt: LATER,
    });
    const deleted = makeDocument({
      id: "deleted",
      driveFileId: "d-deleted",
      driveModifiedAt: T1,
      driveSyncedAt: STAMP,
      updatedAt: LATER,
      deletedAt: LATER,
    });

    const plan = planMirror(
      input({
        files: [
          remoteFile({ parentDriveId: ROOT }),
          remoteFile({ driveId: "d-deleted", parentDriveId: ROOT }),
        ],
        localDocuments: [renamed, deleted],
      }),
    );

    expect(plan).toEqual({ folders: [], documents: [], staleBlobs: [] });
  });

  it("does not delete a folder renamed in the app that the walk missed", () => {
    const folder = makeDocumentFolder({
      driveFolderId: "d-osteo",
      driveSyncedAt: STAMP,
      updatedAt: LATER,
    });

    expect(planMirror(input({ localFolders: [folder] })).folders).toEqual([]);
  });
});
