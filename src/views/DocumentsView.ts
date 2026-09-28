import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { LightElement } from "../commons/base-element.ts";
import { appHref } from "../commons/base-path.ts";
import {
  LiveQuery,
  activeHorseQuery,
  documentFoldersRepo,
  documentsRepo,
  postCategoriesOf,
  type ResolvedCategory,
} from "../data/index.ts";
import type { DocumentFolder, StoredDocument } from "../data/types.ts";
import { DriveConnection } from "../drive/connection.ts";
import { syncDrive } from "../drive/sync.ts";
import { folderPath } from "./DocumentFolderView.ts";

import "../components/app-folder/app-folder.ts";
import "../components/document-list/document-list.ts";
import "../components/document-viewer/document-viewer.ts";
import "../components/drive-folder-sheet/drive-folder-sheet.ts";

@customElement("documents-view")
export class DocumentsView extends LightElement {
  /** The folders directly under the general one, as mirrored from the Drive. */
  #folders = new LiveQuery<DocumentFolder[]>(this, async () =>
    (await documentFoldersRepo.list()).filter(
      (folder) => folder.parentId === null,
    ),
  );

  #counts = activeHorseQuery<Record<string, number>>(
    this,
    (horseId) => documentsRepo.countByFolder(horseId),
    {},
  );

  /** Files put straight in the general folder, under the tiles. */
  #files = new LiveQuery<{
    documents: StoredDocument[];
    categories: Record<string, ResolvedCategory>;
  }>(this, async () => {
    const documents = await documentsRepo.listByFolder(null);
    return { documents, categories: await postCategoriesOf(documents) };
  });

  #drive = new DriveConnection(this);

  @state() private folderSheetOpen = false;
  @state() private viewing: StoredDocument | null = null;

  connectedCallback() {
    super.connectedCallback();
    void syncDrive();
  }

  render() {
    const folders = this.#folders.value ?? [];
    const counts = this.#counts.value ?? {};

    return html`
      <section class="documents-view">
        <hgroup class="section-group">
          <h1 class="page-title" tabindex="-1">Documents</h1>
          <p class="section-subtitle">Coffre-fort de tous les fichiers</p>
        </hgroup>
        ${this.#renderDriveSetup()}
        <ul class="documents-list">
          ${folders.map(
            (folder) => html`
              <li>
                <a
                  class="documents-list__link"
                  href=${appHref(folderPath(folder.id))}
                >
                  <app-folder
                    icon="folder"
                    name=${folder.name}
                    .number=${counts[folder.id] ?? 0}
                  ></app-folder>
                </a>
              </li>
            `,
          )}
        </ul>
        ${this.#renderFiles()}
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

  #renderFiles() {
    const files = this.#files.value;
    if (!files || files.documents.length === 0) return nothing;
    return html`<document-list
      .documents=${files.documents}
      .categories=${files.categories}
      @document-open=${(event: CustomEvent<{ document: StoredDocument }>) => {
        this.viewing = event.detail.document;
      }}
    ></document-list>`;
  }

  /**
   * The two steps before any folder can show: sign in, then pick the general
   * folder. Nothing once both are done — the folders themselves are the page.
   */
  #renderDriveSetup() {
    if (this.#drive.loading) return nothing;

    if (!this.#drive.account) {
      return html`
        <div class="container documents-drive">
          <p class="documents-drive__text">
            Retrouvez ici les documents de votre Google Drive.
          </p>
          <a
            class="documents-drive__button pressable"
            href=${this.#drive.href || nothing}
            target="_blank"
            rel="noopener"
            @click=${this.#drive.onLinkClick}
          >
            Connecter Google Drive
          </a>
        </div>
      `;
    }

    if (this.#drive.folder) return nothing;

    return html`
      <div class="container documents-drive">
        <p class="documents-drive__text">
          Choisissez le dossier de votre Drive où ranger les documents.
        </p>
        <button
          class="documents-drive__button pressable"
          type="button"
          @click=${() => {
            this.folderSheetOpen = true;
          }}
        >
          Choisir le dossier
        </button>
      </div>
      <drive-folder-sheet
        .open=${this.folderSheetOpen}
        @drive-folder-chosen=${this.#closeFolderSheet}
        @sheet-close=${this.#closeFolderSheet}
      ></drive-folder-sheet>
    `;
  }

  #closeFolderSheet = () => {
    this.folderSheetOpen = false;
  };
}
