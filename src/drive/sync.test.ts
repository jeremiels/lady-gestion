import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../data/db.ts";
import type { StoredDocument } from "../data/types.ts";
import {
  documentFoldersRepo,
  documentsRepo,
  documentsService,
  driveMirrorService,
  metaRepo,
} from "../data/index.ts";
import {
  makeDocument,
  makeHorse,
  resetDb,
} from "../data/__tests__/factories.ts";
import { DriveRequestError, FOLDER } from "./api.ts";
import { documentBytes, syncFolder, walkFolder } from "./sync.ts";

const T1 = "2026-09-01T10:00:00.000Z";
const T2 = "2026-09-25T10:00:00.000Z";

type Item = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime: string;
  appProperties?: Record<string, string>;
};

/** A pretend Drive: folder id -> what is directly inside it. Cloned per test. */
const TEMPLATE: Record<string, Item[]> = {
  root: [
    { id: "osteo", name: "Ostéopathe", mimeType: FOLDER, modifiedTime: T1 },
    {
      id: "carnet",
      name: "carnet.jpg",
      mimeType: "image/jpeg",
      size: "2048",
      modifiedTime: T1,
    },
    {
      id: "raccourci",
      name: "Lien",
      mimeType: "application/vnd.google-apps.shortcut",
      modifiedTime: T1,
    },
  ],
  osteo: [
    {
      id: "facture",
      name: "Facture.pdf",
      mimeType: "application/pdf",
      size: "64700",
      modifiedTime: T1,
      appProperties: { ladyPostId: "post-1" },
    },
    {
      id: "bilan",
      name: "Bilan",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: T1,
    },
    // Reached twice: Drive allows more than one parent.
    { id: "osteo", name: "Ostéopathe", mimeType: FOLDER, modifiedTime: T1 },
  ],
};

let DRIVE: Record<string, Item[]>;
/**
 * Ids put in the trash. As in the real Drive, what is inside a trashed folder
 * is in the trash too — hidden from a listing, still answered by id — and a
 * file created in one lands there with it.
 */
let TRASHED: Set<string>;
/** Folders a file also sits in besides the one listing it: elsewhere in her Drive. */
let EXTRA_PARENTS: Record<string, string[]>;
/** Answers in the pretend Drive's place when it returns a response: a refusal. */
let respond:
  | ((url: URL, init?: RequestInit) => Promise<Response | undefined>)
  | null = null;
let fetchMock: ReturnType<typeof vi.fn>;
let patches: { id: string; url: URL; body: Record<string, unknown> }[] = [];
/** Runs while a PATCH is on its way — an edit made meanwhile. */
let duringPatch: (() => Promise<void>) | null = null;

/** Where `id` sits in the pretend Drive. */
const locate = (id: string) => {
  for (const [parent, items] of Object.entries(DRIVE)) {
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) return { parent, items, index, item: items[index]! };
  }
  return null;
};

const isTrashed = (id: string): boolean => {
  if (TRASHED.has(id)) return true;
  const parent = locate(id)?.parent;
  return parent !== undefined && isTrashed(parent);
};

/** Drive's refusal, as its JSON error body carries it. */
const refusal = (status: number, reason: string) =>
  Response.json({ error: { errors: [{ reason }] } }, { status });

let uploads: RequestInit[] = [];
/** Runs before the pretend Drive answers — something done meanwhile. */
let onRequest: ((url: URL, init?: RequestInit) => Promise<void>) | null = null;
/** The next creation happens in the Drive, and its answer never arrives. */
let loseNextAnswer = false;

/** What a creation answers, unless `loseNextAnswer` drops it on the way. */
const answer = (body: unknown): Response => {
  if (!loseNextAnswer) return Response.json(body);
  loseNextAnswer = false;
  throw new TypeError("Load failed");
};

