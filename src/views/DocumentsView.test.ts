import { html } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../data/db.ts";
import {
  makeDocument,
  makeDocumentFolder,
  makeHorse,
  resetDb,
} from "../data/__tests__/factories.ts";
import { fixture, waitFor } from "../components/__tests__/fixture.ts";
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
