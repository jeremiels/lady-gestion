import { css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";
import { BaseElement } from "../../commons/base-element.ts";
import {
  formatFileKind,
  formatFileSize,
  type ResolvedCategory,
  type UploadState,
} from "../../data/index.ts";
import type { StoredDocument } from "../../data/types.ts";
import { THEME_META } from "../../theme/theme.ts";
import { tagStyle } from "../app-tag/app-tag.ts";

import "../app-icon/app-icon.ts";
import "../app-tag/app-tag.ts";

/** What a row says of a file joined in the app and not in the Drive yet. */
const UPLOAD_NOTES: Record<UploadState, string> = {
  waiting: "Pas encore envoyé",
  held: "En attente de votre choix",
  local: "Sur ce téléphone seulement",
  refused: "Refusé par Google Drive",
};

/**
 * A folder's files, one card each: what it is, how big, the category of the
 * post it belongs to, and — for one not in the Drive yet — why.
 *
 * Presentational — the owning view reads the documents and their posts'
 * categories, and opens the viewer on `document-open`.
 *
 * @fires document-open - `{ document }`, the row tapped.
 * @fires document-more - `{ document }`, its edit button: rename, move, link,
 * delete.
 */
@customElement("document-list")
export class DocumentList extends BaseElement {
  @property({ attribute: false }) documents: StoredDocument[] = [];
  /** By document id; a document on no post has no entry. */
  @property({ attribute: false }) categories: Record<string, ResolvedCategory> =
    {};
  /** By document id; a document in the Drive has no entry. */
  @property({ attribute: false }) uploads: Record<string, UploadState> = {};

  static componentStyles = css`
    :host {
      display: block;
    }

    ul {
      display: grid;
      gap: var(--spacing-12);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    /* The card holds two targets side by side — open the file, or edit it —
       since one button cannot sit inside another. */
    .card {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      border-radius: var(--radius-16);
      background: var(--color-white);
    }

    .more {
      appearance: none;
      display: grid;
      place-items: center;
      width: 2.75rem;
      height: 2.75rem;
      margin-right: var(--spacing-8);
      padding: 0;
      border: none;
      border-radius: var(--radius-12);
      background: none;
      color: var(--color-brown-light);
      cursor: pointer;
    }

    .more:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }

    .row {
      appearance: none;
      display: grid;
      grid-template-columns: auto 1fr auto;
      grid-template-areas:
        "icon name tag"
        "icon meta tag";
      align-items: center;
      column-gap: var(--spacing-12);
      row-gap: var(--spacing-2);
      width: 100%;
      padding: var(--spacing-16);
      border: none;
      border-radius: var(--radius-16);
      background: none;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .row:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }

    .icon {
      grid-area: icon;
      width: 2.75rem;
      height: 2.75rem;
      border-radius: var(--radius-12);
      background-color: var(--color-brown-light-bg);
      color: var(--color-brown-dark);
    }

    .name {
      grid-area: name;
      font-size: 0.9375rem;
      font-weight: 600;
      color: var(--color-dark);
      /* File names have no spaces to break on. */
      overflow-wrap: anywhere;
    }

    .meta {
      grid-area: meta;
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--color-brown-light);
    }

    app-tag {
      grid-area: tag;
      justify-self: end;
    }
  `;

  #emit(type: "document-open" | "document-more", document: StoredDocument) {
    this.dispatchEvent(
      new CustomEvent(type, {
        detail: { document },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    return html`
      <ul>
        ${repeat(
          this.documents,
          (doc) => doc.id,
          (doc) => {
            const category = this.categories[doc.id];
            return html`
              <li class="card">
                <button
                  class="row pressable"
                  type="button"
                  @click=${() => this.#emit("document-open", doc)}
                >
                  <app-icon class="icon" icon="file"></app-icon>
                  <span class="name">${doc.name}</span>
                  <span class="meta">${this.#meta(doc)}</span>
                  ${
                    category
                      ? html`<app-tag
                          label=${category.label}
                          style=${styleMap(tagStyle(THEME_META[category.theme]))}
                        ></app-tag>`
                      : nothing
                  }
                </button>
                <button
                  class="more pressable"
                  type="button"
                  aria-label=${`Modifier ${doc.name}`}
                  @click=${() => this.#emit("document-more", doc)}
                >
                  <app-icon icon="edit"></app-icon>
                </button>
              </li>
            `;
          },
        )}
      </ul>
    `;
  }

  /**
   * `PDF • 1,2 mo`; a Google Doc has no size of its own, so just its kind.
   * Then why it is not in the Drive yet, if it is not.
   */
  #meta(doc: StoredDocument): string {
    const upload = this.uploads[doc.id];
    return [
      formatFileKind(doc.mimeType),
      ...(doc.size > 0 ? [formatFileSize(doc.size)] : []),
      ...(upload ? [UPLOAD_NOTES[upload]] : []),
    ].join(" • ");
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "document-list": DocumentList;
  }
}
