import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";
import { LightElement } from "../commons/base-element.ts";
import { goBack, navigateTo } from "../commons/navigation.ts";
import {
  categoriesRepo,
  findCategory,
  LiveQuery,
  documentFoldersRepo,
  documentsRepo,
  postInfoRows,
  postsRepo,
  postsService,
  formatFileKind,
  formatFileSize,
  shareSummary,
  type ResolvedCategory,
} from "../data/index.ts";
import type { DocumentFolder, Post, StoredDocument } from "../data/types.ts";
import { documentBytes } from "../drive/sync.ts";
import { THEME_META } from "../theme/theme.ts";
import type { IconName } from "../components/app-icon/icons.ts";

import "../components/app-icon/app-icon.ts";
import { tagStyle } from "../components/app-tag/app-tag.ts";
import "../components/app-modal/app-modal.ts";
import "../components/document-viewer/document-viewer.ts";
import "../components/post-sheet/post-sheet.ts";

/** Where back falls to, and where a delete lands. */
const POSTS_LIST = "/posts";

/** One row of the Informations card. `null` values are dropped, not shown blank. */
type InfoRow = { label: string; value: TemplateResult | string };

@customElement("post-detail-view")
export class PostDetailView extends LightElement {
  /** Sliced out of the pathname by the route table; nothing else parses the URL. */
  @property({ attribute: false }) postId = "";

  @state() private editOpen = false;
  @state() private deleteOpen = false;
  @state() private viewing: StoredDocument | null = null;
  @state() private actionError = "";

