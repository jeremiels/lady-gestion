import { html } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../data/db.ts";
import {
  makeDocument,
  makeDocumentFolder,
  resetDb,
} from "../../data/__tests__/factories.ts";
import type { DocumentFolder } from "../../data/types.ts";
import { fixture, settled, waitFor } from "../__tests__/fixture.ts";
import type { AppInput } from "../app-input/app-input.ts";
import "./folder-sheet.ts";
import type { FolderSheet } from "./folder-sheet.ts";

const mount = async (
  folder: DocumentFolder | null,
  parentId: string | null = null,
) => {
  const el = await fixture<FolderSheet>(
    html`<folder-sheet
      .open=${true}
      .folder=${folder}
      .parentId=${parentId}
    ></folder-sheet>`,
  );
  const done = vi.fn();
  el.addEventListener("folder-sheet-done", done);
  return { el, done };
};

const root = (el: FolderSheet) => el.shadowRoot!;
const button = (el: FolderSheet, label: string) =>
  [...root(el).querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    b.textContent!.includes(label),
  )!;
const typeName = (el: FolderSheet, name: string) => {
  root(el).querySelector<AppInput>("app-input")!.value = name;
};

const OSTEO = makeDocumentFolder({ id: "osteo", name: "Ostéopathe" });

beforeEach(async () => {
  await resetDb();
  await db.documentFolders.add(OSTEO);
});

describe("folder-sheet", () => {
  it("creates a folder inside its parent", async () => {
    const { el, done } = await mount(null, "osteo");
    typeName(el, "2025");
    button(el, "Créer").click();

    await waitFor(el, () => done.mock.calls.length > 0);
    const created = (await db.documentFolders.toArray()).find(
      (folder) => folder.name === "2025",
    );
    expect(created).toMatchObject({ parentId: "osteo", driveFolderId: null });
  });

  it("says why a name is refused, and stays open", async () => {
    const { el, done } = await mount(null);
    typeName(el, "ostéopathe");
    button(el, "Créer").click();

    await waitFor(el, () => root(el).textContent!.includes("déjà ce nom"));
    expect(done).not.toHaveBeenCalled();
  });

  it("renames a folder", async () => {
    const { el, done } = await mount(OSTEO);
    typeName(el, "Ostéo");
    button(el, "Renommer").click();

    await waitFor(el, () => done.mock.calls.length > 0);
    expect((await db.documentFolders.get("osteo"))!.name).toBe("Ostéo");
  });

  it("refuses to delete a folder with files in it", async () => {
    await db.documents.add(makeDocument({ folderId: "osteo" }));
    const { el } = await mount(OSTEO);
    button(el, "Supprimer le dossier").click();
    await settled(el);
    button(el, "Supprimer").click();

    await waitFor(el, () => root(el).textContent!.includes("Videz le dossier"));
    expect((await db.documentFolders.get("osteo"))!.deletedAt).toBeNull();
  });

  it("deletes an empty folder, and says so to the owner", async () => {
    const { el, done } = await mount(OSTEO);
    button(el, "Supprimer le dossier").click();
    await settled(el);
    button(el, "Supprimer").click();

    await waitFor(el, () => done.mock.calls.length > 0);
    expect(done.mock.calls[0]![0].detail).toEqual({ deleted: true });
  });

  it("promises the Drive's trash only to a folder that is in the Drive", async () => {
    const { el } = await mount(OSTEO);
    button(el, "Supprimer le dossier").click();
    await settled(el);
    expect(root(el).textContent).not.toContain("corbeille");

    el.folder = { ...OSTEO, driveFolderId: "drive-osteo" };
    await settled(el);
    expect(root(el).textContent).toContain("corbeille");
  });
});
