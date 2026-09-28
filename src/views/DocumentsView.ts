import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { LightElement } from "../commons/base-element.ts";
import {
  LiveQuery,
  activeHorseQuery,
  documentFoldersRepo,
  documentsRepo,
} from "../data/index.ts";
import type { DocumentFolder } from "../data/types.ts";

import "../components/app-folder/app-folder.ts";

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

  render() {
    const folders = this.#folders.value ?? [];
    const counts = this.#counts.value ?? {};

    return html`
      <section class="documents-view">
        <hgroup class="section-group">
          <h1 class="page-title" tabindex="-1">Documents</h1>
          <p class="section-subtitle">Coffre-fort de tous les fichiers</p>
        </hgroup>
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
}
