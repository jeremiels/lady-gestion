import { css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";
import { documentsService, errorMessage } from "../../data/index.ts";
import type { DocumentFolder } from "../../data/types.ts";
import { syncDrive } from "../../drive/sync.ts";
import type { AppInput } from "../app-input/app-input.ts";

import "../app-bottom-sheet/app-bottom-sheet.ts";
import "../app-input/app-input.ts";

/**
 * What deleting does to the folder: to the Drive's trash, or — for one made in
 * the app and not in the Drive yet — off this phone, the only place it is.
 */
const deletionNotice = (folder: DocumentFolder): string =>
  folder.driveFolderId === null
    ? `« ${folder.name} » n’est pas dans votre Google Drive : il sera supprimé de ce téléphone.`
    : `« ${folder.name} » partira dans la corbeille de votre Google Drive, où il reste récupérable 30 jours.`;

/**
 * A folder of her Drive, from the app: a new one inside `parentId`, or — with
 * `folder` set — renaming or deleting that one. Written on the device first
 * and sent to the Drive by the sync (`documentsService`, `syncDrive`).
 *
 * @fires folder-sheet-done - `{ deleted }`, once a change is saved. The owner
 * clears `open`, and leaves a deleted folder's page.
 * @fires sheet-close - From the inner `app-bottom-sheet`, on dismissal.
 */
@customElement("folder-sheet")
export class FolderSheet extends BaseElement {
  @property({ type: Boolean }) open = false;
  /** The folder to rename or delete; `null` to create one. */
  @property({ attribute: false }) folder: DocumentFolder | null = null;
  /** Where a new folder goes; `null` for the general folder itself. */
  @property({ attribute: false }) parentId: string | null = null;

  @state() private error = "";
  @state() private busy = false;
  @state() private confirmingDelete = false;

  static componentStyles = css`
    :host {
      display: contents;
    }

    .step {
      display: grid;
      gap: var(--spacing-12);
    }

    .step p {
      margin: 0;
    }

    .button {
      appearance: none;
      width: 100%;
      padding: var(--spacing-12) var(--spacing-16);
      border: none;
      border-radius: var(--radius-8);
      background: var(--color-brown-dark);
      color: var(--color-white);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }

    .button--ghost {
      background: none;
      color: var(--color-danger);
    }

    .button--danger {
      background: var(--color-danger);
    }

    .button:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .error {
      margin: 0;
      color: var(--color-danger);
    }
  `;

  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has("open") && this.open) {
      this.error = "";
      this.confirmingDelete = false;
    }
  }

  async #save(action: () => Promise<unknown>, deleted = false) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      await action();
      void syncDrive(true);
      this.dispatchEvent(
        new CustomEvent("folder-sheet-done", {
          detail: { deleted },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error: unknown) {
      this.error = errorMessage(error, "Modification impossible.");
    } finally {
      this.busy = false;
    }
  }

  #name = () =>
    this.renderRoot.querySelector<AppInput>("app-input")?.value ?? "";

  render() {
    const folder = this.folder;
    return html`
      <app-bottom-sheet
        heading=${folder ? folder.name : "Nouveau dossier"}
        .open=${this.open}
      >
        ${this.open ? (folder ? this.#renderEdit(folder) : this.#renderCreate()) : nothing}
      </app-bottom-sheet>
    `;
  }

  #renderCreate() {
    return html`
      <div class="step">
        <app-input label="Nom du dossier"></app-input>
        ${this.#renderError()}
        <button
          class="button pressable"
          type="button"
          ?disabled=${this.busy}
          @click=${() =>
            this.#save(() =>
              documentsService.createFolder(this.#name(), this.parentId),
            )}
        >
          Créer
        </button>
      </div>
    `;
  }

  #renderEdit(folder: DocumentFolder) {
    if (this.confirmingDelete) {
      return html`
        <div class="step">
          <p>${deletionNotice(folder)}</p>
          ${this.#renderError()}
          <button
            class="button button--danger pressable"
            type="button"
            ?disabled=${this.busy}
            @click=${() =>
              this.#save(() => documentsService.deleteFolder(folder.id), true)}
          >
            Supprimer
          </button>
        </div>
      `;
    }
    return html`
      <div class="step">
        <app-input label="Nom du dossier" .value=${folder.name}></app-input>
        ${this.#renderError()}
        <button
          class="button pressable"
          type="button"
          ?disabled=${this.busy}
          @click=${() =>
            this.#save(() =>
              documentsService.renameFolder(folder.id, this.#name()),
            )}
        >
          Renommer
        </button>
        <button
          class="button button--ghost pressable"
          type="button"
          @click=${() => {
            this.confirmingDelete = true;
            this.error = "";
          }}
        >
          Supprimer le dossier
        </button>
      </div>
    `;
  }

  #renderError() {
    return this.error
      ? html`<p class="error" role="alert">${this.error}</p>`
      : nothing;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "folder-sheet": FolderSheet;
  }
}
