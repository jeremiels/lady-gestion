import { css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";
import {
  LiveQuery,
  activeHorseQuery,
  documentFoldersRepo,
  documentsService,
  errorMessage,
  folderOptions,
  formatDateMedium,
  postsRepo,
} from "../../data/index.ts";
import type { IsoDate } from "../../data/dates.ts";
import type { DocumentFolder, Post, StoredDocument } from "../../data/types.ts";
import { syncDrive } from "../../drive/sync.ts";
import type { AppInput } from "../app-input/app-input.ts";

import "../app-bottom-sheet/app-bottom-sheet.ts";
import "../app-input/app-input.ts";
import "../app-select/app-select.ts";

type Mode = "menu" | "rename" | "move" | "link" | "delete";

/**
 * What deleting does to the file. One in the Drive goes to its trash; one not
 * there yet has its only copy on this phone, and that goes for good.
 */
const deletionNotice = (doc: StoredDocument): string =>
  doc.driveFileId === null
    ? `« ${doc.name} » n’est pas dans votre Google Drive : il sera supprimé de ce téléphone, sans pouvoir être récupéré.`
    : `« ${doc.name} » partira dans la corbeille de votre Google Drive, où il reste récupérable 30 jours.`;

/**
 * What can be done to one file from the app: rename it, move it to another
 * folder, attach it to a post, delete it. Each is written on the device at
 * once and sent to the Drive by the sync (`documentsService`, `syncDrive`).
 *
 * One sheet, one step at a time: the menu, then the step picked.
 *
 * @fires document-actions-done - No detail, once a change is saved. The owner
 * clears `open`.
 * @fires sheet-close - From the inner `app-bottom-sheet`, on dismissal.
 */
@customElement("document-actions-sheet")
export class DocumentActionsSheet extends BaseElement {
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) doc: StoredDocument | null = null;

  @state() private mode: Mode = "menu";
  @state() private choice = "";
  @state() private error = "";
  @state() private busy = false;

  #folders = new LiveQuery<DocumentFolder[]>(this, () =>
    documentFoldersRepo.list(),
  );

  #posts = activeHorseQuery<Post[]>(
    this,
    (horseId) => postsRepo.listByHorse(horseId),
    [],
  );

  static componentStyles = css`
    :host {
      display: contents;
    }

    .actions {
      display: grid;
      gap: var(--spacing-8);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .action,
    .confirm {
      appearance: none;
      width: 100%;
      padding: var(--spacing-12) var(--spacing-16);
      border: none;
      border-radius: var(--radius-8);
      background: var(--color-white);
      color: var(--color-brown-dark);
      font: inherit;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
    }

    .action--danger {
      color: var(--color-danger);
    }

    .step {
      display: grid;
      gap: var(--spacing-12);
    }

    .step p {
      margin: 0;
    }

    .confirm {
      text-align: center;
      background: var(--color-brown-dark);
      color: var(--color-white);
    }

    .confirm--danger {
      background: var(--color-danger);
    }

    .confirm:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .error {
      margin: 0;
      color: var(--color-danger);
    }
  `;

  protected willUpdate(changed: PropertyValues<this>) {
    if ((changed.has("open") || changed.has("doc")) && this.open) {
      this.mode = "menu";
      this.error = "";
    }
  }

  #step(mode: Mode) {
    this.mode = mode;
    this.error = "";
    this.choice =
      mode === "move"
        ? (this.doc?.folderId ?? "")
        : mode === "link"
          ? (this.doc?.postId ?? "")
          : "";
  }

  async #save(action: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      await action();
      void syncDrive(true);
      this.dispatchEvent(
        new CustomEvent("document-actions-done", {
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

  render() {
    return html`
      <app-bottom-sheet
        heading=${this.doc?.name ?? "Document"}
        .open=${this.open}
      >
        ${this.open && this.doc ? this.#renderStep(this.doc) : nothing}
      </app-bottom-sheet>
    `;
  }

  #renderStep(doc: StoredDocument) {
    switch (this.mode) {
      case "menu":
        return html`
          <ul class="actions">
            <li>
              <button
                class="action pressable"
                type="button"
                @click=${() => this.#step("rename")}
              >
                Renommer
              </button>
            </li>
            <li>
              <button
                class="action pressable"
                type="button"
                @click=${() => this.#step("move")}
              >
                Déplacer
              </button>
            </li>
            <li>
              <button
                class="action pressable"
                type="button"
                @click=${() => this.#step("link")}
              >
                Lier à un évènement
              </button>
            </li>
            ${
              doc.driveFileId === null && doc.uploadRefused === doc.updatedAt
                ? html`<li>
                    <button
                      class="action pressable"
                      type="button"
                      ?disabled=${this.busy}
                      @click=${() =>
                        this.#save(() => documentsService.retryUpload(doc.id))}
                    >
                      Réessayer l’envoi
                    </button>
                  </li>`
                : nothing
            }
            <li>
              <button
                class="action action--danger pressable"
                type="button"
                @click=${() => this.#step("delete")}
              >
                Supprimer
              </button>
            </li>
          </ul>
        `;
      case "rename":
        return html`
          <div class="step">
            <app-input label="Nom du fichier" .value=${doc.name}></app-input>
            ${this.#renderError()}
            <button
              class="confirm pressable"
              type="button"
              ?disabled=${this.busy}
              @click=${() => {
                const input =
                  this.renderRoot.querySelector<AppInput>("app-input");
                void this.#save(() =>
                  documentsService.renameDocument(doc.id, input?.value ?? ""),
                );
              }}
            >
              Renommer
            </button>
          </div>
        `;
      case "move":
        return html`
          <div class="step">
            <app-select
              label="Dossier"
              .options=${folderOptions(this.#folders.value ?? [])}
              .value=${this.choice}
              @select-change=${(event: CustomEvent<{ value: string }>) => {
                this.choice = event.detail.value;
              }}
            ></app-select>
            ${this.#renderError()}
            <button
              class="confirm pressable"
              type="button"
              ?disabled=${this.busy}
              @click=${() =>
                this.#save(() =>
                  documentsService.moveDocument(doc.id, this.choice || null),
                )}
            >
              Déplacer
            </button>
          </div>
        `;
      case "link":
        return html`
          <div class="step">
            <app-select
              label="Évènement"
              .options=${[
                { value: "", label: "Aucun" },
                ...(this.#posts.value ?? []).map((post) => ({
                  value: post.id,
                  label: `${formatDateMedium(post.date as IsoDate)} · ${post.title}`,
                })),
              ]}
              .value=${this.choice}
              @select-change=${(event: CustomEvent<{ value: string }>) => {
                this.choice = event.detail.value;
              }}
            ></app-select>
            ${this.#renderError()}
            <button
              class="confirm pressable"
              type="button"
              ?disabled=${this.busy}
              @click=${() =>
                this.#save(() =>
                  documentsService.linkDocument(doc.id, this.choice || null),
                )}
            >
              Enregistrer
            </button>
          </div>
        `;
      case "delete":
        return html`
          <div class="step">
            <p>${deletionNotice(doc)}</p>
            ${this.#renderError()}
            <button
              class="confirm confirm--danger pressable"
              type="button"
              ?disabled=${this.busy}
              @click=${() =>
                this.#save(() => documentsService.deleteDocument(doc.id))}
            >
              Supprimer
            </button>
          </div>
        `;
    }
  }

  #renderError() {
    return this.error
      ? html`<p class="error" role="alert">${this.error}</p>`
      : nothing;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "document-actions-sheet": DocumentActionsSheet;
  }
}
