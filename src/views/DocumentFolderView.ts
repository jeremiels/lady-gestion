import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { LightElement } from "../commons/base-element.ts";
import { appHref } from "../commons/base-path.ts";
import { goBack } from "../commons/navigation.ts";
import {
  LiveQuery,
  activeHorseQuery,
  documentFoldersRepo,
  documentsRepo,
  postCategoriesOf,
  type ResolvedCategory,
} from "../data/index.ts";
import type { DocumentFolder, StoredDocument } from "../data/types.ts";
import { syncDrive } from "../drive/sync.ts";

import "../components/app-folder/app-folder.ts";
import "../components/app-icon/app-icon.ts";
import "../components/document-list/document-list.ts";
import "../components/document-viewer/document-viewer.ts";

/** The address of a folder's page; `/documents` is the general folder's. */
export const folderPath = (folderId: string | null): string =>
  folderId === null ? "/documents" : `/documents/${folderId}`;

/**
 * One folder of her Drive: the folders inside it, then its files.
 *
 * Reads the mirror only (`drive-mirror.ts`); the Drive is walked by
 * `syncDrive`, nudged on opening.
 */
@customElement("document-folder-view")
export class DocumentFolderView extends LightElement {
  /** Keyed by path in the route table, so it never changes for one element. */
  @property({ attribute: false }) folderId = "";

  @state() private viewing: StoredDocument | null = null;

  #folder = new LiveQuery<DocumentFolder | undefined>(this, () =>
    documentFoldersRepo.get(this.folderId),
  );

  #subfolders = new LiveQuery<DocumentFolder[]>(this, async () =>
    (await documentFoldersRepo.list()).filter(
      (folder) => folder.parentId === this.folderId,
    ),
  );

  #files = new LiveQuery<{
    documents: StoredDocument[];
    categories: Record<string, ResolvedCategory>;
  }>(this, async () => {
    const documents = await documentsRepo.listByFolder(this.folderId);
    return { documents, categories: await postCategoriesOf(documents) };
  });

  #counts = activeHorseQuery<Record<string, number>>(
    this,
    (horseId) => documentsRepo.countByFolder(horseId),
    {},
  );

  connectedCallback() {
    super.connectedCallback();
    void syncDrive();
  }

  #goBack = () => goBack(folderPath(this.#folder.value?.parentId ?? null));

  render() {
    const folder = this.#folder.value;
    if (!folder && !this.#folder.loading) {
      return html`
        <section class="document-folder">
          <p class="document-folder__empty">Ce dossier n’existe plus.</p>
          <a
            class="document-folder__back-link pressable"
            href=${appHref("/documents")}
            >Retour aux documents</a
          >
        </section>
      `;
    }

    const subfolders = this.#subfolders.value ?? [];
    const files = this.#files.value;
    const counts = this.#counts.value ?? {};

    return html`
      <section class="document-folder">
        <header class="document-folder__header">
          <button
            class="document-folder__back pressable pressable--small"
            type="button"
            aria-label="Retour"
            @click=${this.#goBack}
          >
            <app-icon icon="chevronLeft"></app-icon>
          </button>
          <h1 class="document-folder__title" tabindex="-1">
            ${folder?.name ?? ""}
          </h1>
        </header>

        ${
          subfolders.length > 0
            ? html`<ul class="documents-list">
                ${subfolders.map(
                  (child) => html`
                    <li>
                      <a
                        class="documents-list__link"
                        href=${appHref(folderPath(child.id))}
                      >
                        <app-folder
                          icon="folder"
                          name=${child.name}
                          .number=${counts[child.id] ?? 0}
                        ></app-folder>
                      </a>
                    </li>
                  `,
                )}
              </ul>`
            : nothing
        }
        ${
          files && files.documents.length > 0
            ? html`<document-list
                .documents=${files.documents}
                .categories=${files.categories}
                @document-open=${(
                  event: CustomEvent<{ document: StoredDocument }>,
                ) => {
                  this.viewing = event.detail.document;
                }}
              ></document-list>`
            : nothing
        }
        ${
          files && files.documents.length === 0 && subfolders.length === 0
            ? html`<p class="document-folder__empty">Ce dossier est vide.</p>`
            : nothing
        }
      </section>
      <document-viewer
        .open=${this.viewing !== null}
        .doc=${this.viewing}
        @viewer-close=${() => {
          this.viewing = null;
        }}
      ></document-viewer>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "document-folder-view": DocumentFolderView;
  }
}
