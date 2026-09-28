import { css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { BaseElement } from "../../commons/base-element.ts";
import {
  MY_DRIVE,
  createFolder,
  listFolders,
  type DriveFolder,
} from "../../drive/api.ts";
import { chooseFolder, DriveSignedOutError } from "../../drive/auth.ts";

import "../app-bottom-sheet/app-bottom-sheet.ts";
import "../app-icon/app-icon.ts";

/** Proposed for a folder created at the top of "Mon Drive". */
const SUGGESTED_NAME = "ladympala";

/**
 * Picks the general folder: the one folder of her Drive the app shows
 * (`docs/drive-spec.md` D8). Browses from the top of "Mon Drive", down as many
 * levels as there are, and can create a folder where it stands.
 *
 * The top of "Mon Drive" itself cannot be picked — that would be the whole
 * Drive, which is exactly what D8 rules out.
 *
 * Saves the choice itself (`chooseFolder`); the owner only closes it.
 *
 * @fires drive-folder-chosen - `{ id, name }`, once saved. The owner clears
 * `open`.
 * @fires sheet-close - From the inner `app-bottom-sheet`, on dismissal.
 */
@customElement("drive-folder-sheet")
export class DriveFolderSheet extends BaseElement {
  @property({ type: Boolean }) open = false;

  /** From "Mon Drive" down to the folder on screen. */
  @state() private trail: DriveFolder[] = [];
  @state() private folders: DriveFolder[] | null = null;
  @state() private error = "";
  @state() private newName = "";
  @state() private busy = false;

  static componentStyles = css`
    /* Out of the owner's layout: closed, it must not take a grid gap. */
    :host {
      display: contents;
    }

    .crumbs {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-4);
      margin: 0 0 var(--spacing-12);
      font-size: var(--font-size-sm);
      color: var(--color-brown-light);
    }

    .crumb {
      appearance: none;
      border: none;
      background: none;
      padding: 0;
      font: inherit;
      color: inherit;
      text-decoration: underline;
      cursor: pointer;
    }

    .crumb[aria-current="page"] {
      text-decoration: none;
      font-weight: 600;
      color: var(--font-color);
    }

    .list {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .folder {
      appearance: none;
      display: flex;
      align-items: center;
      gap: var(--spacing-12);
      width: 100%;
      padding: var(--spacing-12) 0;
      border: none;
      border-bottom: 1px solid var(--color-page);
      background: none;
      font: inherit;
      color: var(--font-color);
      text-align: left;
      cursor: pointer;
    }

    .folder span {
      flex: 1;
    }

    .message {
      margin: var(--spacing-12) 0;
      color: var(--color-brown-light);
    }

    .create {
      display: flex;
      gap: var(--spacing-8);
      margin-top: var(--spacing-16);
    }

    .create input {
      flex: 1;
      min-width: 0;
      padding: var(--spacing-8) var(--spacing-12);
      border: 1px solid var(--color-brown-light);
      border-radius: var(--radius-8);
      font: inherit;
    }

    .button {
      appearance: none;
      border: 1px solid var(--color-brown-dark);
      border-radius: var(--radius-8);
      padding: var(--spacing-8) var(--spacing-12);
      background: none;
      color: var(--color-brown-dark);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }

    .submit {
      width: 100%;
      padding: var(--spacing-12) var(--spacing-16);
      border-color: var(--color-brown-dark);
      background: var(--color-brown-dark);
      color: var(--color-white);
    }

    .button:disabled {
      opacity: 0.5;
      cursor: default;
    }
  `;

  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has("open") && this.open) {
      this.trail = [{ id: MY_DRIVE, name: "Mon Drive" }];
      void this.#load();
    }
  }

  get #current(): DriveFolder {
    return this.trail.at(-1)!;
  }

  get #atTop(): boolean {
    return this.trail.length === 1;
  }

  async #load() {
    this.folders = null;
    this.error = "";
    this.newName = this.#atTop ? SUGGESTED_NAME : "";
    try {
      this.folders = await listFolders(this.#current.id);
    } catch (error: unknown) {
      this.error = this.#explain(error);
    }
  }

  #explain(error: unknown): string {
    if (error instanceof DriveSignedOutError) {
      return "Google Drive n’est plus connecté. Reconnectez-le depuis la page Documents.";
    }
    return error instanceof Error ? error.message : String(error);
  }

  #open(folder: DriveFolder) {
    this.trail = [...this.trail, folder];
    void this.#load();
  }

  #goTo(index: number) {
    this.trail = this.trail.slice(0, index + 1);
    void this.#load();
  }

  #create = async () => {
    const name = this.newName.trim();
    if (!name || this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      const created = await createFolder(name, this.#current.id);
      this.#open(created);
    } catch (error: unknown) {
      this.error = this.#explain(error);
    } finally {
      this.busy = false;
    }
  };

  #choose = async () => {
    if (this.#atTop || this.busy) return;
    this.busy = true;
    try {
      await chooseFolder(this.#current);
      this.dispatchEvent(
        new CustomEvent<DriveFolder>("drive-folder-chosen", {
          detail: this.#current,
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error: unknown) {
      this.error = this.#explain(error);
    } finally {
      this.busy = false;
    }
  };

  render() {
    return html`
      <app-bottom-sheet
        heading="Choisir le dossier"
        description="Les documents de l’application seront ceux de ce dossier."
        .open=${this.open}
      >
        ${this.open ? this.#renderBody() : nothing}
        <button
          slot="footer"
          class="button submit pressable"
          type="button"
          ?disabled=${this.#atTop || this.busy}
          @click=${this.#choose}
        >
          Utiliser ce dossier
        </button>
      </app-bottom-sheet>
    `;
  }

  #renderBody() {
    return html`
      <nav class="crumbs" aria-label="Emplacement">
        ${this.trail.map(
          (step, index) => html`
            ${index > 0 ? html`<span aria-hidden="true">›</span>` : nothing}
            <button
              class="crumb"
              type="button"
              aria-current=${index === this.trail.length - 1 ? "page" : "false"}
              @click=${() => this.#goTo(index)}
            >
              ${step.name}
            </button>
          `,
        )}
      </nav>
      ${this.#renderFolders()}
      <div class="create">
        <input
          type="text"
          aria-label="Nom du nouveau dossier"
          placeholder="Nouveau dossier"
          .value=${this.newName}
          @input=${(event: InputEvent) => {
            this.newName = (event.target as HTMLInputElement).value;
          }}
        />
        <button
          class="button pressable"
          type="button"
          ?disabled=${!this.newName.trim() || this.busy}
          @click=${this.#create}
        >
          Créer
        </button>
      </div>
    `;
  }

  #renderFolders() {
    if (this.error)
      return html`<p class="message" role="alert">${this.error}</p>`;
    if (this.folders === null) return html`<p class="message">Chargement…</p>`;
    if (this.folders.length === 0) {
      return html`<p class="message">Aucun dossier ici.</p>`;
    }
    return html`
      <ul class="list">
        ${repeat(
          this.folders,
          (folder) => folder.id,
          (folder) => html`
            <li>
              <button
                class="folder pressable"
                type="button"
                @click=${() => this.#open(folder)}
              >
                <app-icon icon="folder"></app-icon>
                <span>${folder.name}</span>
                <app-icon icon="chevronRight"></app-icon>
              </button>
            </li>
          `,
        )}
      </ul>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "drive-folder-sheet": DriveFolderSheet;
  }
}
