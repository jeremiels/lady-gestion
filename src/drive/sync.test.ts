import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../data/db.ts";
import {
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
  DRIVE = structuredClone(TEMPLATE);
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    await onRequest?.(url, init);
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
    if (fileId && !locate(fileId)) return new Response(null, { status: 404 });
    if (fileId && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      patches.push({ id: fileId, url, body });
      await duringPatch?.();
      const found = locate(fileId)!;
      if (typeof body.name === "string") found.item.name = body.name;
      found.item.modifiedTime = T2;
      if (body.trashed === true || url.searchParams.get("addParents")) {
        found.items.splice(found.index, 1);
      }
      const to = url.searchParams.get("addParents");
      if (to && body.trashed !== true) (DRIVE[to] ??= []).push(found.item);
      return Response.json({ modifiedTime: T2 });
    }
    if (fileId && url.searchParams.get("fields") === "parents") {
      return Response.json({ parents: [locate(fileId)!.parent] });
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
      return Response.json({ files: DRIVE[parent] ?? [] });
    }
    return new Response(`bytes of ${url.pathname}${url.search}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

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
      tree.files.map((file) => [file.driveId, file.parentDriveId, file.size]),
    ).toEqual([
      ["carnet", "root", 2048],
      ["facture", "osteo", 64_700],
      ["bilan", "osteo", 0],
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

    await expect(syncFolder("root")).rejects.toThrow();
    await syncFolder("root");

    expect(uploads).toHaveLength(1);
    const rows = (await db.documents.toArray()).filter(
      (doc) => doc.name === "joint.pdf",
    );
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
});
