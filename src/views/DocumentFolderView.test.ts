import { html } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../data/db.ts";
import {
  makeDocument,
  makeDocumentFolder,
  makeHorse,
  makePost,
  resetDb,
} from "../data/__tests__/factories.ts";
import { fixture, waitFor } from "../components/__tests__/fixture.ts";
import "./DocumentFolderView.ts";
import type { DocumentFolderView } from "./DocumentFolderView.ts";

const mount = (folderId: string) =>
  fixture<DocumentFolderView>(
    html`<document-folder-view .folderId=${folderId}></document-folder-view>`,
  );

const rows = (el: DocumentFolderView) => [
  ...(el.querySelector("document-list")?.shadowRoot?.querySelectorAll(".row") ??
    []),
];

beforeEach(async () => {
  await resetDb();
  await db.horses.add(makeHorse());
  await db.documentFolders.bulkAdd([
    makeDocumentFolder({ id: "osteo", name: "Ostéopathe" }),
    makeDocumentFolder({ id: "y2025", name: "2025", parentId: "osteo" }),
    makeDocumentFolder({ id: "vide", name: "Vide" }),
  ]);
});

describe("document-folder-view", () => {
  it("shows the folder's name, its subfolders and its files, tagged by post category", async () => {
    await db.posts.add(makePost({ id: "visite", categoryKey: "veto" }));
    await db.documents.bulkAdd([
      makeDocument({
        id: "facture",
        folderId: "osteo",
        name: "Facture 04/08/2026.pdf",
        size: 1_258_291,
        postId: "visite",
      }),
      makeDocument({ id: "ailleurs", folderId: "vide", name: "autre.pdf" }),
    ]);

    const el = await mount("osteo");
    await waitFor(el, () => rows(el).length === 1);

    expect(el.querySelector(".document-folder__title")!.textContent).toContain(
      "Ostéopathe",
    );
    expect(
      [...el.querySelectorAll("app-folder")].map((tile) => tile.name),
    ).toEqual(["2025"]);
    const row = rows(el)[0]!;
    expect(row.textContent).toContain("Facture 04/08/2026.pdf");
    expect(row.textContent).toContain("PDF • 1,2 mo");
    expect(row.querySelector("app-tag")?.getAttribute("label")).toBe(
      "Vétérinaire",
    );
  });

  it("says which files are not in the Drive yet, and why", async () => {
    await db.documents.bulkAdd([
      makeDocument({
        id: "sent",
        name: "sent",
        folderId: "osteo",
        driveFileId: "d-sent",
      }),
      makeDocument({ id: "waiting", name: "waiting", folderId: "osteo" }),
      makeDocument({
        id: "kept",
        name: "kept",
        folderId: "osteo",
        driveRootId: null,
      }),
    ]);
    const refused = makeDocument({
      id: "refused",
      name: "refused",
      folderId: "osteo",
    });
    await db.documents.add({ ...refused, uploadRefused: refused.updatedAt });

    const el = await mount("osteo");
    await waitFor(el, () => rows(el).length === 4);

    const note = (id: string) =>
      rows(el)
        .find((row) => row.textContent!.includes(id))!
        .querySelector(".meta")!.textContent;
    expect(note("sent")).toBe("PDF • 1 ko");
    expect(note("waiting")).toContain("Pas encore envoyé");
    expect(note("kept")).toContain("Sur ce téléphone seulement");
    expect(note("refused")).toContain("Refusé par Google Drive");
  });

  it("says when a folder is empty", async () => {
    const el = await mount("vide");

    await waitFor(el, () => el.textContent!.includes("Ce dossier est vide."));
  });

  it("says when the folder is gone from the Drive", async () => {
    const el = await mount("disparu");

    await waitFor(el, () => el.textContent!.includes("n’existe plus"));
  });
});
