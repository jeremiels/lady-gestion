import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { LightElement } from "../commons/base-element.ts";
import {
  LiveQuery,
  activeHorseQuery,
  documentFoldersRepo,
  documentsRepo,
} from "../data/index.ts";
import type { DocumentFolder } from "../data/types.ts";
import { DriveConnection } from "../drive/connection.ts";

import "../components/app-folder/app-folder.ts";
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

  #drive = new DriveConnection(this);

  @state() private folderSheetOpen = false;

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
                <app-folder
                  icon="folder"
                  name=${folder.name}
                  .number=${counts[folder.id] ?? 0}
                ></app-folder>
              </li>
            `,
          )}
        </ul>
      </section>
    `;
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
