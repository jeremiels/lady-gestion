import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { LightElement } from "../commons/base-element.ts";
import { appHref } from "../commons/base-path.ts";
import {
  LiveQuery,
  activeHorseQuery,
  documentFoldersRepo,
  documentsRepo,
  driveMirrorService,
  errorMessage,
  metaRepo,
  postCategoriesOf,
  uploadStatesOf,
  type ResolvedCategory,
  type UploadState,
} from "../data/index.ts";
import type {
  DocumentFolder,
  DriveMeta,
  StoredDocument,
} from "../data/types.ts";
import { DriveConnection } from "../drive/connection.ts";
import { syncDrive } from "../drive/sync.ts";
import { folderPath } from "./DocumentFolderView.ts";

import "../components/app-folder/app-folder.ts";
import "../components/document-list/document-list.ts";
import "../components/document-actions-sheet/document-actions-sheet.ts";
import "../components/document-viewer/document-viewer.ts";
import "../components/drive-folder-sheet/drive-folder-sheet.ts";
import "../components/folder-sheet/folder-sheet.ts";

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
    uploads: Record<string, UploadState>;
  }>(this, async () => {
    const documents = await documentsRepo.listByFolder(null);
    return {
      documents,
      categories: await postCategoriesOf(documents),
      uploads: await uploadStatesOf(documents),
    };
  });

  #drive = new DriveConnection(this);

  /** What stood in the way of the last sync, if anything (`syncDrive`). */
  #syncProblem = new LiveQuery<DriveMeta["driveSyncProblem"] | undefined>(
    this,
    () => metaRepo.get<DriveMeta["driveSyncProblem"]>("driveSyncProblem"),
  );

  /** Made in the app for a general folder she has left: hers to send or keep. */
  #heldBack = new LiveQuery<number>(this, () =>
    driveMirrorService.countHeldBack(),
  );

  @state() private folderSheetOpen = false;
  @state() private viewing: StoredDocument | null = null;
  /** The file whose edit button was tapped. */
  @state() private acting: StoredDocument | null = null;
  @state() private creatingFolder = false;
  @state() private settlingHeldBack = false;
  @state() private heldBackError = "";

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
        ${this.#renderDriveSetup()} ${this.#renderSyncProblem()}
        ${this.#renderHeldBack()}
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
        ${
          this.#drive.folder
            ? html`<button
                class="documents-new-folder pressable"
                type="button"
                @click=${() => {
                  this.creatingFolder = true;
                }}
              >
                Nouveau dossier
              </button>`
            : nothing
        }
      </section>
      <folder-sheet
        .open=${this.creatingFolder}
        .parentId=${null}
        @folder-sheet-done=${this.#closeFolderEditor}
        @sheet-close=${this.#closeFolderEditor}
      ></folder-sheet>
      <document-actions-sheet
        .open=${this.acting !== null}
        .doc=${this.acting}
        @document-actions-done=${this.#closeActions}
        @sheet-close=${this.#closeActions}
      ></document-actions-sheet>
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
      .uploads=${files.uploads}
      @document-open=${(event: CustomEvent<{ document: StoredDocument }>) => {
        this.viewing = event.detail.document;
      }}
      @document-more=${(event: CustomEvent<{ document: StoredDocument }>) => {
        this.acting = event.detail.document;
      }}
    ></document-list>`;
  }

  #closeActions = () => {
    this.acting = null;
  };

  #closeFolderEditor = () => {
    this.creatingFolder = false;
  };

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

  /**
   * Why the page may not be what her Drive holds now: the last sync did not
   * go through, for a reason that will not pass on its own. Nothing while
   * offline — the page is then as of the last sync, as it always is.
   */
  #renderSyncProblem() {
    const problem = this.#syncProblem.value;
    const folder = this.#drive.folder;
    if (!problem || !this.#drive.account || !folder) return nothing;
    const text =
      problem === "trashed"
        ? `Le dossier « ${folder.name} » est dans la corbeille de votre Google Drive. Sortez-le de la corbeille pour retrouver vos documents à jour.`
        : "La synchronisation avec Google Drive n’a pas abouti. Vos documents sont ceux de la dernière synchronisation réussie.";
    return html`
      <div class="container documents-drive">
        <p class="documents-drive__text" role="status">${text}</p>
      </div>
    `;
  }

  /**
   * What was made in the app for the previous general folder and is not in
   * the Drive yet: changing folder sends nothing to the new one on its own,
   * so she says whether it goes there or stays on this phone.
   */
  #renderHeldBack() {
    const count = this.#heldBack.value ?? 0;
    if (count === 0 || !this.#drive.account || !this.#drive.folder) {
      return nothing;
    }
    return html`
      <div class="container documents-drive">
        <p class="documents-drive__text">
          ${
            count === 1
              ? "Un élément ajouté pour votre ancien dossier n’est pas encore dans votre Drive."
              : `${count} éléments ajoutés pour votre ancien dossier ne sont pas encore dans votre Drive.`
          }
        </p>
        <button
          class="documents-drive__button pressable"
          type="button"
          ?disabled=${this.settlingHeldBack}
          @click=${() => this.#settleHeldBack(true)}
        >
          Les envoyer dans « ${this.#drive.folder.name} »
        </button>
        <button
          class="documents-drive__button pressable"
          type="button"
          ?disabled=${this.settlingHeldBack}
          @click=${() => this.#settleHeldBack(false)}
        >
          Les garder sur ce téléphone
        </button>
        ${
          this.heldBackError
            ? html`<p class="documents-drive__text" role="alert">
                ${this.heldBackError}
              </p>`
            : nothing
        }
      </div>
    `;
  }

  async #settleHeldBack(send: boolean) {
    if (this.settlingHeldBack) return;
    this.settlingHeldBack = true;
    this.heldBackError = "";
    try {
      await driveMirrorService.settleHeldBack(send);
      if (send) void syncDrive(true);
    } catch (error: unknown) {
      this.heldBackError = errorMessage(error, "Modification impossible.");
    } finally {
      this.settlingHeldBack = false;
    }
  }

  #closeFolderSheet = () => {
    this.folderSheetOpen = false;
  };
}
