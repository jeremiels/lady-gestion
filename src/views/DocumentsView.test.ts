import { html } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../data/db.ts";
import { liveQueriesSettled } from "../data/live.ts";
import { metaRepo } from "../data/index.ts";
import {
  makeDocument,
  makeDocumentFolder,
  makeHorse,
  resetDb,
} from "../data/__tests__/factories.ts";
import { fixture, settled, waitFor } from "../components/__tests__/fixture.ts";
import "./DocumentsView.ts";
import type { DocumentsView } from "./DocumentsView.ts";

const mount = () =>
  fixture<DocumentsView>(html`<documents-view></documents-view>`);

const folderNamed = (el: DocumentsView, name: string) =>
  [...el.querySelectorAll("app-folder")].find(
    (folder) => folder.name === name,
  )!;

beforeEach(async () => {
  await resetDb();
  await db.horses.add(makeHorse());
});

describe("documents-view", () => {
  it("shows the folders directly under the general one, alphabetically", async () => {
    await db.documentFolders.bulkAdd([
      makeDocumentFolder({ id: "veto", name: "Vétérinaire" }),
      makeDocumentFolder({ id: "osteo", name: "Ostéopathe" }),
      makeDocumentFolder({ id: "nested", name: "2025", parentId: "osteo" }),
      makeDocumentFolder({
        id: "gone",
        name: "Ancien",
        deletedAt: "2026-06-01T00:00:00.000Z",
      }),
    ]);

    const el = await mount();
    await waitFor(el, () => el.querySelectorAll("app-folder").length > 0);

    expect(
      [...el.querySelectorAll("app-folder")].map((folder) => folder.name),
    ).toEqual(["Ostéopathe", "Vétérinaire"]);
  });

  it("counts the documents filed in each folder, and leaves an empty one at zero", async () => {
    await db.documentFolders.bulkAdd([
      makeDocumentFolder({ id: "osteo", name: "Ostéopathe" }),
      makeDocumentFolder({ id: "veto", name: "Vétérinaire" }),
    ]);
    await db.documents.bulkAdd([
      makeDocument({ id: "doc-1", folderId: "osteo" }),
      makeDocument({ id: "doc-2", folderId: "osteo" }),
    ]);

    const el = await mount();
    await waitFor(el, () => folderNamed(el, "Ostéopathe")?.number > 0);

    expect(folderNamed(el, "Ostéopathe").number).toBe(2);
    expect(folderNamed(el, "Vétérinaire").number).toBe(0);
  });
});

describe("documents-view — Google Drive setup", () => {
  const prompt = (el: DocumentsView) => el.querySelector(".documents-drive");

  it("asks to connect Drive first", async () => {
    const el = await mount();
    await waitFor(el, () => prompt(el) !== null);

    expect(prompt(el)!.textContent).toContain("Connecter Google Drive");
  });

  it("then asks for the general folder", async () => {
    await metaRepo.set("googleAccount", {
      email: "lea@example.com",
      sessionToken: "t",
      scope: "openid https://www.googleapis.com/auth/drive",
    });

    const el = await mount();
    await waitFor(el, () => prompt(el) !== null);

    expect(prompt(el)!.textContent).toContain("Choisir le dossier");
  });

  it("steps aside once both are done", async () => {
    await metaRepo.set("googleAccount", {
      email: "lea@example.com",
      sessionToken: "t",
      scope: "openid https://www.googleapis.com/auth/drive",
    });
    await metaRepo.set("driveFolder", { id: "f1", name: "PONEY" });

    const el = await mount();
    // Absent while loading too, so wait for the account to have been read.
    await liveQueriesSettled(1000);
    await settled(el);

    expect(prompt(el)).toBeNull();
  });
});
