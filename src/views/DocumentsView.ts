import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { LightElement } from "../commons/base-element.ts";
import { activeHorseQuery, documentsRepo } from "../data/index.ts";
import {
  DOCUMENT_CATEGORIES,
  type DocumentCategory,
  documentCategory,
} from "../types/document.types.ts";

import "../components/app-folder/app-folder.ts";

@customElement("documents-view")
export class DocumentsView extends LightElement {
  /**
   * Live counts per category.
   *
   * Every category is shown even at zero: this screen is the vault's structure,
   * so a user looking for somewhere to file an ordonnance needs to see the
   * folder before there is anything in it.
   */
  #counts = activeHorseQuery<Partial<Record<DocumentCategory, number>>>(
    this,
    (horseId) => documentsRepo.countByCategory(horseId),
    {},
  );

  render() {
    const counts = this.#counts.value ?? {};

    return html`
      <section class="documents-view">
        <hgroup class="section-group">
          <h1 class="section-title" tabindex="-1">Documents</h1>
          <p class="section-subtitle">Coffre-fort de tous les fichiers</p>
        </hgroup>
        <ul class="documents-list">
          ${DOCUMENT_CATEGORIES.map((category) => this.#renderFolder(category, counts[category] ?? 0))}
        </ul>
      </section>
    `;
  }

  #renderFolder(category: DocumentCategory, count: number) {
    // Icon, label and colour all come from DOCUMENT_CATEGORY_META, which is the
    // source of truth for category presentation — the same split
    // `event.types.ts` makes for events.
    const theme = documentCategory.theme(category);

    return html`
      <li>
        <app-folder
          icon=${documentCategory.icon(category)}
          name=${documentCategory.label(category)}
          .number=${count}
          style=${styleMap({
            "--app-folder-icon-background": theme.backgroundColor,
            "--app-folder-icon-color": theme.color,
          })}
        ></app-folder>
      </li>
    `;
  }
}
