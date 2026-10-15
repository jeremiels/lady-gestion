import { css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";
import {
  FIELD_KINDS,
  FIELD_KIND_KEYS,
  hasKind,
  type FieldKind,
} from "../../data/category-editor.ts";
import type { CustomFieldDef } from "../../data/types.ts";

import "../app-bottom-sheet/app-bottom-sheet.ts";

export type KindPickDetail = { kind: FieldKind };

/**
 * "Ajouter un champ": the kinds of field a form can take. The ones a form
 * carries once — Nom, Note, the follow-up, the notification — are offered
 * only while the form has none.
 *
 * @fires kind-pick - `{ kind }`. The owner adds the field and clears `open`.
 * @fires sheet-close - From the inner `app-bottom-sheet`, on dismissal.
 */
@customElement("field-kind-sheet")
export class FieldKindSheet extends BaseElement {
  @property({ type: Boolean }) open = false;
  /** The form as it stands, to tell which single-use kinds are taken. */
  @property({ attribute: false }) fields: readonly CustomFieldDef[] = [];

  static componentStyles = css`
    :host {
      display: contents;
    }

    .groups {
      display: grid;
      gap: var(--spacing-16);
      padding-bottom: var(--spacing-16);
    }

    .group {
      display: grid;
      gap: var(--spacing-8);
      margin: 0;
      padding: 0;
      border: none;
    }

    .group__title {
      padding: 0;
      font-size: var(--font-size-xs);
      font-weight: bold;
      color: var(--color-brown-middle);
    }

    .kinds {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--spacing-8);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .kind {
      appearance: none;
      width: 100%;
      min-height: 2.75rem;
      padding: var(--spacing-12);
      border: none;
      border-radius: var(--radius-8);
      background: var(--color-white);
      color: var(--color-brown-dark);
      font: inherit;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
    }

    .kind:disabled {
      color: var(--color-brown-light);
      cursor: default;
    }

    .kind:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }
  `;

  #pick(kind: FieldKind) {
    this.dispatchEvent(
      new CustomEvent<KindPickDetail>("kind-pick", {
        detail: { kind },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #renderKinds(unique: boolean) {
    return html`
      <ul class="kinds">
        ${FIELD_KIND_KEYS.filter(
          (kind) => FIELD_KINDS[kind].unique === unique,
        ).map(
          (kind) => html`
            <li>
              <button
                class="kind pressable"
                type="button"
                ?disabled=${unique && hasKind(this.fields, kind)}
                @click=${() => this.#pick(kind)}
              >
                ${FIELD_KINDS[kind].label}
              </button>
            </li>
          `,
        )}
      </ul>
    `;
  }

  render() {
    return html`
      <app-bottom-sheet
        heading="Ajouter un champ"
        description="Choisissez ce que le formulaire demande"
        .open=${this.open}
      >
        <div class="groups">
          <fieldset class="group">
            <legend class="group__title">Champs</legend>
            ${this.#renderKinds(false)}
          </fieldset>
          <fieldset class="group">
            <legend class="group__title">Blocs prêts à l’emploi</legend>
            ${this.#renderKinds(true)}
          </fieldset>
        </div>
      </app-bottom-sheet>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "field-kind-sheet": FieldKindSheet;
  }
}
