import { html } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../data/db.ts";
import {
  makeDocument,
  makeHorse,
  resetDb,
} from "../data/__tests__/factories.ts";
import { fixture, waitFor } from "../components/__tests__/fixture.ts";
import {
  DOCUMENT_CATEGORIES,
  documentCategory,
} from "../types/document.types.ts";
import "./DocumentsView.ts";
import type { DocumentsView } from "./DocumentsView.ts";

const mount = () =>
  fixture<DocumentsView>(html`<documents-view></documents-view>`);

const folderNamed = (el: DocumentsView, label: string) =>
  [...el.querySelectorAll("app-folder")].find(
    (folder) => folder.name === label,
  )!;

beforeEach(async () => {
  await resetDb();
  await db.horses.add(makeHorse());
});

describe("documents-view", () => {
  it("shows every category up front, including ones with nothing filed yet", async () => {
    const el = await mount();

    // Every folder tile renders regardless of the live count, which is the
    // whole point — a user filing the first ordonnance needs to see the
    // folder before there is anything in it.
    expect(el.querySelectorAll("app-folder")).toHaveLength(
      DOCUMENT_CATEGORIES.length,
    );
    expect(
      [...el.querySelectorAll("app-folder")].every(
        (folder) => folder.number === 0,
      ),
    ).toBe(true);
  });

  it("counts documents per category, and leaves an empty one at zero", async () => {
    await db.documents.bulkAdd([
      makeDocument({ id: "doc-1", category: "facture" }),
      makeDocument({ id: "doc-2", category: "facture" }),
      makeDocument({ id: "doc-3", category: "ordonnance" }),
    ]);

    const el = await mount();
    const facture = () => folderNamed(el, documentCategory.label("facture"));
    await waitFor(el, () => facture().number > 0);

    expect(facture().number).toBe(2);
    expect(folderNamed(el, documentCategory.label("ordonnance")).number).toBe(
      1,
    );
    expect(folderNamed(el, documentCategory.label("identite")).number).toBe(0);
  });
});
