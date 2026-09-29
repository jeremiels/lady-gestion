import { beforeEach, describe, expect, it } from "vitest";
import {
  makeDocument,
  makeDocumentFolder,
  resetDb,
} from "../__tests__/factories.ts";
import { db } from "../db.ts";
import {
  createFolder,
  deleteFolder,
  renameDocument,
  renameFolder,
} from "./documents.service.ts";

beforeEach(async () => {
  await resetDb();
  await db.documentFolders.bulkAdd([
    makeDocumentFolder({ id: "osteo", name: "Ostéopathe" }),
    makeDocumentFolder({ id: "y2025", name: "2025", parentId: "osteo" }),
    makeDocumentFolder({ id: "vide", name: "Vide" }),
  ]);
});

describe("folders", () => {
  it("creates one, trimmed, waiting to be created in the Drive", async () => {
    const folder = await createFolder("  Factures ", null);

    expect(folder).toMatchObject({
      name: "Factures",
      parentId: null,
      driveFolderId: null,
    });
  });

  it("refuses an empty name, and one already taken beside it", async () => {
    await expect(createFolder("   ", null)).rejects.toThrow("Donnez un nom");
    await expect(createFolder("ostéopathe", null)).rejects.toThrow(
      "déjà ce nom",
    );
    // The same name one level down is another folder.
    await expect(createFolder("Ostéopathe", "osteo")).resolves.toBeDefined();
  });

  it("renames, but not onto a neighbour's name", async () => {
    await renameFolder("vide", "Vétérinaire");
    expect((await db.documentFolders.get("vide"))!.name).toBe("Vétérinaire");

    await expect(renameFolder("vide", "Ostéopathe")).rejects.toThrow(
      "déjà ce nom",
    );
  });

  it("deletes an empty folder only", async () => {
    await db.documents.add(makeDocument({ folderId: "y2025" }));

    await expect(deleteFolder("osteo")).rejects.toThrow("Videz le dossier");
    await expect(deleteFolder("y2025")).rejects.toThrow("Videz le dossier");
    await deleteFolder("vide");

    expect((await db.documentFolders.get("vide"))!.deletedAt).not.toBeNull();
  });
});

describe("documents", () => {
  it("refuses an empty file name", async () => {
    await db.documents.add(makeDocument({ id: "doc" }));

    await expect(renameDocument("doc", " ")).rejects.toThrow("Donnez un nom");
  });
});