  // Both read `this.postId`, which never changes for a given element: the
  // route keys this view by path, so a different event is a different element.
  #event = new LiveQuery(this, () => postsRepo.getVisible(this.postId));
  #documents = new LiveQuery<StoredDocument[]>(this, () =>
    documentsRepo.listByPost(this.postId),
  );
  #categories = new LiveQuery<ResolvedCategory[]>(this, () =>
    categoriesRepo.listEnabled(),
  );
  #folders = new LiveQuery<DocumentFolder[]>(this, () =>
    documentFoldersRepo.list(),
  );

  /** The document whose bytes were last fetched ahead of "Partager". */
  #fetchedAhead: string | null = null;

  /** Back to the calendar or the list, whichever this was opened from. */
  #goBack = () => goBack(POSTS_LIST);

  protected updated() {
    // "Partager" hands over the first file. Its bytes are fetched as soon as
    // it is known, so the tap finds them on the device: a download awaited
    // inside the tap can outlast the user activation iOS requires for
    // `navigator.share`. Offline or signed out, the share falls back to text.
    const doc = this.#documents.value?.[0];
    if (doc && doc.id !== this.#fetchedAhead) {
      this.#fetchedAhead = doc.id;
      void documentBytes(doc).catch(() => {});
    }
  }

  render() {
    if (this.#event.loading) {
      return html`<section class="post-detail">
        <p class="post-detail__empty">Chargement…</p>
      </section>`;
    }

    const event = this.#event.value;
    // A failed read is not a deleted event: "Il a peut-être été supprimé"
    // would send the user to type it in again.
    if (!event && this.#event.error) return this.#renderUnreadable();
    if (!event) return this.#renderNotFound();
    const type = findCategory(this.#categories.value ?? [], event.categoryKey);

    return html`
      <section class="post-detail">
        <header class="post-detail__header">
          <button
            class="post-detail__back pressable pressable--small"
            type="button"
            aria-label="Retour"
            @click=${this.#goBack}
          >
            <app-icon icon="chevronLeft"></app-icon>
          </button>
          <h1 class="post-detail__title" tabindex="-1">${event.title}</h1>
        </header>

        <section class="post-detail__section">
          <h2 class="section-title-small">Informations</h2>
          <!-- The card is a wrapper, not the list itself: .meta-list zeroes its
               own padding and sits in a later sub-layer than .container, so
               putting both on one element silently drops the card's inset. -->
          <div class="container">
            <ul class="meta-list">
              ${this.#infoRows(event, type).map(
                (row) => html`
                  <li class="meta-item">
                    <span class="meta-label">${row.label}</span>
                    <span class="meta-value">${row.value}</span>
                  </li>
                `,
              )}
            </ul>
          </div>
        </section>

        ${this.#renderDocuments()}

        <section class="post-detail__section">
          <h2 class="section-title-small">Actions</h2>
          <div class="container">
            <ul class="post-detail__actions">
              ${this.#renderActions(event, type)}
            </ul>
          </div>
          <!--
            Mounted with the section and never hidden — only its contents
            change. A \`role="alert"\` element that enters the accessibility
            tree at the moment it has something to say is typically announced as
            nothing, and \`hidden\` takes a region out of that tree just as
            surely as never rendering it. Same shape as \`app-update-toast\`'s
            status region and \`post-sheet\`'s.
          -->
          <div class="post-detail__error-region" role="alert">
            ${
              this.actionError
                ? html`<p class="post-detail__error">${this.actionError}</p>`
                : nothing
            }
          </div>
        </section>
      </section>

      ${this.#renderOverlays(event)}
    `;
  }

  #renderUnreadable() {
    return html`
      <section class="post-detail">
        <hgroup class="section-group">
          <h1 class="page-title" tabindex="-1">Lecture impossible</h1>
          <p class="section-subtitle">
            Cet évènement n’a pas pu être lu. Rechargez l’application.
          </p>
        </hgroup>
        <button
          class="post-detail__back-link pressable"
          type="button"
          @click=${this.#goBack}
        >
          Retour
        </button>
      </section>
    `;
  }

  #renderNotFound() {
    return html`
      <section class="post-detail">
        <hgroup class="section-group">
          <h1 class="page-title" tabindex="-1">Évènement introuvable</h1>
          <p class="section-subtitle">Il a peut-être été supprimé.</p>
        </hgroup>
        <button
          class="post-detail__back-link pressable"
          type="button"
          @click=${this.#goBack}
        >
          Retour
        </button>
      </section>
    `;
  }

  /**
   * The Informations card: the type, as a tag, then `postInfoRows`
   * (`post-views.ts`), which owns which rows a post shows.
   */
  #infoRows(event: Post, type: ResolvedCategory | undefined): InfoRow[] {
    return [
      // `app-tag` resolves both the label and the colours from the type alone.
      {
        label: "Type",
        value: html`<app-tag
          label=${type?.label ?? ""}
          style=${styleMap(type ? tagStyle(THEME_META[type.theme]) : {})}
        ></app-tag>`,
      },
      ...postInfoRows(event, type),
    ];
  }

  #renderDocuments() {
    const documents = this.#documents.value ?? [];
    if (documents.length === 0) return nothing;
    const folders = this.#folders.value ?? [];

    return html`
      <ul class="post-detail__files">
        ${repeat(
          documents,
          (doc) => doc.id,
          (doc) => html`
            <li>
              <button
                class="container post-detail__file pressable"
                type="button"
                @click=${() => this.#openViewer(doc)}
              >
                <app-icon class="post-detail__file-icon" icon="file"></app-icon>
                <span class="post-detail__file-name">${doc.name}</span>
                <span class="post-detail__file-meta">
                  ${formatFileKind(doc.mimeType)} • ${formatFileSize(doc.size)}
                </span>
                ${this.#renderFolderTag(folders, doc)}
              </button>
            </li>
          `,
        )}
      </ul>
    `;
  }

  /** The folder the file is filed in; none for the general folder itself. */
  #renderFolderTag(folders: DocumentFolder[], doc: StoredDocument) {
    const folder = folders.find(({ id }) => id === doc.folderId);
    if (!folder) return nothing;
    return html`<app-tag
      class="post-detail__file-tag"
      label=${folder.name}
    ></app-tag>`;
  }

  #renderActions(event: Post, type: ResolvedCategory | undefined) {
    const doc = this.#documents.value?.[0] ?? null;

    return html`
      ${this.#renderAction({
        icon: "download",
        label: "Télécharger",
        // Deliberately inert: the file lives only in IndexedDB until Drive sync
        // exists, so there is nothing to download *from the drive* yet.
        hint: "Bientôt disponible",
        disabled: true,
      })}
      ${this.#renderAction({
        icon: "pen",
        label: "Modifier",
        onClick: () => {
          this.editOpen = true;
        },
      })}
      ${
        // Hidden rather than disabled where the API is missing: an action that
        // throws on tap is worse than one that was never offered.
        "share" in navigator
          ? this.#renderAction({
              icon: "share",
              label: "Partager",
              onClick: () => void this.#share(event, type, doc),
            })
          : nothing
      }
      ${this.#renderAction({
        icon: "trash",
        label: "Supprimer",
        destructive: true,
        onClick: () => {
          this.deleteOpen = true;
        },
      })}
    `;
  }

  #renderAction(action: {
    icon: IconName;
    label: string;
    hint?: string;
    disabled?: boolean;
    destructive?: boolean;
    onClick?: () => void;
  }) {
    return html`
      <li>
        <button
          class="post-detail__action pressable ${action.destructive ? "post-detail__action--danger" : ""}"
          type="button"
          ?disabled=${action.disabled ?? false}
          @click=${action.onClick}
        >
          <app-icon
            class="post-detail__action-icon"
            icon=${action.icon}
          ></app-icon>
          <span class="post-detail__action-label">${action.label}</span>
          ${
            action.hint
              ? html`<span class="post-detail__action-hint"
                  >${action.hint}</span
                >`
              : nothing
          }
        </button>
      </li>
    `;
  }

  #renderOverlays(event: Post) {
    return html`
      <post-sheet
        .post=${event}
        .open=${this.editOpen}
        @sheet-close=${() => {
          this.editOpen = false;
        }}
      ></post-sheet>

      <document-viewer
        .doc=${this.viewing}
        .open=${this.viewing !== null}
        @viewer-close=${() => {
          this.viewing = null;
        }}
      ></document-viewer>

      <app-modal
        heading="Supprimer l’évènement ?"
        description=${`« ${event.title} » sera retiré du calendrier et des dépenses.`}
        .open=${this.deleteOpen}
        @modal-close=${() => {
          this.deleteOpen = false;
        }}
      >
        <p class="post-detail__confirm">
          Les fichiers qui y sont attachés restent dans vos documents.
        </p>
        <div slot="footer" class="post-detail__confirm-actions">
          <button
            class="post-detail__button"
            type="button"
            @click=${() => {
              this.deleteOpen = false;
            }}
          >
            Annuler
          </button>
          <button
            class="post-detail__button post-detail__button--danger"
            type="button"
            @click=${this.#confirmDelete}
          >
            Supprimer
          </button>
        </div>
      </app-modal>
    `;
  }

  #openViewer(doc: StoredDocument) {
    this.viewing = doc;
  }

  /**
   * Hands the file to the OS share sheet when it can take one, and a written
   * summary when it can't — a vet report shared without the actual PDF is the
   * less useful half, but it beats an action that silently does nothing.
   */
  async #share(
    event: Post,
    type: ResolvedCategory | undefined,
    doc: StoredDocument | null,
  ) {
    this.actionError = "";

    const summary = shareSummary(event, type);

    try {
      const file = doc && (await this.#toFile(doc));
      // `canShare` is what decides, not the presence of a file: iOS refuses
      // some types outright, and `share` would reject rather than degrade.
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: event.title,
          text: summary,
        });
      } else {
        await navigator.share({ title: event.title, text: summary });
      }
    } catch (error: unknown) {
      // Dismissing the OS sheet rejects with AbortError. That is the user
      // saying no, not a failure, and must not surface as one.
      if (error instanceof DOMException && error.name === "AbortError") return;
      this.actionError = "Le partage n’a pas abouti.";
    }
  }

  /**
   * The file as the share sheet takes it — from the Drive when not on the
   * device yet. Typed by its bytes rather than its row: a Google Doc arrives
   * as the PDF Drive exports it to.
   */
  async #toFile(doc: StoredDocument): Promise<File | null> {
    const blob = await documentBytes(doc).catch(() => undefined);
    return blob ? new File([blob], doc.name, { type: blob.type }) : null;
  }

  #confirmDelete = async () => {
    this.deleteOpen = false;
    try {
      await postsService.deletePost(this.postId);
    } catch {
      this.actionError = "La suppression a échoué.";
      return;
    }
    // The record is gone from every read path, so staying here would only show
    // this view's own not-found state.
    navigateTo(POSTS_LIST);
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "post-detail-view": PostDetailView;
  }
}
