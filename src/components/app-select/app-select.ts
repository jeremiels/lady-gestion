import { css, html, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { live } from 'lit/directives/live.js';
import { describedBy, fieldMessages } from '../../commons/field-parts.ts';
import { FormFieldElement } from '../../commons/form-field-element.ts';

export interface AppSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * Labeled select, form-associated so it works with native <form>,
 * FormData and constraint validation like a built-in field.
 *
 * @fires select-change - `{ value: string }`. Listen for this, not the native
 * `change`, which is `composed: false` and never leaves the shadow root.
 */
@customElement('app-select')
export class AppSelect extends FormFieldElement {
  @property({ type: String }) value = '';
  @property({ type: Array }) options: AppSelectOption[] = [];
  @property({ type: String }) placeholder = '';
  /**
   * Compact pill with its label hidden — the period picker on the expenses
   * view, where the value alone is the affordance and the surrounding heading
   * already says what it picks.
   *
   * Still a real `<select>`, so on the iPhone this is the native wheel picker,
   * with keyboard support and the platform's own dismissal for free. The label
   * stays in the DOM for screen readers.
   */
  @property({ type: Boolean, reflect: true }) pill = false;

  @query('select') private selectEl?: HTMLSelectElement;

  protected get control(): HTMLSelectElement | undefined {
    return this.selectEl;
  }
  #defaultValue = '';

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

  formResetCallback() {
    this.value = this.#defaultValue;
    this.error = '';
    this.field.reset();
  }

  formStateRestoreCallback(restored: string | FormData | null) {
    this.value = typeof restored === 'string' ? restored : '';
  }

  #onChange = (event: Event) => {
    const select = event.target as HTMLSelectElement;
    this.value = select.value;
    this.field.markTouched();

    // The native `change` is `composed: false`, so it stops at this shadow
    // boundary and a consumer's `@change` never fires. Re-dispatched as a
    // composed custom event, matching `switch-change` / `segment-change`.
    this.dispatchEvent(
      new CustomEvent('select-change', {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      }),
    );
  };

  static componentStyles = css`
    :host {
      display: block;
      font-family: var(--font-family-base);
    }

    :host([disabled]) .field__label {
      color: var(--color-brown-light);
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }

    .field__label {
      font-size: var(--font-size-sm);
      font-weight: 600;
      color: var(--font-color);
    }

    .field__wrapper {
      position: relative;
    }

    .field__select {
      font: inherit;
      font-size: var(--font-size-base);
      color: var(--font-color);
      /* A custom property rather than a ::part override, so a consumer can
         retint the field without also beating the focus rule below — outer
         ::part declarations win over the shadow tree's own. Mirrors
         --app-input-background on app-input. */
      background-color: var(--app-select-background, var(--color-white));
      border: 1px solid var(--app-select-border-color, var(--color-brown-light));
      border-radius: var(--radius-8);
      padding: var(--spacing-8) var(--spacing-32) var(--spacing-8) var(--spacing-12);
      min-height: 2.75rem;
      box-sizing: border-box;
      width: 100%;
      appearance: none;
      cursor: pointer;
      transition: border-color var(--duration-fast) ease, box-shadow var(--duration-fast) ease;
    }

    @media (hover: hover) and (pointer: fine) {
      .field__select:hover:not(:disabled) {
        border-color: var(--color-brown-middle);
      }
    }

    .field__select:focus-visible {
      outline: none;
      border-color: var(--color-brown-dark);
      box-shadow: 0 0 0 3px var(--color-theme-brown-background);
    }

    .field__select:disabled {
      background-color: var(--color-disabled-surface);
      color: var(--color-disabled-content);
      cursor: not-allowed;
    }

    .field__arrow {
      position: absolute;
      top: 50%;
      right: var(--spacing-12);
      transform: translateY(-50%);
      width: 0.625rem;
      height: 0.625rem;
      pointer-events: none;
      border-right: 2px solid var(--color-brown-middle);
      border-bottom: 2px solid var(--color-brown-middle);
      transform: translateY(-75%) rotate(45deg);
    }

    :host([disabled]) .field__arrow {
      border-color: var(--color-disabled-content);
    }

    :host([pill]) {
      display: inline-block;
    }

    :host([pill]) .field__select {
      width: auto;
      min-height: 2.25rem;
      border: none;
      border-radius: var(--radius-pill);
      background-color: var(--app-select-background, var(--color-brown-light-bg));
      padding: var(--spacing-8) var(--spacing-32) var(--spacing-8) var(--spacing-16);
      font-size: 0.9375rem;
      font-weight: 600;
      color: var(--color-brown-dark);
    }

    :host([pill]) .field__arrow {
      right: var(--spacing-16);
      border-color: var(--color-brown-dark);
    }


    :host(:state(invalid)) .field__select {
      border-color: var(--app-field-error-color);
    }

    :host(:state(invalid)) .field__select:focus-visible {
      box-shadow: var(--app-field-error-ring);
    }
  `;

  render() {
    const { hintId, errorId, message } = this.messages;
    const described = describedBy(this.helpText && hintId, message && errorId);

    return html`
      <div class="field">
        <label
          class="field__label ${this.pill ? 'visually-hidden' : ''}"
          part="label"
          for=${this.fieldId}
        >
          ${this.label}${this.required
            ? html`<span class="field__required" part="required" aria-hidden="true"> *</span>`
            : nothing}
        </label>
        <div class="field__wrapper">
          <select
            id=${this.fieldId}
            part="select"
            class="field__select"
            name=${ifDefined(this.name || undefined)}
            .value=${live(this.value)}
            ?required=${this.required}
            ?disabled=${this.disabled}
            aria-invalid=${this.invalid ? 'true' : 'false'}
            aria-describedby=${ifDefined(described)}
            @change=${this.#onChange}
            @blur=${this.field.markTouched}
          >
            ${this.placeholder
              ? html`<option value="" ?disabled=${this.required} ?selected=${!this.value}>
                  ${this.placeholder}
                </option>`
              : nothing}
            ${this.options.map(
              (option) => html`
                <option value=${option.value} ?disabled=${option.disabled} ?selected=${option.value === this.value}>
                  ${option.label}
                </option>
              `,
            )}
          </select>
          <span class="field__arrow" aria-hidden="true"></span>
        </div>
        ${fieldMessages({ hintId, errorId, helpText: this.helpText, message })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-select': AppSelect;
  }
}
