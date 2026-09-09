import { css, html } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";
import { describedBy, fieldMessages } from "../../commons/field-parts.ts";
import { FormFieldElement } from "../../commons/form-field-element.ts";
import { slidingSelectionStyles } from "../../commons/sliding-selection.styles.ts";

export interface UnitOption {
  value: string;
  label: string;
}

/**
 * Pick exactly one unit for a quantity — "mL", "kg", "L" — as a row of pills
 * next to the amount's own input.
 *
 * Built on real `<input type="radio">`, not `app-segmented`'s hand-rolled
 * `role="radio"` buttons: this one is form-associated, so it needs a native
 * control to hand `FormFieldElement` for constraint validation, and radios give
 * the roving tabindex, arrow-key movement and "1 sur 3" announcement for free
 * — nothing here reimplements them. Each radio is sized to its whole pill and
 * hidden with opacity rather than `display:none`, so it stays focusable and in
 * the accessibility tree while the visible surface is the `<label>` around it.
 *
 * `label` names the group (a visually-hidden legend) rather than appearing on
 * screen — the mockup shows no caption, and the adjacent amount field's own
 * label already says what the number is.
 *
 * @fires unit-select-change - `{ value: string }`. Fired only when the value
 * actually changes; re-selecting the checked option is a no-op, same as
 * `segment-change`.
 */
@customElement("app-unit-select")
export class AppUnitSelect extends FormFieldElement {
  @property({ type: String }) value = "";
  @property({ attribute: false }) options: UnitOption[] = [];

  @query("input") private firstOptionEl?: HTMLInputElement;

  protected get control(): HTMLInputElement | undefined {
    return this.firstOptionEl;
  }

  #defaultValue = "";

  protected get formValue(): string {
    return this.value;
  }

  protected captureDefault() {
    this.#defaultValue = this.value;
  }

  protected restoreDefault() {
    this.value = this.#defaultValue;
  }

  // --- Form-associated custom element lifecycle ---

  formStateRestoreCallback(restored: string | FormData | null) {
    this.value = typeof restored === "string" ? restored : "";
  }

  #onChange = (event: Event) => {
    const value = (event.target as HTMLInputElement).value;
    this.field.markTouched();
    if (value === this.value) return;

    this.value = value;
    this.dispatchEvent(
      new CustomEvent("unit-select-change", {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
  };

  // The shared pill first, so the rules below still win at equal specificity.
  static componentStyles = [
    slidingSelectionStyles,
    css`
      :host {
        display: inline-flex;
        font-family: var(--font-family-base);
        --sliding-selection-background: var(--color-brown-dark);
        /* Square, not the mixin's own pill default: the *container* below is
           what carries the rounding now, via its own radius plus
           overflow: clip, so a middle option's pill is clipped to nothing but
           the first and last are clipped into the container's curve — one
           rule producing all three shapes instead of one computed per
           selected index. */
        --sliding-selection-radius: 0;
      }

      .field {
        display: inline-flex;
        flex-direction: column;
        gap: var(--spacing-4);
      }

      .field__group {
        display: inline-grid;
        grid-template-columns: repeat(3, 1fr);
        gap: var(--spacing-2);
        border-radius: var(--radius-12);
        background: var(--color-brown-light-bg);
        overflow: clip;
      }

      .field__label {
        font-size: 0.75rem;
        line-height: 1.25rem;
        font-weight: 600;
        color: var(--font-color);
      }

      .option {
        position: relative;
        display: grid;
        place-items: center;
        height: 2.75rem;
        padding-inline: var(--spacing-16);
        color: var(--color-brown-light);
        font-size: 0.75rem;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
        /* Same two-clock split as app-segmented: the ink follows the pill's
           clock, not its own. */
        transition:
          background-color var(--duration-fast) ease,
          color var(--duration-medium) var(--easing-standard);
      }

      /* Sized to the whole pill and hidden with opacity, not display:none —
         that would drop it from the accessibility tree and take native
         keyboard handling with it. The label text painted on top is what
         actually shows. */
      .option__input {
        position: absolute;
        inset: 0;
        margin: 0;
        opacity: 0;
        cursor: pointer;
      }

      :host([disabled]) .option,
      :host([disabled]) .option__input {
        cursor: not-allowed;
      }

      :host([disabled]) .field__group {
        background: var(--color-disabled-surface);
      }

      :host([disabled]) .option {
        color: var(--color-disabled-content);
      }

      .option:has(.option__input:checked) {
        background: var(--color-brown-dark);
        color: var(--color-white);
      }

      /* Same swap app-segmented makes: where the sliding pill exists it is the
         selected surface, and a second, static one behind it would double up
         for as long as the travel takes. */
      @supports (anchor-name: --sliding-selection) {
        .option:has(.option__input:checked) {
          background: transparent;
        }
      }

      .option:has(.option__input:focus-visible) {
        outline: 2px solid var(--color-brown-dark);
        outline-offset: 2px;
      }
    `,
  ];

  render() {
    const { hintId, errorId, message } = this.messages;
    const described = describedBy(this.helpText && hintId, message && errorId);
    const groupName = `${this.fieldId}-options`;

    return html`
      <div class="field">
        <span class="field__label" id=${this.fieldId}>${this.label}</span>
        <div
          class="field__group sliding-selection"
          part="group"
          role="radiogroup"
          aria-labelledby=${this.fieldId}
          aria-describedby=${ifDefined(described)}
        >
          ${this.options.map((option) => {
            const checked = option.value === this.value;
            return html`
              <label
                class=${classMap({
                  option: true,
                  "sliding-selection__active": checked,
                })}
                part="option"
              >
                <input
                  type="radio"
                  class="option__input"
                  name=${groupName}
                  value=${option.value}
                  .checked=${live(checked)}
                  ?required=${this.required}
                  ?disabled=${this.disabled}
                  aria-invalid=${this.invalid ? "true" : "false"}
                  @change=${this.#onChange}
                  @blur=${this.field.markTouched}
                />${option.label}
              </label>
            `;
          })}
        </div>
        ${fieldMessages({ hintId, errorId, helpText: this.helpText, message })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-unit-select": AppUnitSelect;
  }
}
