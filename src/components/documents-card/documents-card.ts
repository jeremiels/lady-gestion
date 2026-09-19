import { css, html, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";
import { appHref } from "../../commons/base-path.ts";
import "../app-icon/app-icon.ts";

/**
 * The same cut-out folder shape the tiles on the documents page wear, so the
 * dashboard's way in and the page it opens read as one thing. Shared as an
 * asset rather than through `app-folder`: that component is a *category* tile
 * and counts documents, this one is a dashboard entry and counts folders.
 */
const folderBgUrl = new URL(
  "../../assets/folder/folder-bg.svg",
  import.meta.url,
).href;

/**
 * The dashboard's way into the document vault.
 *
 * Presentational — the owning view supplies the count, the same split
 * `budget-card` makes.
 */
@customElement("documents-card")
export class DocumentsCard extends BaseElement {
  /** How many folders the vault holds. */
  @property({ type: Number }) folderCount = 0;

  static componentStyles = css`
    :host {
      display: block;
    }

    /* The whole card is the target, and the link text a screen reader
       announces is "Documents" plus the count rather than a "voir" tacked on
       the end — as on budget-card, its neighbour in the same row. */
    .documents__link {
      display: block;
      height: 100%;
      color: inherit;
      text-decoration: none;
      border-radius: var(--radius-12);
    }

    .documents__link:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }

    /* The ratio is the artwork's own, so the notch and the tab keep the
       proportions they were drawn at. The explicit width is load-bearing:
       aspect-ratio resolves in whichever direction is left free, so with only
       min-height set it sized the *width* off the taller neighbour's height
       and the card ran past its grid column.

       min-height, because that neighbour decides the row: the card fills it
       rather than leaving a gap under itself. That is also why the artwork is
       stretched to the box instead of cover as app-folder does — the tile
       there is always exactly 157/110, this one is not, and cover would crop
       the notch off the corner. */
    .documents {
      position: relative;
      width: 100%;
      aspect-ratio: 157 / 110;
      min-height: 100%;
      display: grid;
      justify-items: start;
      gap: var(--spacing-4);
      padding: var(--spacing-16) var(--spacing-16) var(--spacing-12)
        var(--spacing-16);
      background-image: url("${unsafeCSS(folderBgUrl)}");
      background-size: 100% 100%;
      background-repeat: no-repeat;
      box-sizing: border-box;
    }

    .documents__icon {
      width: 2.25rem;
      height: 2.25rem;
      border-radius: var(--radius-8);
      background-color: var(--color-page);
      color: var(--color-brown-dark);
      padding: var(--spacing-8);
      display: grid;
      place-items: center;
    }

    .documents__title {
      font-size: var(--font-size-base);
      line-height: 1.25rem;
      font-weight: 600;
      color: var(--font-color);
    }

    .documents__count {
      font-size: var(--font-size-xs);
      line-height: 0.875rem;
      font-weight: 600;
      color: var(--color-brown-light);
    }
  `;

  render() {
    // An anchor rather than a click handler: the Navigation API intercepts it
    // for free, and where that API is missing this still works as a real page
    // load — the service worker answers any path with the cached shell.
    return html`
      <a class="documents__link pressable" href="${appHref("/documents")}">
        <section class="documents">
          <app-icon class="documents__icon" icon="folder"></app-icon>
          <h2 class="documents__title">Documents</h2>
          <div class="documents__count">
            ${this.folderCount}
            ${this.folderCount === 1 ? "dossier" : "dossiers"}
          </div>
        </section>
      </a>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "documents-card": DocumentsCard;
  }
}
