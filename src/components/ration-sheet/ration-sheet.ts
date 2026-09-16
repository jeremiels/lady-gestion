import { css, html, type PropertyValues } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { BaseElement } from "../../commons/base-element.ts";
import type { RationItem } from "../../data/types.ts";
import type {
  RationForm,
  RationFormDetail,
  RationFormErrors,
} from "../ration-form/ration-form.ts";

import "../app-bottom-sheet/app-bottom-sheet.ts";
import "../ration-form/ration-form.ts";

export type RationSubmitDetail = RationFormDetail;

/**
 * Edits one line of the daily ration: the same `ration-form` as "Ajouter un
 * produit", prefilled from `ration`.
 *
 * Presentational — parsing and saving belong to the owner
 * (`rationsService.updateRation`), against the same `ration` it passed in.
 *
 * @fires ration-submit - `{ form: HTMLFormElement }`. The owner saves and
 * clears `open` on success.
 * @fires sheet-close - From the inner `app-bottom-sheet`, which is already
 * bubbling and composed — the owner clears `open` in response.
 */
@customElement("ration-sheet")
export class RationSheet extends BaseElement {
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) ration: RationItem | null = null;
  @property({ attribute: false }) errors: RationFormErrors = {};

  @query("ration-form") private formEl?: RationForm;

  /**
   * Bumped on every opening and used as the form's key, so a reopened sheet
   * starts from the stored line: Lit does not re-push a `.value` that has not
   * changed, which would otherwise keep an abandoned edit on screen.
   */
  #openCount = 0;

  static componentStyles = css`
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

  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has("open") && this.open) this.#openCount += 1;
  }

  #onSubmit = (event: CustomEvent<RationFormDetail>) => {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<RationSubmitDetail>("ration-submit", {
        detail: event.detail,
        bubbles: true,
        composed: true,
      }),
    );
  };

  #submit = () => this.formEl?.requestSubmit();

  render() {
    const ration = this.ration;

    return html`
      <app-bottom-sheet
        heading="Modifier le produit"
        description=${ration?.label ?? ""}
        .open=${this.open}
      >
        ${
          ration
            ? keyed(
                `${ration.id}-${this.#openCount}`,
                html`<ration-form
                  .ration=${ration}
                  .errors=${this.errors}
                  @ration-form-submit=${this.#onSubmit}
                ></ration-form>`,
              )
            : null
        }
        <button
          slot="footer"
          class="submit pressable"
          type="button"
          @click=${this.#submit}
        >
          Enregistrer
        </button>
      </app-bottom-sheet>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ration-sheet": RationSheet;
  }
}
