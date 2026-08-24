import { css, html, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { live } from 'lit/directives/live.js';
import { describedBy, fieldMessages } from '../../commons/field-parts.ts';
import { FormFieldElement } from '../../commons/form-field-element.ts';

/**
 * Labeled checkbox, form-associated so it works with native <form>,
 * FormData and constraint validation like a built-in checkbox.
 *
 * @fires checkbox-change - `{ checked: boolean }`. Listen for this, not the
 * native `change`, which is `composed: false` and never leaves the shadow root.
 */
@customElement('app-checkbox')
export class AppCheckbox extends FormFieldElement {
  @property({ type: String }) value = 'on';
  @property({ type: Boolean, reflect: true }) checked = false;

  @query('input') private inputEl?: HTMLInputElement;

  protected get control(): HTMLInputElement | undefined {
    return this.inputEl;
  }
  #defaultChecked = false;

  /**
   * An unchecked box submits nothing at all, which is what `null` means here —
   * not an empty string, which would be a value the form actually carries.
   */
  protected get formValue(): string | null {
    return this.checked ? this.value : null;
  }

  protected captureDefault() {
    this.#defaultChecked = this.checked;
  }

  protected restoreDefault() {
    this.checked = this.#defaultChecked;
  }

  // --- Form-associated custom element lifecycle ---

  formStateRestoreCallback(restored: string | FormData | null) {
    this.checked = typeof restored === 'string';
  }

  #onChange = (event: Event) => {
    const input = event.target as HTMLInputElement;
    this.checked = input.checked;
    this.field.markTouched();

    // The native `change` is `composed: false`, so it stops at this shadow
    // boundary and a consumer's `@change` never fires. Re-dispatched as a
    // composed custom event, matching `switch-change` / `segment-change`.
    this.dispatchEvent(
      new CustomEvent('checkbox-change', {
        detail: { checked: this.checked },
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

    .field__row {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-8);
      cursor: pointer;
    }

    :host([disabled]) .field__row {
      cursor: not-allowed;
    }

    .field__box {
      appearance: none;
      margin: 0;
      flex-shrink: 0;
      width: 1.25rem;
      height: 1.25rem;
      display: inline-grid;
      place-content: center;
      border: 1px solid var(--color-brown-light);
      border-radius: var(--radius-4);
      background-color: var(--color-white);
      cursor: pointer;
      transition: background-color var(--duration-fast) ease, border-color var(--duration-fast) ease;
    }

    .field__box::before {
      content: '';
      width: 0.7rem;
      height: 0.7rem;
      background-color: var(--color-white);
      clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 45% 62%);
      transform: scale(0.9);
      opacity: 0;
      transition:
        transform var(--duration-fast) var(--easing-out),
        opacity var(--duration-fast) var(--easing-out);
    }

    .field__box:checked {
      background-color: var(--color-brown-dark);
      border-color: var(--color-brown-dark);
    }

    .field__box:checked::before {
      transform: scale(1);
      opacity: 1;
    }

    @media (hover: hover) and (pointer: fine) {
      .field__box:hover:not(:disabled) {
        border-color: var(--color-brown-middle);
      }
    }

    .field__box:focus-visible {
      outline: none;
      border-color: var(--color-brown-dark);
      box-shadow: 0 0 0 3px var(--color-theme-brown-background);
    }

    .field__box:disabled {
      background-color: var(--color-disabled-surface);
      border-color: var(--color-disabled-line);
      cursor: not-allowed;
    }

    .field__box:disabled::before {
      background-color: var(--color-disabled-content);
    }

    .field__label {
      font-size: var(--font-size-base);
      color: var(--font-color);
    }



    :host(:state(invalid)) .field__box {
      border-color: var(--app-field-error-color);
    }

    :host(:state(invalid)) .field__box:focus-visible {
      box-shadow: var(--app-field-error-ring);
    }

    @media (prefers-reduced-motion: reduce) {
      .field__box::before {
        transition: opacity var(--duration-fast) var(--easing-out);
      }
    }
  `;

  render() {
    const { hintId, errorId, message } = this.messages;
    const described = describedBy(this.helpText && hintId, message && errorId);

    return html`
      <div class="field">
        <label class="field__row" part="row" for=${this.fieldId}>
          <input
            id=${this.fieldId}
            part="box"
            class="field__box"
            type="checkbox"
            name=${ifDefined(this.name || undefined)}
            .checked=${live(this.checked)}
            value=${this.value}
            ?required=${this.required}
            ?disabled=${this.disabled}
            aria-invalid=${this.invalid ? 'true' : 'false'}
            aria-describedby=${ifDefined(described)}
            @change=${this.#onChange}
            @blur=${this.field.markTouched}
          />
          <span class="field__label" part="label">
            ${this.label}${this.required
              ? html`<span class="field__required" part="required" aria-hidden="true"> *</span>`
              : nothing}
          </span>
        </label>
        ${fieldMessages({ hintId, errorId, helpText: this.helpText, message })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-checkbox': AppCheckbox;
  }
}
