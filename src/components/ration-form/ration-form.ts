import { css, html } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";
import type { FieldError } from "../../data/forms.ts";
import { MONTH_NUMBERS, formatMonthShort } from "../../data/seasons.ts";
import {
  RATION_ADD_FIELDS,
  RATION_FORM_UNITS,
  RATION_LABEL_MAX,
  type RationAddField,
} from "../../data/services/rations.service.ts";
import type { RationItem } from "../../data/types.ts";
import {
  RATION_UNIT_LABEL,
  formatRationAmount,
} from "../../types/horse.types.ts";

import "../app-input/app-input.ts";
import "../app-select/app-select.ts";
import "../app-unit-select/app-unit-select.ts";

export type RationFormDetail = { form: HTMLFormElement };

export type RationFormErrors = Partial<Record<RationAddField, FieldError>>;

const MONTH_OPTIONS = MONTH_NUMBERS.map((month) => ({
  value: String(month),
  label: formatMonthShort(month),
}));

/**
 * One ration line as a form: Nom du produit, Quantité + Unités, Période.
 *
 * Shared by "Ajouter un produit" (blank) and the edit sheet (prefilled from
 * `ration`). Presentational — the owner parses the form through
 * `rationsService`.
 *
 * It owns the `<form>` because the form-associated fields live in this shadow
 * root and cannot join a form outside it. `novalidate`: the service reports
 * every problem at once through `errors`, including the one the platform cannot
 * express — a period with only one of its two months.
 *
 * @fires ration-form-submit - `{ form: HTMLFormElement }`, after
 * `preventDefault`.
 */
@customElement("ration-form")
export class RationForm extends BaseElement {
  /** The line to prefill from; `null` for a blank form. */
  @property({ attribute: false }) ration: RationItem | null = null;
  @property({ attribute: false }) errors: RationFormErrors = {};
  /** Renders an in-form submit button when set; empty leaves it to the owner. */
  @property({ type: String, attribute: "submit-label" }) submitLabel = "";

  @query("form") private formEl!: HTMLFormElement;

  static componentStyles = css`
    .form {
      display: grid;
      gap: var(--spacing-16);
      padding: var(--spacing-16);
      border-radius: var(--radius-16);
      background: var(--color-white);

      app-input,
      app-select,
      app-unit-select {
        padding: 0;
      }
    }

    .row {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-16);
    }

    .row > * {
      flex: 1;
      min-width: 0;
    }

    .row app-unit-select {
      flex: 0 0 auto;
    }

    .period {
      display: grid;
      gap: var(--spacing-8);
      margin: 0;
      padding: 0;
      border: none;
      min-width: 0;
    }

    /* Restated from app-input's label: a fieldset legend is outside every
       field's shadow root. */
    .period__legend {
      padding: 0;
      font-size: var(--font-size-xs);
      line-height: 1.25rem;
      font-weight: 600;
      color: var(--font-color);
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

  /** Submits from outside the shadow root, e.g. a bottom sheet's footer button. */
  requestSubmit() {
    this.formEl.requestSubmit();
  }

  #onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    this.dispatchEvent(
      new CustomEvent<RationFormDetail>("ration-form-submit", {
        detail: { form: event.currentTarget as HTMLFormElement },
        bubbles: true,
        composed: true,
      }),
    );
  };

  render() {
    const errors = this.errors;
    const ration = this.ration;

    // A line stored with a unit the form no longer offers (`dose`, `mesure`)
    // still shows it, so editing it does not silently change the unit.
    const units =
      ration && !RATION_FORM_UNITS.includes(ration.unit)
        ? [...RATION_FORM_UNITS, ration.unit]
        : RATION_FORM_UNITS;
    const unitOptions = units.map((unit) => ({
      value: unit,
      label: RATION_UNIT_LABEL[unit],
    }));

    return html`
      <form class="form" novalidate @submit=${this.#onSubmit}>
        <app-input
          label="Nom du produit"
          name=${RATION_ADD_FIELDS.label}
          maxlength=${RATION_LABEL_MAX}
          autocomplete="off"
          .value=${ration?.label ?? ""}
          .error=${errors.label ?? ""}
        ></app-input>
        <div class="row">
          <!--
            A text input with inputmode=decimal, not type=number: a number
            input holds a locale-independent value, so a French user typing
            "1,5" hands back an empty string and their edit vanishes.
          -->
          <app-input
            label="Quantité"
            name=${RATION_ADD_FIELDS.quantity}
            type="text"
            inputmode="decimal"
            .value=${ration ? formatRationAmount(ration.quantity) : ""}
            .error=${errors.quantity ?? ""}
          ></app-input>
          <app-unit-select
            label="Unités"
            name=${RATION_ADD_FIELDS.unit}
            .options=${unitOptions}
            .value=${ration?.unit ?? ""}
            .error=${errors.unit ?? ""}
          ></app-unit-select>
        </div>
        <fieldset class="period">
          <legend class="period__legend">Période</legend>
          <div class="row">
            <app-select
              label="De"
              name=${RATION_ADD_FIELDS.seasonFrom}
              placeholder="Toute l’année"
              .options=${MONTH_OPTIONS}
              .value=${ration?.season ? String(ration.season.from) : ""}
              .error=${errors.seasonFrom ?? ""}
            ></app-select>
            <app-select
              label="À"
              name=${RATION_ADD_FIELDS.seasonTo}
              placeholder="Toute l’année"
              .options=${MONTH_OPTIONS}
              .value=${ration?.season ? String(ration.season.to) : ""}
              .error=${errors.seasonTo ?? ""}
            ></app-select>
          </div>
        </fieldset>
        ${
          this.submitLabel
            ? html`<button class="submit pressable" type="submit">
                ${this.submitLabel}
              </button>`
            : null
        }
      </form>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ration-form": RationForm;
  }
}
