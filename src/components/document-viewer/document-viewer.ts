import { css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";
import { documentsRepo, isImage, isPdf } from "../../data/index.ts";
import type { StoredDocument } from "../../data/types.ts";

import "../app-modal/app-modal.ts";

/**
 * Full-screen viewer for a stored document.
 *
 * Exists as a component rather than markup in a view because of the object
 * URL: `documentsRepo.getObjectUrl` hands over a URL the caller owns and must
 * revoke, and a missed revoke pins the whole file in memory for the rest of
 * the session. Keeping the create/revoke pair inside one element's lifecycle
 * is the only way that contract stays honoured wherever the viewer is used.
 *
 * The property is `doc`, not `document`: that name shadows the DOM global, the
 * same trap `HorseEvent` exists to avoid for `Event`.
 *
 * @fires viewer-close - No detail. Dismissed by any route the modal offers.
 */
@customElement("document-viewer")
export class DocumentViewer extends BaseElement {
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ attribute: false }) doc: StoredDocument | null = null;

  @state() private url = "";
  @state() private error = "";

  static componentStyles = css`
    :host {
      display: contents;
    }

    /* Fades in when the object URL resolves, rather than replacing the
       "Ouverture…" placeholder at full opacity. The modal has just scaled in
       over \`--duration-medium\`; slamming its contents in a beat later undoes
       that. \`--duration-fast\` and not the modal's own duration: this is the
       tail of an entrance already in progress, not a second one. */
    .viewer__frame {
      width: 100%;
      height: 100%;
      border: none;
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
      .viewer__frame,
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

    .viewer__open {
      display: block;
      padding: var(--spacing-12) var(--spacing-20);
      color: var(--color-white);
      font-size: var(--font-size-sm);
      font-weight: 600;
      text-align: center;
    }
  `;

  protected updated(changed: PropertyValues<this>) {
    if (!changed.has("open") && !changed.has("doc")) return;

    // Swapping documents while open must not keep showing the previous bytes,
    // and must not strand the previous URL — `#load` bails when one is held.
    if (changed.has("doc")) this.#release();

    if (this.open && this.doc) void this.#load(this.doc.id);
    else this.#release();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Navigating away mid-view still has to give the bytes back.
    this.#release();
  }

  async #load(id: string) {
    // Already showing this document: re-minting would leak the URL we hold.
    if (this.url) return;

    try {
      const url = await documentsRepo.getObjectUrl(id);
      if (!url) {
        this.error = "Ce fichier est introuvable.";
        return;
      }
      // `open` may have gone false while the read was in flight. Nothing would
      // ever revoke a URL created after the last release, so do it here.
      if (!this.open) {
        URL.revokeObjectURL(url);
        return;
      }
      this.url = url;
      this.error = "";
    } catch {
      this.error = "Ce fichier n’a pas pu être ouvert.";
    }
  }

  #release() {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = "";
    this.error = "";
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
        ${
          this.url
            ? html`
                <!-- iOS Safari renders a PDF in an iframe as a single page that
                   will not scroll, so on the device this app is built for this
                   link is the only way to reach page 2. Always offered rather
                   than sniffed for: guessing wrong means an unreadable file. -->
                <a
                  slot="footer"
                  class="viewer__open pressable"
                  href=${this.url}
                  target="_blank"
                  rel="noopener"
                >
                  Ouvrir dans un nouvel onglet
                </a>
              `
            : nothing
        }
      </app-modal>
    `;
  }

  #renderContent() {
    const doc = this.doc;
    if (!doc) return nothing;

    if (this.error) return html`<p class="viewer__message">${this.error}</p>`;
    if (!this.url) return html`<p class="viewer__message">Ouverture…</p>`;

    if (isPdf(doc.mimeType)) {
      return html`<iframe
        class="viewer__frame"
        src=${this.url}
        title=${doc.name}
      ></iframe>`;
    }

    if (isImage(doc.mimeType)) {
      return html`<img
        class="viewer__image"
        src=${this.url}
        alt=${doc.name}
      />`;
    }

    // Anything else — a .docx, a .heic Safari won't decode. The footer link is
    // still there, and handing the file to the OS beats a broken frame.
    return html`
      <p class="viewer__message">
        Ce type de fichier ne peut pas être affiché ici. Ouvrez-le dans un
        nouvel onglet.
      </p>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "document-viewer": DocumentViewer;
  }
}
