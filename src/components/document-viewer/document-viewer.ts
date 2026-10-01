import { css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";
import { isImage, isPdf } from "../../data/index.ts";
import type { StoredDocument } from "../../data/types.ts";
import { DriveRequestError, exportsAsPdf } from "../../drive/api.ts";
import { DriveSignedOutError } from "../../drive/auth.ts";
import { documentBytes } from "../../drive/sync.ts";

import "../app-modal/app-modal.ts";

/**
 * pdf.js, loaded the first time a PDF is opened: the library and its worker
 * are the largest thing the app ships, and most sessions never open a file.
 */
const loadPdfjs = async () => {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
};

/**
 * Past 2× device pixels a page costs memory for no visible gain, and iOS caps
 * the canvas memory a page may hold — a multi-page scan at 3× is how a viewer
 * goes blank on an iPhone.
 */
const MAX_PIXEL_RATIO = 2;

const UNSUPPORTED = "Ce type de fichier ne peut pas être affiché ici.";

/**
 * Whether the viewer can draw a file of this type: a PDF, a photo, or a
 * Google Doc, which arrives as the PDF Drive exports it to. Anything else is
 * not downloaded just to say so.
 */
const showsInApp = (mimeType: string): boolean =>
  isPdf(mimeType) || isImage(mimeType) || exportsAsPdf(mimeType);

/**
 * Full-screen viewer for a stored document, inside the app.
 *
 * A PDF is drawn page by page with pdf.js rather than handed to an
 * `<iframe>`: iOS shows only the first page of a PDF in a frame, and leaving
 * the app to read page 2 is what `docs/drive-spec.md` sets out to end (D5).
 * An image is an `<img>`.
 *
 * The bytes come from the device, or from the Drive the first time
 * (`documentBytes`), and are then kept for offline.
 *
 * Owns the object URL an image needs, so the create/revoke pair stays in one
 * element's lifecycle: a missed revoke pins the file in memory.
 *
 * The property is `doc`, not `document`: that name shadows the DOM global, the
 * same trap `Post` exists to avoid for `Event`.
 *
 * @fires viewer-close - No detail. Dismissed by any route the modal offers.
 */
@customElement("document-viewer")
export class DocumentViewer extends BaseElement {
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ attribute: false }) doc: StoredDocument | null = null;

  @state() private bytes: Blob | null = null;
  @state() private url = "";
  @state() private error = "";

  @query(".viewer__pages") private pagesEl?: HTMLElement;

  /** Bumped on every load and release: an answer for an older one is dropped. */
  #generation = 0;

  static componentStyles = css`
    :host {
      display: contents;
    }

    .viewer__pages {
      display: grid;
      gap: var(--spacing-8);
      height: 100%;
      overflow-y: auto;
      padding: var(--spacing-8) 0;
      box-sizing: border-box;
    }

    /* Fades in when drawn, rather than replacing "Ouverture…" at full opacity:
       the modal has just scaled in, and slamming its contents in a beat later
       undoes that. */
    .viewer__pages canvas {
      display: block;
      width: 100%;
      height: auto;
      background-color: var(--color-white);
      transition: opacity var(--duration-fast) var(--easing-out);
    }

    .viewer__image {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      transition: opacity var(--duration-fast) var(--easing-out);
    }

    @starting-style {
      .viewer__pages canvas,
      .viewer__image {
        opacity: 0;
      }
    }

    .viewer__message {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-12);
      height: 100%;
      padding: var(--spacing-24);
      text-align: center;
      color: var(--color-white);
    }
  `;

  // Untyped: `bytes` is private state, which `PropertyValues<this>` cannot name.
  protected updated(changed: PropertyValues) {
    if (changed.has("open") || changed.has("doc")) {
      // Swapping documents while open must not keep showing the previous one.
      if (changed.has("doc")) this.#release();
      if (this.open && this.doc) void this.#load(this.doc);
      else this.#release();
    }
    if (changed.has("bytes") && this.bytes && isPdf(this.bytes.type)) {
      void this.#drawPdf(this.bytes, this.#generation);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Navigating away mid-view still has to give the bytes back.
    this.#release();
  }

  async #load(doc: StoredDocument) {
    // Already showing this document.
    if (this.bytes || this.error) return;
    if (!showsInApp(doc.mimeType)) {
      this.error = UNSUPPORTED;
      return;
    }
    const generation = ++this.#generation;

    try {
      const bytes = await documentBytes(doc);
      if (generation !== this.#generation) return;
      if (!bytes) {
        this.error = "Ce fichier est introuvable.";
        return;
      }
      if (isImage(bytes.type)) this.url = URL.createObjectURL(bytes);
      this.bytes = bytes;
    } catch (error: unknown) {
      if (generation !== this.#generation) return;
      this.error = explain(error);
    }
  }

  async #drawPdf(bytes: Blob, generation: number) {
    try {
      const pdfjs = await loadPdfjs();
      const task = pdfjs.getDocument({
        data: new Uint8Array(await bytes.arrayBuffer()),
      });
      const pdf = await task.promise;

      try {
        for (let number = 1; number <= pdf.numPages; number += 1) {
          const container = this.pagesEl;
          if (generation !== this.#generation || !container) return;

          const page = await pdf.getPage(number);
          const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
          const width = container.clientWidth || window.innerWidth;
          const viewport = page.getViewport({
            scale: (width / page.getViewport({ scale: 1 }).width) * ratio,
          });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.setAttribute(
            "aria-label",
            `Page ${number} sur ${pdf.numPages}`,
          );
          canvas.setAttribute("role", "img");
          container.append(canvas);
          await page.render({ canvas, viewport }).promise;
        }
      } finally {
        void task.destroy();
      }
    } catch {
      if (generation === this.#generation) {
        this.error = "Ce fichier n’a pas pu être ouvert.";
      }
    }
  }

  #release() {
    this.#generation += 1;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = "";
    this.bytes = null;
    this.error = "";
    this.pagesEl?.replaceChildren();
  }

  #close = () => {
    this.open = false;
    this.dispatchEvent(
      new CustomEvent("viewer-close", { bubbles: true, composed: true }),
    );
  };

  render() {
    return html`
      <app-modal
        full-bleed
        heading=${this.doc?.name ?? "Document"}
        .open=${this.open}
        @modal-close=${this.#close}
      >
        ${this.#renderContent()}
      </app-modal>
    `;
  }

  #renderContent() {
    if (!this.doc) return nothing;
    if (this.error) return html`<p class="viewer__message">${this.error}</p>`;
    if (!this.bytes) return html`<p class="viewer__message">Ouverture…</p>`;

    if (isPdf(this.bytes.type)) {
      return html`<div class="viewer__pages"></div>`;
    }
    if (isImage(this.bytes.type)) {
      return html`<img
        class="viewer__image"
        src=${this.url}
        alt=${this.doc.name}
      />`;
    }
    return html`<p class="viewer__message">${UNSUPPORTED}</p>`;
  }
}

/** Why the bytes could not be had, in words she can act on. */
const explain = (error: unknown): string => {
  if (error instanceof DriveSignedOutError) {
    return "Reconnectez Google Drive pour ouvrir ce fichier.";
  }
  if (error instanceof DriveRequestError && error.status === 0) {
    return "Ce fichier s’ouvrira une fois en ligne.";
  }
  return "Ce fichier n’a pas pu être ouvert.";
};

declare global {
  interface HTMLElementTagNameMap {
    "document-viewer": DocumentViewer;
  }
}