beforeEach(async () => {
  await resetDb();
  await db.horses.add(makeHorse());
  await metaRepo.set("googleAccount", {
    email: "lea@example.com",
    sessionToken: `session-${Math.random()}`,
    scope: "openid https://www.googleapis.com/auth/drive",
  });
  await metaRepo.set("driveFolder", { id: "root", name: "Lady" });
  uploads = [];
  onRequest = null;
  loseNextAnswer = false;
  patches = [];
  duringPatch = null;
  respond = null;
  TRASHED = new Set();
  EXTRA_PARENTS = {};
  DRIVE = structuredClone(TEMPLATE);
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    await onRequest?.(url, init);
    const refused = await respond?.(url, init);
    if (refused) return refused;
    if (url.pathname.endsWith("/drive/token")) {
      return Response.json({
        accessToken: "ya29.a",
        expiresAt: Date.now() + 3_600_000,
      });
    }
    if (url.pathname.startsWith("/upload/")) {
      // The metadata part of the multipart body: its JSON is the first line
      // after the part's headers.
      const text = await new Response(init!.body).text();
      const metadata = JSON.parse(
        text.split("\r\n\r\n")[1]!.split("\r\n")[0]!,
      ) as {
        name: string;
        parents: string[];
        appProperties: Record<string, string>;
      };
      const parent = metadata.parents[0]!;
      if (!DRIVE[parent]) return new Response(null, { status: 404 });
      uploads.push(init!);
      const id = `up-${uploads.length}`;
      DRIVE[parent].push({
        id,
        name: metadata.name,
        mimeType: "application/pdf",
        size: "8",
        modifiedTime: T1,
        appProperties: metadata.appProperties,
      });
      return answer({ id, modifiedTime: T1 });
    }
    const fileId = /\/files\/([^/]+)$/.exec(url.pathname)?.[1];
    // Gone from the Drive for good: emptied from the trash.
    if (fileId && !locate(fileId) && !DRIVE[fileId]) {
      return new Response(null, { status: 404 });
    }
    if (fileId && url.searchParams.get("fields") === "id,trashed") {
      return Response.json({ id: fileId, trashed: isTrashed(fileId) });
    }
    if (fileId && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      patches.push({ id: fileId, url, body });
      await duringPatch?.();
      const found = locate(fileId)!;
      if (typeof body.name === "string") found.item.name = body.name;
      found.item.modifiedTime = T2;
      if (body.trashed === true) TRASHED.add(fileId);
      const to = url.searchParams.get("addParents");
      const from = url.searchParams.get("removeParents")?.split(",") ?? [];
      if (to) {
        if (from.includes(found.parent)) found.items.splice(found.index, 1);
        (DRIVE[to] ??= []).push(found.item);
      }
      return Response.json({ modifiedTime: T2 });
    }
    if (fileId && url.searchParams.get("fields") === "parents") {
      // A folder listed in none stands at the top of her Drive: no parent.
      const found = locate(fileId);
      return Response.json({
        parents: found ? [found.parent, ...(EXTRA_PARENTS[fileId] ?? [])] : [],
      });
    }
    if (url.pathname.endsWith("/files") && init?.method === "POST") {
      const { name, parents, appProperties } = JSON.parse(
        String(init.body),
      ) as {
        name: string;
        parents: string[];
        appProperties: Record<string, string>;
      };
      if (!DRIVE[parents[0]!]) return new Response(null, { status: 404 });
      const created = {
        id: `new-${name}`,
        name,
        mimeType: FOLDER,
        modifiedTime: T1,
        appProperties,
      };
      (DRIVE[parents[0]!] ??= []).push(created);
      DRIVE[created.id] = [];
      return answer(created);
    }
    const q = url.searchParams.get("q");
    const tagged =
      /appProperties has \{ key='(\w+)' and value='([^']+)' \}/.exec(q ?? "");
    if (tagged) {
      const [, key, value] = tagged;
      const files = Object.values(DRIVE)
        .flat()
        .filter((item) => item.appProperties?.[key!] === value);
      return Response.json({ files });
    }
    if (q) {
      const parent = /'([^']+)' in parents/.exec(q)![1]!;
      return Response.json({
        files: (DRIVE[parent] ?? []).filter((item) => !isTrashed(item.id)),
      });
    }
    return new Response(`bytes of ${url.pathname}${url.search}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("walkFolder", () => {
  it("lists every folder and file under the general folder, once, without shortcuts", async () => {
    const tree = await walkFolder("root");

    expect(tree.folders).toEqual([
      {
        driveId: "osteo",
        name: "Ostéopathe",
        parentDriveId: "root",
        modifiedTime: T1,
      },
    ]);
    expect(
      tree.files.map((file) => [
        file.driveId,
        file.parentDriveId,
        file.size,
        file.postId,
      ]),
    ).toEqual([
      ["carnet", "root", 2048, null],
      ["facture", "osteo", 64_700, "post-1"],
      ["bilan", "osteo", 0, null],
    ]);
  });
});

describe("documentBytes", () => {
  it("reads the device first, and never the network then", async () => {
    const doc = makeDocument({ driveFileId: "facture" });
    await documentsRepo.putBlob(
      doc.id,
      new Blob(["cached"], { type: "application/pdf" }),
    );

    expect(await (await documentBytes(doc))!.text()).toBe("cached");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads from the Drive once, then keeps it for offline", async () => {
    const doc = makeDocument({
      driveFileId: "facture",
      mimeType: "application/pdf",
    });

    const blob = await documentBytes(doc);

    expect(blob!.type).toBe("application/pdf");
    expect(await blob!.text()).toContain("/files/facture?alt=media");
    expect(await documentsRepo.getBlob(doc.id)).toBeDefined();
  });

  it("reads as no connection when offline before an access token is had", async () => {
    const doc = makeDocument({ driveFileId: "facture" });
    fetchMock.mockRejectedValue(new TypeError("Load failed"));

    await expect(documentBytes(doc)).rejects.toMatchObject({
      constructor: DriveRequestError,
      status: 0,
    });
  });

  it("asks the Worker for a new token once Drive refuses the one it had", async () => {
    const doc = makeDocument({ driveFileId: "facture" });
    respond = async (url) =>
      url.pathname.startsWith("/drive/v3/files/facture")
        ? new Response(null, { status: 401 })
        : undefined;
    await expect(documentBytes(doc)).rejects.toMatchObject({ status: 401 });

    respond = null;
    await documentBytes(doc);

    const tokenRequests = fetchMock.mock.calls.filter(([input]) =>
      String(input).endsWith("/drive/token"),
    );
    expect(tokenRequests).toHaveLength(2);
  });

  it("gets a Google Doc as the PDF Drive exports it to", async () => {
    const doc = makeDocument({
      driveFileId: "bilan",
      mimeType: "application/vnd.google-apps.document",
    });

    const blob = await documentBytes(doc);

    expect(blob!.type).toBe("application/pdf");
    expect(await blob!.text()).toContain(
      "/files/bilan/export?mimeType=application/pdf",
    );
  });
});

describe("syncFolder", () => {
  it("uploads a file joined in the app, then reads it back as the same row", async () => {
    const pending = makeDocument({
      id: "joint",
      name: "joint.pdf",
      postId: "post-1",
      folderId: null,
      driveFileId: null,
    });
    await db.documents.add(pending);
    await documentsRepo.putBlob(
      "joint",
      new Blob(["%PDF"], { type: "application/pdf" }),
    );

    await syncFolder("root");

    expect(uploads).toHaveLength(1);
    const body = await new Response(uploads[0]!.body as Blob).text();
    expect(body).toContain('"parents":["root"]');
    expect(body).toContain('"ladyPostId":"post-1"');

    const joined = (await db.documents.toArray()).filter(
      (doc) => doc.name === "joint.pdf",
    );
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({
      id: "joint",
      postId: "post-1",
      driveFileId: "up-1",
      deletedAt: null,
    });
  });
});

describe("syncFolder — changes made in the app", () => {
  /** The pretend Drive, mirrored once: the state the app starts from. */
  const mirrored = async () => {
    await syncFolder("root");
    // Timestamps are to the millisecond: an edit in the same one as the sync
    // would read as already sent. Nobody edits that fast; a test does.
    await new Promise((resolve) => setTimeout(resolve, 2));
    return db.documents.toArray();
  };

  it("sends a rename, a move and a post link, and the walk keeps them", async () => {
    const facture = (await mirrored()).find(
      (doc) => doc.driveFileId === "facture",
    )!;

    await documentsService.renameDocument(facture.id, "Facture ostéo.pdf");
    await documentsService.moveDocument(facture.id, null);
    await documentsService.linkDocument(facture.id, "post-1");
    await syncFolder("root");

    expect(patches).toHaveLength(1);
    expect(patches[0]!.body).toMatchObject({
      name: "Facture ostéo.pdf",
      appProperties: { ladyPostId: "post-1" },
    });
    expect(patches[0]!.url.searchParams.get("addParents")).toBe("root");
    expect(patches[0]!.url.searchParams.get("removeParents")).toBe("osteo");
    expect(await db.documents.get(facture.id)).toMatchObject({
      name: "Facture ostéo.pdf",
      folderId: null,
      postId: "post-1",
      driveModifiedAt: T2,
    });
    expect(await documentsRepo.listPendingChanges()).toEqual([]);
  });

  it("sends a deletion to the trash, and the walk does not bring it back", async () => {
    const carnet = (await mirrored()).find(
      (doc) => doc.driveFileId === "carnet",
    )!;

    await documentsService.deleteDocument(carnet.id);
    await syncFolder("root");

    expect(patches[0]).toMatchObject({ id: "carnet", body: { trashed: true } });
    expect((await db.documents.get(carnet.id))!.deletedAt).not.toBeNull();
  });

  it("creates a folder made in the app, inside its parent, then files into it", async () => {
    await mirrored();
    const [osteo] = (await db.documentFolders.toArray()).filter(
      (folder) => folder.driveFolderId === "osteo",
    );
    const folder = await documentsService.createFolder("2025", osteo!.id);

    await syncFolder("root");

    const created = await db.documentFolders.get(folder.id);
    expect(created!.driveFolderId).toBe("new-2025");
    expect(DRIVE.osteo!.some((item) => item.id === "new-2025")).toBe(true);
    // The walk found it by its Drive id, not as a second folder.
    expect(
      (await db.documentFolders.toArray()).filter((row) => row.name === "2025"),
    ).toHaveLength(1);
  });

  it("leaves a change unsent while offline, and the walk does not undo it", async () => {
    const facture = (await mirrored()).find(
      (doc) => doc.driveFileId === "facture",
    )!;
    await documentsService.renameDocument(
      facture.id,
      "Renommée hors ligne.pdf",
    );
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(syncFolder("root")).rejects.toThrow();

    expect((await db.documents.get(facture.id))!.name).toBe(
      "Renommée hors ligne.pdf",
    );
    expect(await documentsRepo.listPendingChanges()).toHaveLength(1);
  });

  it("keeps an edit made while the previous one was being sent", async () => {
    const facture = (await mirrored()).find(
      (doc) => doc.driveFileId === "facture",
    )!;
    await documentsService.renameDocument(facture.id, "Premier.pdf");
    duringPatch = async () => {
      duringPatch = null;
      await new Promise((resolve) => setTimeout(resolve, 2));
      await documentsService.renameDocument(facture.id, "Second.pdf");
    };

    await syncFolder("root");
    expect(await documentsRepo.listPendingChanges()).toHaveLength(1);
    await syncFolder("root");

    expect(patches.map((patch) => patch.body.name)).toEqual([
      "Premier.pdf",
      "Second.pdf",
    ]);
    expect((await db.documents.get(facture.id))!.name).toBe("Second.pdf");
  });

  it("lets go of the previous general folder without touching it in the Drive", async () => {
    await mirrored();

    // She picks "Ostéopathe" as the new general folder.
    await driveMirrorService.chooseFolder({ id: "osteo", name: "Ostéopathe" });
    await syncFolder("osteo");
    await syncFolder("osteo");

    expect(patches).toEqual([]);
    expect(DRIVE).toEqual(TEMPLATE);
    const carnet = (await db.documents.toArray()).find(
      (doc) => doc.driveFileId === "carnet",
    )!;
    expect(carnet.deletedAt).not.toBeNull();
    expect(await documentsRepo.listPendingChanges()).toEqual([]);
  });

  it("sends nothing to the previous folder when changed with edits not sent yet", async () => {
    const rows = await mirrored();
    for (const driveId of ["carnet", "facture"]) {
      const row = rows.find((doc) => doc.driveFileId === driveId)!;
      await documentsService.renameDocument(row.id, `${driveId} renommé.pdf`);
    }
    DRIVE.elsewhere = [];

    await driveMirrorService.chooseFolder({ id: "elsewhere", name: "Autre" });
    await syncFolder("elsewhere");

    expect(patches).toEqual([]);
    expect({ root: DRIVE.root, osteo: DRIVE.osteo }).toEqual(TEMPLATE);
    expect(await documentsRepo.listPendingChanges()).toEqual([]);
  });

  it("brings the previous folder's rows back when it is picked again", async () => {
    await mirrored();
    await driveMirrorService.chooseFolder({ id: "osteo", name: "Ostéopathe" });
    await syncFolder("osteo");

    await driveMirrorService.chooseFolder({ id: "root", name: "Lady" });
    await syncFolder("root");

    const carnet = (await db.documents.toArray()).find(
      (doc) => doc.driveFileId === "carnet",
    )!;
    expect(carnet.deletedAt).toBeNull();
    expect(patches).toEqual([]);
  });
});

describe("syncFolder — what the Drive refuses for good", () => {
  const mirrored = async () => {
    await syncFolder("root");
    await new Promise((resolve) => setTimeout(resolve, 2));
    return db.documents.toArray();
  };

  /** Emptied from the Drive's trash: gone, listing and all. */
  const deleteForGood = (id: string) => {
    const found = locate(id)!;
    found.items.splice(found.index, 1);
    delete DRIVE[id];
  };

  it("gives up on a change to a file gone from the Drive, and still reads the rest", async () => {
    const facture = (await mirrored()).find(
      (doc) => doc.driveFileId === "facture",
    )!;
    await documentsService.renameDocument(facture.id, "Renommée.pdf");
    deleteForGood("facture");
    DRIVE.root!.push({
      id: "nouveau",
      name: "Nouveau.pdf",
      mimeType: "application/pdf",
      size: "10",
      modifiedTime: T2,
    });

    await syncFolder("root");

    expect((await db.documents.get(facture.id))!.deletedAt).not.toBeNull();
    const rows = await db.documents.toArray();
    expect(rows.some((doc) => doc.driveFileId === "nouveau")).toBe(true);
    expect(await documentsRepo.listPendingChanges()).toEqual([]);
  });

  it("gives up on a change to a file that is hers to read but not to change", async () => {
    const carnet = (await mirrored()).find(
      (doc) => doc.driveFileId === "carnet",
    )!;
    await documentsService.renameDocument(carnet.id, "Renommé.jpg");
    respond = async (_url, init) =>
      init?.method === "PATCH"
        ? refusal(403, "insufficientFilePermissions")
        : undefined;

    await syncFolder("root");

    expect(await documentsRepo.listPendingChanges()).toEqual([]);
    expect((await db.documents.get(carnet.id))!.name).toBe("carnet.jpg");
  });

  it("files an upload in the general folder when its folder is gone from the Drive", async () => {
    await mirrored();
    const osteo = (await db.documentFolders.toArray()).find(
      (folder) => folder.driveFolderId === "osteo",
    )!;
    await db.documents.add(
      makeDocument({
        id: "joint",
        name: "joint.pdf",
        folderId: osteo.id,
        driveFileId: null,
      }),
    );
    await documentsRepo.putBlob("joint", new Blob(["%PDF"]));
    deleteForGood("osteo");

    await syncFolder("root");

    expect(DRIVE.root!.some((item) => item.name === "joint.pdf")).toBe(true);
    expect(await db.documents.get("joint")).toMatchObject({
      folderId: null,
      driveFileId: "up-1",
      deletedAt: null,
    });
  });

  it("makes a folder at the top level when its parent is gone from the Drive", async () => {
    await mirrored();
    const osteo = (await db.documentFolders.toArray()).find(
      (folder) => folder.driveFolderId === "osteo",
    )!;
    const folder = await documentsService.createFolder("2025", osteo.id);
    deleteForGood("osteo");

    await syncFolder("root");

    expect(DRIVE.root!.some((item) => item.id === "new-2025")).toBe(true);
    expect(await db.documentFolders.get(folder.id)).toMatchObject({
      parentId: null,
      driveFolderId: "new-2025",
      deletedAt: null,
    });
  });
});

describe("syncFolder — deleting a folder", () => {
  /** "Vide" in the general folder, and "Sous" inside it: both empty. */
  const mirroredWithEmptyFolders = async () => {
    DRIVE.root!.push({
      id: "vide",
      name: "Vide",
      mimeType: FOLDER,
      modifiedTime: T1,
    });
    DRIVE.vide = [
      { id: "sous", name: "Sous", mimeType: FOLDER, modifiedTime: T1 },
    ];
    DRIVE.sous = [];
    await syncFolder("root");
    await new Promise((resolve) => setTimeout(resolve, 2));
    const rows = await db.documentFolders.toArray();
    return {
      vide: rows.find((row) => row.driveFolderId === "vide")!,
      sous: rows.find((row) => row.driveFolderId === "sous")!,
    };
  };

  it("keeps a folder that is empty here but not in the Drive", async () => {
    const { sous } = await mirroredWithEmptyFolders();
    // Put in it from the Google Drive app since the last walk.
    DRIVE.sous!.push({
      id: "ordonnance",
      name: "Ordonnance.pdf",
      mimeType: "application/pdf",
      size: "10",
      modifiedTime: T2,
    });
    await documentsService.deleteFolder(sous.id);

    await syncFolder("root");

    expect(patches).toEqual([]);
    expect((await db.documentFolders.get(sous.id))!.deletedAt).toBeNull();
    const ordonnance = (await db.documents.toArray()).find(
      (doc) => doc.driveFileId === "ordonnance",
    );
    expect(ordonnance).toMatchObject({ folderId: sous.id, deletedAt: null });
  });

  it("trashes a child before its parent, so the parent reads as empty", async () => {
    const { vide, sous } = await mirroredWithEmptyFolders();
    await documentsService.deleteFolder(sous.id);
    await documentsService.deleteFolder(vide.id);

    await syncFolder("root");

    expect(patches.map((patch) => [patch.id, patch.body.trashed])).toEqual([
      ["sous", true],
      ["vide", true],
    ]);
    expect((await db.documentFolders.get(vide.id))!.deletedAt).not.toBeNull();
  });
});

describe("syncFolder — another general folder picked meanwhile", () => {
  it("writes nothing from the previous folder's walk", async () => {
    onRequest = async (url) => {
      if (url.searchParams.get("q")?.includes("'osteo' in parents")) {
        onRequest = null;
        await driveMirrorService.chooseFolder({ id: "osteo", name: "Ostéo" });
      }
    };

    await syncFolder("root");

    expect(await db.documents.count()).toBe(0);
    expect(await db.documentFolders.count()).toBe(0);
  });

  it("stops before uploading into the previous folder", async () => {
    await documentsService.createFolder("2025", null);
    await db.documents.add(
      makeDocument({ id: "joint", name: "joint.pdf", driveFileId: null }),
    );
    await documentsRepo.putBlob("joint", new Blob(["%PDF"]));
    DRIVE.elsewhere = [];
    onRequest = async (url, init) => {
      if (url.pathname.endsWith("/files") && init?.method === "POST") {
        onRequest = null;
        await driveMirrorService.chooseFolder({
          id: "elsewhere",
          name: "Autre",
        });
      }
    };

    await expect(syncFolder("root")).rejects.toThrow();
    expect(uploads).toEqual([]);

    // Held back for the folder it was made for, until she sends it on.
    await syncFolder("elsewhere");
    expect(DRIVE.elsewhere).toEqual([]);
    await driveMirrorService.settleHeldBack(true);
    await syncFolder("elsewhere");
    expect(DRIVE.elsewhere.map((item) => item.name)).toEqual(["joint.pdf"]);
  });
});

describe("syncFolder — an answer lost on the way", () => {
  it("does not upload a file twice when the first upload's answer was lost", async () => {
    await db.documents.add(
      makeDocument({ id: "joint", name: "joint.pdf", driveFileId: null }),
    );
    await documentsRepo.putBlob("joint", new Blob(["%PDF"]));
    loseNextAnswer = true;
    const sent = async () =>
      (await db.documents.toArray()).filter((doc) => doc.name === "joint.pdf");

    // The walk that follows finds the file there, and leaves it to the row.
    await syncFolder("root");
    expect(await sent()).toMatchObject([{ id: "joint", driveFileId: null }]);

    await syncFolder("root");

    expect(uploads).toHaveLength(1);
    const rows = await sent();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "joint", driveFileId: "up-1" });
  });

  it("does not create a folder twice when the first answer was lost", async () => {
    const folder = await documentsService.createFolder("2025", null);
    loseNextAnswer = true;

    await expect(syncFolder("root")).rejects.toThrow();
    await syncFolder("root");

    expect(DRIVE.root!.filter((item) => item.name === "2025")).toHaveLength(1);
    expect(
      (await db.documentFolders.toArray()).filter((row) => row.name === "2025"),
    ).toHaveLength(1);
    expect((await db.documentFolders.get(folder.id))!.driveFolderId).toBe(
      "new-2025",
    );
  });

  it("takes up the Drive's copy of a file whose bytes are gone from the device", async () => {
    // A backup restored on a new phone: the row comes back without its bytes.
    await db.documents.add(
      makeDocument({ id: "joint", name: "joint.pdf", postId: "post-9" }),
    );
    DRIVE.root!.push({
      id: "envoye",
      name: "joint.pdf",
      mimeType: "application/pdf",
      size: "8",
      modifiedTime: T1,
      appProperties: { ladyDocId: "joint", ladyPostId: "post-9" },
    });

    await syncFolder("root");

    expect(uploads).toEqual([]);
    const rows = (await db.documents.toArray()).filter(
      (doc) => doc.name === "joint.pdf",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "joint",
      driveFileId: "envoye",
      postId: "post-9",
    });
  });
});

describe("syncFolder — what was made for the previous general folder", () => {
  beforeEach(async () => {
    await documentsService.createFolder("2026", null);
    await db.documents.add(
      makeDocument({ id: "joint", name: "joint.pdf", driveFileId: null }),
    );
    await documentsRepo.putBlob("joint", new Blob(["%PDF"]));
    DRIVE.elsewhere = [];
    await driveMirrorService.chooseFolder({ id: "elsewhere", name: "Autre" });
  });

  it("sends nothing into the new one on its own, nor back to the old one", async () => {
    await syncFolder("elsewhere");
    await syncFolder("elsewhere");

    expect(uploads).toEqual([]);
    expect(DRIVE.elsewhere).toEqual([]);
    expect({ root: DRIVE.root, osteo: DRIVE.osteo }).toEqual(TEMPLATE);
    expect(await driveMirrorService.countHeldBack()).toBe(2);
  });

  it("sends it into the new one once she says so, with what was filed in it since", async () => {
    const [made] = await documentFoldersRepo.list();
    await documentsService.moveDocument("joint", made!.id);

    await driveMirrorService.settleHeldBack(true);
    await syncFolder("elsewhere");

    expect(DRIVE.elsewhere!.map((item) => item.name)).toEqual(["2026"]);
    expect(DRIVE["new-2026"]!.map((item) => item.name)).toEqual(["joint.pdf"]);
  });

  it("keeps it on this phone for good when she says so", async () => {
    await driveMirrorService.settleHeldBack(false);
    await syncFolder("elsewhere");
    // Even once back in the folder it was made for.
    await driveMirrorService.chooseFolder({ id: "root", name: "Lady" });
    await syncFolder("root");

    expect(uploads).toEqual([]);
    expect(DRIVE.elsewhere).toEqual([]);
    expect(DRIVE.root!.map((item) => item.name)).toEqual(
      TEMPLATE.root!.map((item) => item.name),
    );
    expect((await db.documents.get("joint"))!.deletedAt).toBeNull();
  });

  it("sends it on its own once she picks the folder it was made for again", async () => {
    await driveMirrorService.chooseFolder({ id: "root", name: "Lady" });
    await syncFolder("root");

    expect(DRIVE.root!.map((item) => item.name)).toContain("joint.pdf");
    expect(DRIVE.root!.map((item) => item.name)).toContain("2026");
  });
});

describe("syncFolder — signed in with another Google account", () => {
  it("forgets a general folder the account cannot see, and keeps what is not sent yet", async () => {
    await syncFolder("root");
    await db.documents.add(
      makeDocument({ id: "joint", name: "joint.pdf", driveFileId: null }),
    );
    await documentsRepo.putBlob("joint", new Blob(["%PDF"]));
    // The new account's Drive: the previous general folder is not in it.
    const theirs = DRIVE;
    DRIVE = { mine: [] };

    await syncFolder("root");

    expect(await metaRepo.get("driveFolder")).toBeUndefined();
    const rows = await db.documents.toArray();
    expect(
      rows.filter((doc) => doc.deletedAt === null).map((doc) => doc.id),
    ).toEqual(["joint"]);
    expect(uploads).toEqual([]);
    expect(patches).toEqual([]);
    expect(theirs).toEqual(TEMPLATE);

    // She picks a folder of the new account: what was waiting is held back
    // until she sends it there.
    await driveMirrorService.chooseFolder({ id: "mine", name: "Lady" });
    await syncFolder("mine");
    expect(DRIVE.mine).toEqual([]);

    await driveMirrorService.settleHeldBack(true);
    await syncFolder("mine");
    expect(DRIVE.mine!.map((item) => item.name)).toEqual(["joint.pdf"]);
  });

  it("keeps a general folder the account can see", async () => {
    await syncFolder("root");

    expect(await metaRepo.get("driveFolder")).toEqual({
      id: "root",
      name: "Lady",
    });
    expect((await db.documents.toArray()).length).toBeGreaterThan(0);
  });
});

/** The pretend Drive, mirrored once, with a beat after: an edit then reads as newer. */
const mirroredOnce = async () => {
  await syncFolder("root");
  await new Promise((resolve) => setTimeout(resolve, 2));
  return db.documents.toArray();
};

const rowOf = (rows: StoredDocument[], driveId: string) =>
  rows.find((doc) => doc.driveFileId === driveId)!;

describe("syncFolder — another general folder picked while edits are sent", () => {
  it("trashes nothing in the previous folder", async () => {
    const rows = await mirroredOnce();
    for (const driveId of ["carnet", "facture"]) {
      await documentsService.renameDocument(
        rowOf(rows, driveId).id,
        `${driveId} renommé.pdf`,
      );
    }
    DRIVE.elsewhere = [];
    duringPatch = async () => {
      duringPatch = null;
      await driveMirrorService.chooseFolder({ id: "elsewhere", name: "Autre" });
    };

    await expect(syncFolder("root")).rejects.toThrow();
    await syncFolder("elsewhere");

    // The rename on its way when she changed folder, and nothing after it.
    expect(patches).toHaveLength(1);
    expect(patches[0]!.body.trashed).toBeUndefined();
    expect([...TRASHED]).toEqual([]);
    expect(await documentsRepo.listPendingChanges()).toEqual([]);
  });
});

describe("syncFolder — a folder in the Drive's trash", () => {
  it("files an upload in the general folder, and keeps its bytes", async () => {
    await mirroredOnce();
    const osteo = (await db.documentFolders.toArray()).find(
      (folder) => folder.driveFolderId === "osteo",
    )!;
    await db.documents.add(
      makeDocument({ id: "joint", name: "joint.pdf", folderId: osteo.id }),
    );
    await documentsRepo.putBlob("joint", new Blob(["%PDF"]));
    TRASHED.add("osteo");

    await syncFolder("root");

    expect(DRIVE.root!.some((item) => item.name === "joint.pdf")).toBe(true);
    expect(await db.documents.get("joint")).toMatchObject({
      folderId: null,
      driveFileId: "up-1",
      deletedAt: null,
    });
    expect(await documentsRepo.getBlob("joint")).toBeDefined();
  });

  it("brings out a file the Drive refused, so it can still be reached", async () => {
    await mirroredOnce();
    const osteo = (await db.documentFolders.toArray()).find(
      (folder) => folder.driveFolderId === "osteo",
    )!;
    await db.documents.add(
      makeDocument({ id: "gros", name: "gros.pdf", folderId: osteo.id }),
    );
    await documentsRepo.putBlob("gros", new Blob(["%PDF"]));
    respond = async (url) =>
      url.pathname.startsWith("/upload/")
        ? refusal(403, "storageQuotaExceeded")
        : undefined;
    await syncFolder("root");
    TRASHED.add("osteo");

    await syncFolder("root");

    expect(await documentFoldersRepo.get(osteo.id)).toBeUndefined();
    expect(
      (await documentsRepo.listByFolder(null)).map((doc) => doc.name),
    ).toContain("gros.pdf");
    expect(await documentsRepo.getBlob("gros")).toBeDefined();
  });

  it("does not move a file into it", async () => {
    const rows = await mirroredOnce();
    const osteo = (await db.documentFolders.toArray()).find(
      (folder) => folder.driveFolderId === "osteo",
    )!;
    const carnet = rowOf(rows, "carnet");
    await documentsService.moveDocument(carnet.id, osteo.id);
    TRASHED.add("osteo");

    await syncFolder("root");

    expect(patches).toEqual([]);
    expect(await db.documents.get(carnet.id)).toMatchObject({
      folderId: null,
      deletedAt: null,
    });
  });

  it("leaves a general folder in the trash alone: nothing sent, the mirror kept", async () => {
    const rows = await mirroredOnce();
    await db.documents.add(makeDocument({ id: "joint", name: "joint.pdf" }));
    await documentsRepo.putBlob("joint", new Blob(["%PDF"]));
    TRASHED.add("root");

    await syncFolder("root");

    expect(uploads).toEqual([]);
    const live = (await db.documents.toArray()).filter(
      (doc) => doc.deletedAt === null,
    );
    expect(live).toHaveLength(rows.length + 1);
    expect(await metaRepo.get("driveFolder")).toEqual({
      id: "root",
      name: "Lady",
    });
  });
});

describe("syncFolder — changed on both sides", () => {
  it("sends only what the app changed: a rename made in the Drive meanwhile stands", async () => {
    const facture = rowOf(await mirroredOnce(), "facture");
    await documentsService.linkDocument(facture.id, "post-9");
    locate("facture")!.item.name = "Renommée dans le Drive.pdf";

    await syncFolder("root");

    expect(patches).toHaveLength(1);
    expect(patches[0]!.body).toEqual({
      appProperties: { ladyPostId: "post-9" },
    });
    expect(patches[0]!.url.searchParams.get("addParents")).toBeNull();
    expect(await db.documents.get(facture.id)).toMatchObject({
      name: "Renommée dans le Drive.pdf",
      postId: "post-9",
    });
  });

  it("writes nothing to a file she moved out of the general folder in the Drive", async () => {
    const facture = rowOf(await mirroredOnce(), "facture");
    await documentsService.linkDocument(facture.id, "post-9");
    await documentsService.deleteDocument(
      rowOf(await db.documents.toArray(), "carnet").id,
    );
    for (const id of ["facture", "carnet"]) {
      const found = locate(id)!;
      found.items.splice(found.index, 1);
      (DRIVE.ailleurs ??= []).push(found.item);
    }

    await syncFolder("root");

    expect(patches).toEqual([]);
    expect([...TRASHED]).toEqual([]);
    expect((await db.documents.get(facture.id))!.deletedAt).not.toBeNull();
    expect(await documentsRepo.listPendingChanges()).toEqual([]);
  });
});

describe("syncFolder — a folder she moved out of the general one", () => {
  /** Mirrored once, then "Ostéopathe" moved elsewhere in her Drive. */
  const mirroredThenMovedOut = async () => {
    await syncFolder("root");
    await new Promise((resolve) => setTimeout(resolve, 2));
    const osteo = (await db.documentFolders.toArray()).find(
      (row) => row.driveFolderId === "osteo",
    )!;
    // From the Google Drive app, before the next walk.
    for (const items of Object.values(DRIVE)) {
      const index = items.findIndex((item) => item.id === "osteo");
      if (index >= 0) items.splice(index, 1);
    }
    DRIVE.archive = [
      { id: "osteo", name: "Ostéopathe", mimeType: FOLDER, modifiedTime: T1 },
    ];
    return osteo;
  };

  it("does not rename it", async () => {
    const osteo = await mirroredThenMovedOut();
    await documentsService.renameFolder(osteo.id, "Ostéo");

    await syncFolder("root");

    expect(patches).toEqual([]);
    expect((await db.documentFolders.get(osteo.id))!.deletedAt).not.toBeNull();
  });

  it("does not send it to the trash", async () => {
    const osteo = await mirroredThenMovedOut();
    // Empty here and in the Drive: only where it sits now keeps it.
    await db.documents.clear();
    DRIVE.osteo = [];
    await documentsService.deleteFolder(osteo.id);

    await syncFolder("root");

    expect(patches).toEqual([]);
    expect(TRASHED.size).toBe(0);
  });

  it("moves no file into it", async () => {
    const osteo = await mirroredThenMovedOut();
    const carnet = (await db.documents.toArray()).find(
      (doc) => doc.driveFileId === "carnet",
    )!;
    await documentsService.moveDocument(carnet.id, osteo.id);

    await syncFolder("root");

    expect(
      patches.some((patch) => patch.url.searchParams.has("addParents")),
    ).toBe(false);
    expect(DRIVE.root!.map((item) => item.id)).toContain("carnet");
  });

  it("uploads a file filed in it into the general folder instead", async () => {
    const osteo = await mirroredThenMovedOut();
    await db.documents.add(
      makeDocument({ id: "joint", name: "joint.pdf", folderId: osteo.id }),
    );
    await documentsRepo.putBlob("joint", new Blob(["%PDF"]));

    await syncFolder("root");

    expect(DRIVE.root!.map((item) => item.name)).toContain("joint.pdf");
    expect(DRIVE.archive!.map((item) => item.name)).toEqual(["Ostéopathe"]);
  });

  it("writes nothing to a file inside it", async () => {
    await mirroredThenMovedOut();
    const rows = await db.documents.toArray();
    await documentsService.renameDocument(
      rowOf(rows, "facture").id,
      "Renommée.pdf",
    );
    await documentsService.deleteDocument(rowOf(rows, "bilan").id);

    await syncFolder("root");

    expect(patches).toEqual([]);
    expect(TRASHED.size).toBe(0);
    expect(await documentsRepo.listPendingChanges()).toEqual([]);
  });

  it("uploads a file filed in a folder under it into the general folder instead", async () => {
    DRIVE.osteo!.push({
      id: "annee",
      name: "2025",
      mimeType: FOLDER,
      modifiedTime: T1,
    });
    DRIVE.annee = [];
    await mirroredThenMovedOut();
    const annee = (await db.documentFolders.toArray()).find(
      (row) => row.driveFolderId === "annee",
    )!;
    await db.documents.add(
      makeDocument({ id: "joint", name: "joint.pdf", folderId: annee.id }),
    );
    await documentsRepo.putBlob("joint", new Blob(["%PDF"]));

    await syncFolder("root");

    expect(DRIVE.root!.map((item) => item.name)).toContain("joint.pdf");
    expect(DRIVE.annee).toEqual([]);
  });
});

describe("syncFolder — a file in more than one folder", () => {
  it("moves it without taking it out of a folder outside the general one", async () => {
    EXTRA_PARENTS.facture = ["ailleurs"];
    DRIVE.ailleurs = [];
    const facture = rowOf(await mirroredOnce(), "facture");
    await documentsService.moveDocument(facture.id, null);

    await syncFolder("root");

    expect(patches[0]!.url.searchParams.get("addParents")).toBe("root");
    expect(patches[0]!.url.searchParams.get("removeParents")).toBe("osteo");
  });

  it("renames it without moving it", async () => {
    EXTRA_PARENTS.facture = ["ailleurs"];
    DRIVE.ailleurs = [];
    const facture = rowOf(await mirroredOnce(), "facture");
    await documentsService.renameDocument(facture.id, "Renommée.pdf");

    await syncFolder("root");

    expect(patches[0]!.body).toEqual({ name: "Renommée.pdf" });
    expect(patches[0]!.url.searchParams.get("addParents")).toBeNull();
    expect(patches[0]!.url.searchParams.get("removeParents")).toBeNull();
  });

  it("keeps one row for one filed twice in the general folder, and settles", async () => {
    DRIVE.root!.push(structuredClone(DRIVE.osteo![0]!));
    const rows = await mirroredOnce();

    expect(rows.filter((doc) => doc.driveFileId === "facture")).toHaveLength(1);
    await syncFolder("root");
    expect(await db.documents.toArray()).toEqual(rows);
  });
});

describe("syncFolder — refusals that pass", () => {
  it.each(["userRateLimitExceeded", "dailyLimitExceeded"])(
    "keeps a change pending when the Drive says too many requests (%s)",
    async (reason) => {
      const facture = rowOf(await mirroredOnce(), "facture");
      await documentsService.renameDocument(facture.id, "Renommée.pdf");
      respond = async (_url, init) =>
        init?.method === "PATCH" ? refusal(403, reason) : undefined;

      await expect(syncFolder("root")).rejects.toThrow();

      expect(await documentsRepo.listPendingChanges()).toHaveLength(1);
      expect((await db.documents.get(facture.id))!.name).toBe("Renommée.pdf");
    },
  );

  it("keeps a change the Drive refuses without a lasting reason, and still reads the Drive", async () => {
    const facture = rowOf(await mirroredOnce(), "facture");
    await documentsService.renameDocument(facture.id, "Renommée.pdf");
    DRIVE.root!.push({
      id: "nouveau",
      name: "Nouveau.pdf",
      mimeType: "application/pdf",
      size: "10",
      modifiedTime: T2,
    });
    respond = async (_url, init) =>
      init?.method === "PATCH"
        ? refusal(403, "accessNotConfigured")
        : undefined;

    await syncFolder("root");

    // Hers still, and sent again next time: not written over by the walk.
    expect(await documentsRepo.listPendingChanges()).toHaveLength(1);
    expect((await db.documents.get(facture.id))!.name).toBe("Renommée.pdf");
    expect(
      (await db.documents.toArray()).some(
        (doc) => doc.driveFileId === "nouveau",
      ),
    ).toBe(true);
  });

  it("goes on with the other uploads and the walk when the Drive keeps refusing one file", async () => {
    for (const name of ["gros.pdf", "petit.pdf"]) {
      await db.documents.add(makeDocument({ id: name, name }));
      await documentsRepo.putBlob(name, new Blob(["%PDF"]));
    }
    respond = async (url, init) =>
      url.pathname.startsWith("/upload/") &&
      (await new Response(init!.body).text()).includes("gros.pdf")
        ? new Response(null, { status: 413 })
        : undefined;

    await syncFolder("root");

    expect(DRIVE.root!.map((item) => item.name)).toContain("petit.pdf");
    expect((await db.documents.get("gros.pdf"))!.driveFileId).toBeNull();
    // The walk ran: the Drive's own files are mirrored.
    expect(
      (await db.documents.toArray()).some(
        (doc) => doc.driveFileId === "carnet",
      ),
    ).toBe(true);
  });

  it("does not send again a file the Drive refuses for good, until she retries", async () => {
    await db.documents.add(makeDocument({ id: "gros", name: "gros.pdf" }));
    await documentsRepo.putBlob("gros", new Blob(["%PDF"]));
    let tries = 0;
    respond = async (url) => {
      if (!url.pathname.startsWith("/upload/")) return undefined;
      tries += 1;
      return refusal(403, "storageQuotaExceeded");
    };

    await syncFolder("root");
    await syncFolder("root");
    expect(tries).toBe(1);

    respond = null;
    await documentsService.retryUpload("gros");
    await syncFolder("root");
    expect(DRIVE.root!.map((item) => item.name)).toContain("gros.pdf");
  });

  it.each([
    ["a 503", () => new Response(null, { status: 503 })],
    ["a 403 without a lasting reason", () => refusal(403, "domainPolicy")],
  ])(
    "sends again a file the Drive could not take for now (%s)",
    async (_name, refuse) => {
      await db.documents.add(makeDocument({ id: "gros", name: "gros.pdf" }));
      await documentsRepo.putBlob("gros", new Blob(["%PDF"]));
      respond = async (url) =>
        url.pathname.startsWith("/upload/") ? refuse() : undefined;

      await syncFolder("root");
      respond = null;
      await syncFolder("root");

      expect(DRIVE.root!.map((item) => item.name)).toContain("gros.pdf");
    },
  );

  it("still reads the Drive when a file's bytes do not get through, and sends no other then", async () => {
    for (const name of ["gros.pdf", "petit.pdf"]) {
      await db.documents.add(makeDocument({ id: name, name }));
      await documentsRepo.putBlob(name, new Blob(["%PDF"]));
    }
    let tries = 0;
    respond = async (url) => {
      if (!url.pathname.startsWith("/upload/")) return undefined;
      tries += 1;
      throw new TypeError("Load failed");
    };

    await syncFolder("root");

    expect(tries).toBe(1);
    expect((await db.documents.get("petit.pdf"))!.driveFileId).toBeNull();
    expect(
      (await db.documents.toArray()).some(
        (doc) => doc.driveFileId === "carnet",
      ),
    ).toBe(true);

    respond = null;
    await syncFolder("root");
    expect(DRIVE.root!.map((item) => item.name)).toEqual(
      expect.arrayContaining(["gros.pdf", "petit.pdf"]),
    );
  });

  it("gives up on a request that never answers, as no connection", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    fetchMock.mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).endsWith("/drive/token")
          ? Promise.resolve(
              Response.json({
                accessToken: "ya29.a",
                expiresAt: Date.now() + 3_600_000,
              }),
            )
          : new Promise((_resolve, reject) => {
              // No signal: a request with no limit hangs, as the real one would.
              const signal = init?.signal;
              if (!signal) return;
              if (signal.aborted) reject(signal.reason);
              signal.addEventListener("abort", () => reject(signal.reason));
            }),
    );

    const sync = syncFolder("root");
    controller.abort(new DOMException("Délai dépassé", "TimeoutError"));

    await expect(sync).rejects.toMatchObject({
      constructor: DriveRequestError,
      status: 0,
    });
  });
});

describe("syncFolder — edited while being uploaded", () => {
  const joined = async () => {
    await db.documents.add(makeDocument({ id: "joint", name: "joint.pdf" }));
    await documentsRepo.putBlob("joint", new Blob(["%PDF"]));
  };
  const meanwhile = (edit: () => Promise<void>) => {
    onRequest = async (url) => {
      if (!url.pathname.startsWith("/upload/")) return;
      onRequest = null;
      await new Promise((resolve) => setTimeout(resolve, 2));
      await edit();
    };
  };

  it("sends a rename made while the bytes were on their way", async () => {
    await joined();
    meanwhile(() => documentsService.renameDocument("joint", "Renommé.pdf"));

    await syncFolder("root");

    expect(patches.map((patch) => patch.body.name)).toEqual(["Renommé.pdf"]);
    expect((await db.documents.get("joint"))!.name).toBe("Renommé.pdf");
  });

  it("sends the file to the trash when deleted while it was on its way", async () => {
    await joined();
    meanwhile(() => documentsService.deleteDocument("joint"));

    await syncFolder("root");

    expect(patches).toMatchObject([{ id: "up-1", body: { trashed: true } }]);
    const rows = await db.documents.toArray();
    expect(
      rows.filter(
        (doc) => doc.driveFileId === "up-1" && doc.deletedAt === null,
      ),
    ).toEqual([]);
  });
});

describe("syncFolder — a folder emptied then deleted", () => {
  it("trashes it once the files moved out of it have gone", async () => {
    DRIVE.root!.push({
      id: "vide",
      name: "Vide",
      mimeType: FOLDER,
      modifiedTime: T1,
    });
    DRIVE.vide = [
      {
        id: "ordonnance",
        name: "Ordonnance.pdf",
        mimeType: "application/pdf",
        size: "10",
        modifiedTime: T1,
      },
    ];
    const rows = await mirroredOnce();
    const vide = (await db.documentFolders.toArray()).find(
      (folder) => folder.driveFolderId === "vide",
    )!;
    await documentsService.moveDocument(rowOf(rows, "ordonnance").id, null);
    await documentsService.deleteFolder(vide.id);

    await syncFolder("root");

    expect(patches.map((patch) => patch.id)).toEqual(["ordonnance", "vide"]);
    expect(TRASHED.has("vide")).toBe(true);
    expect((await db.documentFolders.get(vide.id))!.deletedAt).not.toBeNull();
  });
});
