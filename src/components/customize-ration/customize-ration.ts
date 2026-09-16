import { css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";
import { todayISO, type IsoDate } from "../../data/dates.ts";
import type { RationItem } from "../../data/types.ts";
import type {
  RationFormDetail,
  RationFormErrors,
} from "../ration-form/ration-form.ts";

import "../horse-ration/horse-ration.ts";
import "../ration-form/ration-form.ts";

export type RationAddDetail = RationFormDetail;

export type RationAddErrors = RationFormErrors;

/**
 * The Ration tab of Personnaliser mon interface: a `ration-form` that appends a
 * product to the feed plan, and the plan itself with a pencil and a bin on
 * every line.
 *
 * Presentational — the owning view parses and writes the form, opens
 * `ration-sheet` on a pencil and confirms a delete. The list is the horse
 * page's own `horse-ration`, so the two cannot drift apart.
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

  #onSubmit = (event: CustomEvent<RationFormDetail>) => {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<RationAddDetail>("ration-add", {
        detail: event.detail,
        bubbles: true,
        composed: true,
      }),
    );
  };

  render() {
    return html`
      <ration-form
        submit-label="Ajouter un produit"
        .errors=${this.errors}
        @ration-form-submit=${this.#onSubmit}
      ></ration-form>

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
