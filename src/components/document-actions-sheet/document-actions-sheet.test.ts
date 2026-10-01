import { html } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../data/db.ts";
import {
  makeDocument,
  makeDocumentFolder,
  makeHorse,
  makePost,
  resetDb,
} from "../../data/__tests__/factories.ts";
import { fixture, settled, waitFor } from "../__tests__/fixture.ts";
import type { AppInput } from "../app-input/app-input.ts";
import type { AppSelect } from "../app-select/app-select.ts";
import "./document-actions-sheet.ts";
import type { DocumentActionsSheet } from "./document-actions-sheet.ts";

const DOC = makeDocument({ id: "doc", name: "scan.pdf", folderId: null });

const mount = async (doc = DOC) => {
  const el = await fixture<DocumentActionsSheet>(
    html`<document-actions-sheet
      .open=${true}
      .doc=${doc}
    ></document-actions-sheet>`,
  );
  const done = vi.fn();
  el.addEventListener("document-actions-done", done);
  return { el, done };
};

const root = (el: DocumentActionsSheet) => el.shadowRoot!;
const button = (el: DocumentActionsSheet, label: string) =>
  [...root(el).querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    b.textContent!.includes(label),
  )!;

const choose = async (el: DocumentActionsSheet, value: string) => {
  const select = root(el)
    .querySelector<AppSelect>("app-select")!
    .renderRoot.querySelector("select")!;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await settled(el);
};

beforeEach(async () => {
  await resetDb();
  await db.horses.add(makeHorse());
  await db.documents.add(DOC);
  await db.documentFolders.add(
    makeDocumentFolder({ id: "osteo", name: "Ostéopathe" }),
  );
  await db.posts.add(
    makePost({ id: "visite", title: "Visite", categoryKey: "veto" }),
  );
});

describe("document-actions-sheet", () => {
  it("renames the file", async () => {
    const { el, done } = await mount();
    button(el, "Renommer").click();
    await settled(el);

    root(el).querySelector<AppInput>("app-input")!.value = "Ordonnance.pdf";
    button(el, "Renommer").click();

    await waitFor(el, () => done.mock.calls.length > 0);
    expect((await db.documents.get("doc"))!.name).toBe("Ordonnance.pdf");
  });

  it("moves it to another folder", async () => {
    const { el, done } = await mount();
    button(el, "Déplacer").click();
    await settled(el);
    await waitFor(
      el,
      () => root(el).querySelector<AppSelect>("app-select")!.options.length > 1,
    );

    await choose(el, "osteo");
    button(el, "Déplacer").click();

    await waitFor(el, () => done.mock.calls.length > 0);
    expect((await db.documents.get("doc"))!.folderId).toBe("osteo");
  });

  it("links it to an event", async () => {
    const { el, done } = await mount();
    button(el, "Lier").click();
    await settled(el);
    await waitFor(
      el,
      () => root(el).querySelector<AppSelect>("app-select")!.options.length > 1,
    );

    await choose(el, "visite");
    button(el, "Enregistrer").click();

    await waitFor(el, () => done.mock.calls.length > 0);
    expect((await db.documents.get("doc"))!.postId).toBe("visite");
  });

  it("deletes it only once confirmed", async () => {
    const sent = { ...DOC, driveFileId: "drive-1" };
    await db.documents.put(sent);
    const { el, done } = await mount(sent);
    button(el, "Supprimer").click();
    await settled(el);
    expect(root(el).textContent).toContain("corbeille");
    expect((await db.documents.get("doc"))!.deletedAt).toBeNull();

    button(el, "Supprimer").click();

    await waitFor(el, () => done.mock.calls.length > 0);
    expect((await db.documents.get("doc"))!.deletedAt).not.toBeNull();
  });

  it("says a file not in the Drive yet is deleted for good", async () => {
    const { el } = await mount();
    button(el, "Supprimer").click();
    await settled(el);

    expect(root(el).textContent).toContain("sans pouvoir être récupéré");
    expect(root(el).textContent).not.toContain("corbeille");
  });
});

describe("document-actions-sheet — an upload the Drive refused", () => {
  it("offers to send it again only then", async () => {
    const { el } = await mount();
    expect(button(el, "Réessayer")).toBeUndefined();

    const refused = { ...DOC, uploadRefused: DOC.updatedAt };
    await db.documents.put(refused);
    el.doc = refused;
    await settled(el);
    button(el, "Réessayer").click();

    await vi.waitFor(async () =>
      expect((await db.documents.get("doc"))!.uploadRefused).toBeUndefined(),
    );
  });
});
