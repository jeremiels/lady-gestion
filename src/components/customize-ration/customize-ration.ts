import { css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";
import { todayISO, type IsoDate } from "../../data/dates.ts";
import type { FieldError } from "../../data/forms.ts";
import { MONTH_NUMBERS, formatMonthShort } from "../../data/seasons.ts";
import {
  RATION_ADD_FIELDS,
  RATION_FORM_UNITS,
  RATION_LABEL_MAX,
  type RationAddField,
} from "../../data/services/rations.service.ts";
import type { RationItem } from "../../data/types.ts";
import { RATION_UNIT_LABEL } from "../../types/horse.types.ts";

import "../app-input/app-input.ts";
import "../app-select/app-select.ts";
import "../app-unit-select/app-unit-select.ts";
import "../horse-ration/horse-ration.ts";

export type RationAddDetail = { form: HTMLFormElement };

export type RationAddErrors = Partial<Record<RationAddField, FieldError>>;

const UNIT_OPTIONS = RATION_FORM_UNITS.map((unit) => ({
  value: unit,
  label: RATION_UNIT_LABEL[unit],
}));

const MONTH_OPTIONS = MONTH_NUMBERS.map((month) => ({
  value: String(month),
  label: formatMonthShort(month),
}));

/**
 * The Ration tab of Personnaliser mon interface: a form that appends a product
 * to the feed plan, and the plan itself with a pencil and a bin on every line.
 *
 * Presentational — the owning view parses and writes the form, opens the
 * existing `ration-sheet` on a pencil and confirms a delete. The list is the
 * horse page's own `horse-ration`, so the two cannot drift apart.
 *
 * `novalidate`: `rationsService.addRation` owns the parsing and reports every
 * problem at once through `errors`, including the one the platform cannot
 * express — a period with only one of its two months.
 *
 * @fires ration-add - `{ form: HTMLFormElement }`, after `preventDefault`. The
 * owner resets the form on success.
 * @fires ration-edit - From `horse-ration`, `{ id }`.
 * @fires ration-delete - From `horse-ration`, `{ id }`.
 */
@customElement("customize-ration")
export class CustomizeRation extends BaseElement {
  @property({ attribute: false }) rations: RationItem[] = [];
  @property({ type: String }) today: IsoDate = todayISO();
  @property({ attribute: false }) errors: RationAddErrors = {};

  static componentStyles = css`
    :host {
      display: grid;
      gap: 1.5rem;
    }

    .form {
      display: grid;
      gap: var(--spacing-16);
      padding: var(--spacing-16);
      border-radius: var(--radius-16);
      background: var(--color-white);
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
      font-size: 0.75rem;
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

    .section {
      display: grid;
      gap: var(--spacing-8);
    }

    /* Restated from profile/customize-profile's section title, which a shadow
       root does not see. */
    .title {
      margin: 0;
      font-size: 0.75rem;
      line-height: 0.875rem;
      font-weight: bold;
      color: var(--color-brown-middle);
    }
  `;

  #onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    this.dispatchEvent(
      new CustomEvent<RationAddDetail>("ration-add", {
        detail: { form: event.currentTarget as HTMLFormElement },
        bubbles: true,
        composed: true,
      }),
    );
  };

  render() {
    const errors = this.errors;

    return html`
      <form class="form" novalidate @submit=${this.#onSubmit}>
        <app-input
          label="Nom du produit"
          name=${RATION_ADD_FIELDS.label}
          maxlength=${RATION_LABEL_MAX}
          autocomplete="off"
          .error=${errors.label ?? ""}
        ></app-input>
        <div class="row">
          <!-- Text + inputmode=decimal, not type=number: see ration-sheet. -->
          <app-input
            label="Quantité"
            name=${RATION_ADD_FIELDS.quantity}
            type="text"
            inputmode="decimal"
            .error=${errors.quantity ?? ""}
          ></app-input>
          <app-unit-select
            label="Unités"
            name=${RATION_ADD_FIELDS.unit}
            .options=${UNIT_OPTIONS}
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
              .error=${errors.seasonFrom ?? ""}
            ></app-select>
            <app-select
              label="À"
              name=${RATION_ADD_FIELDS.seasonTo}
              placeholder="Toute l’année"
              .options=${MONTH_OPTIONS}
              .error=${errors.seasonTo ?? ""}
            ></app-select>
          </div>
        </fieldset>
        <button class="submit pressable" type="submit">
          Ajouter un produit
        </button>
      </form>

      <section class="section">
        <h2 class="title">Ration configurée</h2>
        <horse-ration
          editable
          .rations=${this.rations}
          .today=${this.today}
        ></horse-ration>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "customize-ration": CustomizeRation;
  }
}
