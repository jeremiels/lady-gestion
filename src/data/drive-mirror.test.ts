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
  destinationOf,
  planFolderChange,
  planMirror,
  type MirrorInput,
  type RemoteFile,
  type RemoteFolder,
} from "./drive-mirror.ts";
import {
  chooseFolder,
  countHeldBack,
  forgetFolder,
  mirrorDrive,
  settleHeldBack,
} from "./services/driveMirror.service.ts";

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
  postId: null,
  docId: null,
  ...over,
});

const input = (over: Partial<MirrorInput> = {}): MirrorInput => ({
  rootDriveId: ROOT,
  folders: [],
  files: [],
  localFolders: [],
  localDocuments: [],
  horseId: HORSE_ID,
  postIds: new Set(),
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

describe("planMirror — a new device", () => {
  it("links a file first seen here to the post its Drive tag names, if that post is here", () => {
    const plan = planMirror(
      input({
        files: [
          remoteFile({
            driveId: "d-lie",
            parentDriveId: ROOT,
            postId: "post-1",
          }),
          remoteFile({
            driveId: "d-perdu",
            parentDriveId: ROOT,
            postId: "post-x",
          }),
        ],
        postIds: new Set(["post-1"]),
      }),
    );

    expect(plan.documents.map((doc) => [doc.driveFileId, doc.postId])).toEqual([
      ["d-lie", "post-1"],
      ["d-perdu", null],
    ]);
  });

  it("keeps the local link over the Drive's tag on a row it already has", () => {
    const plan = planMirror(
      input({
        files: [
          remoteFile({
            parentDriveId: ROOT,
            postId: "post-2",
            modifiedTime: T2,
          }),
        ],
        localDocuments: [
          makeDocument({
            postId: "post-1",
            driveFileId: "d-facture",
            driveModifiedAt: T1,
          }),
        ],
        postIds: new Set(["post-1", "post-2"]),
      }),
    );

    expect(plan.documents[0]!.postId).toBe("post-1");
  });

  it("keeps one row per Drive id when a backup brings back rows a sync already made", () => {
    // The backup's rows: older, and the file linked to a post.
    const backupFolder = makeDocumentFolder({
      id: "backup-osteo",
      name: "Ostéopathe",
      driveFolderId: "d-osteo",
      driveModifiedAt: T1,
      createdAt: T1,
    });
    const backupFile = makeDocument({
      id: "backup-facture",
      name: "Facture 04/08/2026.pdf",
      size: 64_700,
      postId: "post-1",
      folderId: "backup-osteo",
      driveFileId: "d-facture",
      driveModifiedAt: T1,
      createdAt: T1,
    });
    // The first sync's rows on the new phone, made before the restore.
    const syncFolder = { ...backupFolder, id: "sync-osteo", createdAt: T2 };
    const syncFile = {
      ...backupFile,
      id: "sync-facture",
      postId: null,
      folderId: "sync-osteo",
      createdAt: T2,
    };

    const plan = planMirror(
      input({
        folders: [remoteFolder()],
        files: [remoteFile()],
        localFolders: [syncFolder, backupFolder],
        localDocuments: [syncFile, backupFile],
      }),
    );

    expect(plan.folders.map((row) => [row.id, row.deletedAt !== null])).toEqual(
      [["sync-osteo", true]],
    );
    expect(
      plan.documents.map((row) => [row.id, row.deletedAt !== null]),
    ).toEqual([["sync-facture", true]]);
    expect(plan.staleBlobs).toEqual(["sync-facture"]);
  });
});

describe("mirrorDrive", () => {
  beforeEach(async () => {
    await db.horses.add(makeHorse());
    await db.meta.put({
      key: "driveFolder",
      value: { id: ROOT, name: "Lady" },
    });
  });

  it("writes nothing from a walk of a folder no longer the general one", async () => {
    await db.meta.put({
      key: "driveFolder",
      value: { id: "d-other", name: "Autre" },
    });

    expect(
      await mirrorDrive({
        rootDriveId: ROOT,
        folders: [remoteFolder()],
        files: [remoteFile()],
      }),
    ).toBe(0);
    expect(await db.documents.count()).toBe(0);
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

describe("planMirror — what is not in the Drive yet", () => {
  it("moves it to the top level when its folder is gone from the Drive", () => {
    const leaving = makeDocumentFolder({
      id: "leaving",
      driveFolderId: "d-old",
      driveSyncedAt: T1,
    });
    // Let go of by an earlier walk: a row left in it is brought out too.
    const left = makeDocumentFolder({
      id: "left",
      driveFolderId: "d-older",
      driveSyncedAt: T1,
      deletedAt: T1,
    });
    const staying = makeDocumentFolder({
      id: "staying",
      driveFolderId: "d-osteo",
      driveModifiedAt: T1,
      driveSyncedAt: T1,
    });
    const made = makeDocumentFolder({ id: "made", parentId: "leaving" });
    const kept = makeDocument({
      id: "kept",
      folderId: "leaving",
      driveRootId: null,
    });
    const stranded = makeDocument({ id: "stranded", folderId: "left" });
    const inMade = makeDocument({ id: "in-made", folderId: "made" });
    const inStaying = makeDocument({ id: "in-staying", folderId: "staying" });

    const plan = planMirror(
      input({
        folders: [remoteFolder({ driveId: "d-osteo", name: "Factures" })],
        localFolders: [leaving, left, staying, made],
        localDocuments: [kept, stranded, inMade, inStaying],
      }),
    );

    expect(
      plan.folders.map((row) => [row.id, row.parentId, row.deletedAt !== null]),
    ).toEqual([
      ["leaving", null, true],
      ["made", null, false],
    ]);
    expect(plan.documents.map((row) => [row.id, row.folderId])).toEqual([
      ["kept", null],
      ["stranded", null],
    ]);
    // Still this device's alone: nothing here says the Drive has them.
    for (const row of plan.documents) {
      expect(row).toMatchObject({ driveFileId: null, driveSyncedAt: null });
    }
    expect(plan.documents[0]!.driveRootId).toBeNull();
    expect(plan.staleBlobs).toEqual([]);
  });

  it("adds no second row for a file sent for a row that never had the answer", () => {
    const sent = makeDocument({ id: "sent", folderId: null });
    const file = remoteFile({
      driveId: "d-sent",
      parentDriveId: ROOT,
      docId: "sent",
    });

    expect(
      planMirror(input({ files: [file], localDocuments: [sent] })),
    ).toEqual({ folders: [], documents: [], staleBlobs: [] });

    // Once the row has taken the file up, it follows the Drive like any other.
    const plan = planMirror(
      input({
        files: [{ ...file, name: "Renommé.pdf" }],
        localDocuments: [
          { ...sent, driveFileId: "d-sent", driveSyncedAt: sent.updatedAt },
        ],
      }),
    );
    expect(plan.documents.map((row) => [row.id, row.name])).toEqual([
      ["sent", "Renommé.pdf"],
    ]);
  });
});

describe("planFolderChange", () => {
  const STAMP = "2026-09-10T10:00:00.000Z";
  const LATER = "2026-09-11T10:00:00.000Z";

  it("lets go of the previous folder here only, a change not sent yet included", () => {
    const plan = planFolderChange(
      [makeDocumentFolder({ id: "osteo", driveFolderId: "d-osteo" })],
      [
        makeDocument({
          id: "renamed",
          driveFileId: "d-facture",
          driveModifiedAt: T1,
          driveSyncedAt: STAMP,
          updatedAt: LATER,
        }),
        makeDocument({
          id: "deleted",
          driveFileId: "d-deleted",
          driveModifiedAt: T1,
          driveSyncedAt: STAMP,
          updatedAt: LATER,
          deletedAt: LATER,
        }),
      ],
      ROOT,
    );

    for (const row of [...plan.folders, ...plan.documents]) {
      expect(row.deletedAt).not.toBeNull();
      expect(row.driveSyncedAt).toBe(row.updatedAt);
    }
    expect(plan.folders.map(({ id }) => id)).toEqual(["osteo"]);
    expect(plan.documents.map(({ id }) => id)).toEqual(["renamed", "deleted"]);
    expect(plan.staleBlobs).toEqual(["renamed"]);
  });

  it("keeps what is not in the Drive yet, moved to the top level and held for the previous folder", () => {
    const plan = planFolderChange(
      [
        makeDocumentFolder({ id: "osteo", driveFolderId: "d-osteo" }),
        makeDocumentFolder({ id: "new", parentId: "osteo" }),
      ],
      [
        makeDocument({ id: "joined", folderId: "osteo" }),
        makeDocument({ id: "kept", driveRootId: null }),
      ],
      ROOT,
    );

    const kept = [...plan.folders, ...plan.documents].filter(
      (row) => row.deletedAt === null,
    );
    expect(kept.map(({ id }) => id)).toEqual(["new", "joined"]);
    expect(kept.map(({ driveRootId }) => driveRootId)).toEqual([ROOT, ROOT]);
    expect(plan.folders.find(({ id }) => id === "new")!.parentId).toBeNull();
    expect(plan.documents[0]!.folderId).toBeNull();
    expect(plan.staleBlobs).toEqual([]);
  });

  it("holds nothing back when there was no previous folder, nor one already held", () => {
    const plan = planFolderChange(
      [],
      [makeDocument({ id: "held", driveRootId: "d-older" })],
      undefined,
    );
    expect(plan.documents).toEqual([]);

    const again = planFolderChange(
      [],
      [makeDocument({ id: "held", driveRootId: "d-older" })],
      ROOT,
    );
    expect(again.documents).toEqual([]);
  });

  it("writes nothing for a row already let go of", () => {
    const plan = planFolderChange(
      [],
      [
        makeDocument({
          driveFileId: "d-gone",
          driveSyncedAt: STAMP,
          updatedAt: STAMP,
          deletedAt: STAMP,
        }),
      ],
      ROOT,
    );

    expect(plan.documents).toEqual([]);
  });
});

describe("chooseFolder", () => {
  it("lets go of the mirror only when the folder is another one", async () => {
    await db.documents.add(
      makeDocument({ driveFileId: "d-facture", driveSyncedAt: T1 }),
    );

    await db.meta.put({
      key: "driveFolder",
      value: { id: "d-root", name: "Lady" },
    });

    // What stood in the way of this folder's sync says nothing of another's.
    await db.meta.put({ key: "driveSyncProblem", value: "trashed" });

    await chooseFolder({ id: "d-root", name: "Lady" });
    expect((await db.documents.toArray())[0]!.deletedAt).toBeNull();
    expect(await db.meta.get("driveSyncProblem")).toBeDefined();

    await chooseFolder({ id: "d-other", name: "Autre" });
    expect((await db.documents.toArray())[0]!.deletedAt).not.toBeNull();
    expect(await db.meta.get("driveSyncProblem")).toBeUndefined();
    expect((await db.meta.get("driveFolder"))!.value).toEqual({
      id: "d-other",
      name: "Autre",
    });
  });
});

describe("forgetFolder", () => {
  it("forgets the general folder and lets go of its rows, unless another was picked meanwhile", async () => {
    await db.documents.add(
      makeDocument({ driveFileId: "d-facture", driveSyncedAt: T1 }),
    );
    await db.meta.put({
      key: "driveFolder",
      value: { id: "d-new", name: "Neuf" },
    });

    await forgetFolder("d-old");
    expect(await db.meta.get("driveFolder")).toBeDefined();
    expect((await db.documents.toArray())[0]!.deletedAt).toBeNull();

    await forgetFolder("d-new");
    expect(await db.meta.get("driveFolder")).toBeUndefined();
    expect((await db.documents.toArray())[0]!.deletedAt).not.toBeNull();
  });
});

describe("destinationOf", () => {
  const folders = (...rows: ReturnType<typeof makeDocumentFolder>[]) =>
    new Map(rows.map((row) => [row.id, row]));

  it("follows a folder not in the Drive yet, and stops at one that is", () => {
    const held = makeDocumentFolder({ id: "held", driveRootId: "d-old" });
    const local = makeDocumentFolder({ id: "local", driveRootId: null });
    const inDrive = makeDocumentFolder({ id: "in", driveFolderId: "d-in" });
    const all = folders(held, local, inDrive);

    expect(destinationOf(makeDocument({ folderId: "held" }), all)).toBe(
      "d-old",
    );
    expect(destinationOf(makeDocument({ folderId: "local" }), all)).toBeNull();
    expect(
      destinationOf(makeDocument({ folderId: "in" }), all),
    ).toBeUndefined();
    expect(
      destinationOf(makeDocument({ folderId: null }), all),
    ).toBeUndefined();
    expect(
      destinationOf(makeDocument({ folderId: "held", driveRootId: ROOT }), all),
    ).toBe(ROOT);
  });
});

describe("settleHeldBack", () => {
  beforeEach(async () => {
    await db.meta.put({
      key: "driveFolder",
      value: { id: "d-new", name: "Neuf" },
    });
    await db.documentFolders.add(
      makeDocumentFolder({ id: "held-folder", driveRootId: "d-old" }),
    );
    await db.documents.bulkAdd([
      makeDocument({ id: "held", driveRootId: "d-old" }),
      makeDocument({ id: "inside", folderId: "held-folder" }),
      makeDocument({ id: "new", driveRootId: "d-new" }),
      makeDocument({ id: "sent", driveFileId: "d-x", driveRootId: "d-old" }),
    ]);
  });

  it("counts what is held back for the general folder now", async () => {
    expect(await countHeldBack()).toBe(2);
  });

  it("sends it into the general folder now", async () => {
    await settleHeldBack(true);

    expect(await countHeldBack()).toBe(0);
    expect((await db.documents.get("held"))!.driveRootId).toBe("d-new");
    expect((await db.documentFolders.get("held-folder"))!.driveRootId).toBe(
      "d-new",
    );
  });

  it("or keeps it on this phone for good", async () => {
    await settleHeldBack(false);

    expect(await countHeldBack()).toBe(0);
    expect((await db.documents.get("held"))!.driveRootId).toBeNull();
    // What sits in a kept folder stays with it.
    const folders = new Map(
      (await db.documentFolders.toArray()).map((row) => [row.id, row]),
    );
    expect(
      destinationOf((await db.documents.get("inside"))!, folders),
    ).toBeNull();
  });
});
