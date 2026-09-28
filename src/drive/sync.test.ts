import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../data/db.ts";
import { documentsRepo, metaRepo } from "../data/index.ts";
import {
  makeDocument,
  makeHorse,
  resetDb,
} from "../data/__tests__/factories.ts";
import { FOLDER } from "./api.ts";
import { documentBytes, walkFolder } from "./sync.ts";

const T1 = "2026-09-01T10:00:00.000Z";

type Item = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime: string;
};

/** A pretend Drive: folder id -> what is directly inside it. */
const DRIVE: Record<string, Item[]> = {
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

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await resetDb();
  await db.horses.add(makeHorse());
  await metaRepo.set("googleAccount", {
    email: "lea@example.com",
    sessionToken: `session-${Math.random()}`,
    scope: "openid https://www.googleapis.com/auth/drive",
  });
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/drive/token")) {
      return Response.json({
        accessToken: "ya29.a",
        expiresAt: Date.now() + 3_600_000,
      });
    }
    const q = url.searchParams.get("q");
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
