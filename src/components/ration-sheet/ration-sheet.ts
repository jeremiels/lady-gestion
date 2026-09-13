import { css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { BaseElement } from "../../commons/base-element.ts";
import { rationFieldNames } from "../../data/services/rations.service.ts";
import type { RationItem } from "../../data/types.ts";
import {
  RATION_UNIT_LABEL,
  formatRationAmount,
} from "../../types/horse.types.ts";

import "../app-bottom-sheet/app-bottom-sheet.ts";
import "../app-checkbox/app-checkbox.ts";
import "../app-input/app-input.ts";

export type RationSubmitDetail = { form: HTMLFormElement };

/**
 * The daily-ration editor: every line of the plan at once, one "Enregistrer".
 *
 * Presentational — it renders the form and hands it over; parsing, diffing and
 * saving belong to the owner (`rationsService.saveRationSheet`), which reads the
 * form against the same `rations` it passed in.
 *
 * @fires ration-submit - `{ form: HTMLFormElement }`, after `preventDefault`.
 * The owner saves and clears `open` on success.
 * @fires sheet-close - From the inner `app-bottom-sheet`, which is already
 * bubbling and composed — the owner clears `open` in response.
 */
@customElement("ration-sheet")
export class RationSheet extends BaseElement {
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) rations: RationItem[] = [];

  static componentStyles = css`
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-16);
    }

    /* One card per product: name and the seasonal toggle share the top row, the
       quantity input spans underneath. The input's own label is hidden — the
       group is already named by \`.field__name\`. */
    .field {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: var(--spacing-12);
      padding: var(--spacing-16);
      border-radius: var(--radius-16);
      background: var(--color-white);
    }

    .field__name {
      grid-column: 1;
      grid-row: 1;
      font-size: 1rem;
      font-weight: 600;
      color: var(--font-color);
    }

    .field__seasonal {
      grid-column: 2;
      grid-row: 1;
      justify-self: end;
    }

    .field__quantity {
      grid-column: 1 / -1;
      grid-row: 2;
      --app-input-background: var(--color-input-drawer);
    }

    .submit {
      appearance: none;
      width: 100%;
      background: var(--color-brown-dark);
      color: var(--color-white);
      border: none;
      border-radius: var(--radius-8);
      padding: var(--spacing-12) var(--spacing-16);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
  `;

  #onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    this.dispatchEvent(
      new CustomEvent<RationSubmitDetail>("ration-submit", {
        detail: { form: event.target as HTMLFormElement },
        bubbles: true,
        composed: true,
      }),
    );
  };

  render() {
    // The footer button's `form="ration-form"` resolves against this shadow
    // root, which is where the form is — the id is not global.
    return html`
      <app-bottom-sheet
        heading="Ration quotidienne"
        description="Modifier les produits et quantités"
        .open=${this.open}
      >
        <!--
          Keyed, and this is the one list where it is not just about render
          cost. These rows hold focusable app-inputs carrying whatever the user
          has typed; under a bare map() Lit binds parts positionally, so a
          write that reorders or removes a ration re-points every row at a
          different record and the in-progress edit — and the focus — lands on
          the wrong product.
        -->
        <form id="ration-form" class="form" @submit=${this.#onSubmit}>
          ${repeat(
            this.rations,
            (ration) => ration.id,
            (ration) => this.#renderField(ration),
          )}
        </form>
        <button
          slot="footer"
          class="submit pressable"
          type="submit"
          form="ration-form"
        >
          Enregistrer
        </button>
      </app-bottom-sheet>
    `;
  }

  #renderField(ration: RationItem) {
    // `role="group"` + `aria-labelledby` rather than fieldset/legend: it maps to
    // the same thing for a screen reader, and a <legend> is not laid out as a
    // normal child in every engine, so it can't be placed in the grid below.
    const nameId = `ration-name-${ration.id}`;
    // Not spelled inline: the schema that reads these back is built from the
    // same helper, so the two halves of the round trip cannot drift.
    const names = rationFieldNames(ration.id);

    return html`
      <div class="field" role="group" aria-labelledby=${nameId}>
        <span class="field__name" id=${nameId}>${ration.label}</span>
        <app-checkbox
          class="field__seasonal"
          label="Saisonnier"
          name=${names.seasonal}
          ?checked=${ration.season !== null}
        ></app-checkbox>
        <!--
          A text input with inputmode=decimal, not type=number: a number input
          holds a locale-independent value, so a French user typing "1,5" hands
          back an empty string and their edit vanishes without a word. The
          pattern accepts either separator and the submit handler normalises it.
        -->
        <app-input
          class="field__quantity"
          label="Quantité de ${ration.label}"
          hide-label
          name=${names.quantity}
          type="text"
          inputmode="decimal"
          pattern="[0-9]+([.,][0-9]+)?"
          suffix=${RATION_UNIT_LABEL[ration.unit]}
          .value=${formatRationAmount(ration.quantity)}
          required
        ></app-input>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ration-sheet": RationSheet;
  }
}
