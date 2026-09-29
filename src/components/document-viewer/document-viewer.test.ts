import { html } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDocument, resetDb } from "../../data/__tests__/factories.ts";
import { documentBytes } from "../../drive/sync.ts";
import { fixture, waitFor } from "../__tests__/fixture.ts";
import "./document-viewer.ts";
import type { DocumentViewer } from "./document-viewer.ts";

// The bytes are handed over directly: where they come from — the device or
// the Drive — is `sync.test.ts`'s business, and WebKit's test sessions cannot
// store a Blob in IndexedDB anyway (see `__tests__/blob-storage.ts`). What
// this suite is for is drawing them, in the iPhone's engine too.
vi.mock("../../drive/sync.ts", () => ({ documentBytes: vi.fn() }));

/** A minimal, valid PDF with `pages` pages. ASCII only: offsets are char counts. */
const pdfOf = (pages: number): Blob => {
  const content = "BT /F1 24 Tf 72 700 Td (Facture) Tj ET";
  const kids = Array.from({ length: pages }, (_, i) => `${4 + i} 0 R`).join(
    " ",
  );
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    `<</Type/Pages/Kids[${kids}]/Count ${pages}>>`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    ...Array.from(
      { length: pages },
      () =>
        `<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 3 0 R>>>>/Contents ${4 + pages} 0 R>>`,
    ),
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([pdf], { type: "application/pdf" });
};

const mount = (doc: ReturnType<typeof makeDocument>) =>
  fixture<DocumentViewer>(
    html`<document-viewer .open=${true} .doc=${doc}></document-viewer>`,
  );

const root = (el: DocumentViewer) => el.shadowRoot!;

/**
 * Longer than `waitFor`: the first PDF of a run loads pdf.js and starts its
 * worker, which takes a second or so on its own.
 */
const until = async (predicate: () => boolean, timeoutMs = 10_000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("until: timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

beforeEach(async () => {
  await resetDb();
  vi.mocked(documentBytes).mockReset();
});

describe("document-viewer", () => {
  it("draws every page of a PDF inside the app", async () => {
    const doc = makeDocument({ id: "pdf", mimeType: "application/pdf" });
    vi.mocked(documentBytes).mockResolvedValue(pdfOf(3));

    const el = await mount(doc);

    await until(() => root(el).querySelectorAll("canvas").length === 3);
    const first = root(el).querySelector("canvas")!;
    expect(first.width).toBeGreaterThan(0);
    expect(first.getAttribute("aria-label")).toBe("Page 1 sur 3");
  });

  it("shows a photo as an image", async () => {
    const doc = makeDocument({
      id: "photo",
      mimeType: "image/png",
      name: "carnet.png",
    });
    vi.mocked(documentBytes).mockResolvedValue(
      new Blob([new Uint8Array(8)], { type: "image/png" }),
    );

    const el = await mount(doc);

    await waitFor(
      el,
      () => root(el).querySelector("img.viewer__image") !== null,
    );
    expect(root(el).querySelector("img")!.getAttribute("src")).toMatch(
      /^blob:/,
    );
  });

  it("says so when the file is neither here nor in the Drive", async () => {
    vi.mocked(documentBytes).mockResolvedValue(undefined);
    const el = await mount(makeDocument({ id: "nowhere", driveFileId: null }));

    await waitFor(el, () => root(el).textContent!.includes("introuvable"));
  });
});
