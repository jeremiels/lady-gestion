import { css, html, nothing } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";
import { describedBy, fieldMessages } from "../../commons/field-parts.ts";
import { FormFieldElement } from "../../commons/form-field-element.ts";
import type { IconName } from "../app-icon/icons.ts";

import "../app-icon/app-icon.ts";

export type AppInputType =
  | "text"
  | "email"
  | "password"
  | "number"
  | "tel"
  | "url"
  | "search"
  | "date"
  | "time"
  | "datetime-local"
  | "month"
  | "week"
  | "color";

/**
 * Labeled input, form-associated so it works with native <form>,
 * FormData and constraint validation like a built-in field.
 */
@customElement("app-input")
export class AppInput extends FormFieldElement {
  @property({ type: String }) type: AppInputType = "text";
  @property({ type: String }) value = "";
  @property({ type: String }) placeholder = "";
  /** Trailing text rendered inside the field, e.g. a unit ("kg", "€"). */
  @property({ type: String }) suffix = "";
  /** Decorative icon rendered at the start of the field, e.g. `search`. */
  @property({ type: String }) icon: IconName | "" = "";
  /**
   * Keeps the label for screen readers but drops it — and the field's own
   * padded backdrop — visually, leaving just the control. For a search box
   * whose placeholder already says what it is. Never omit `label` instead:
   * that leaves the input with no accessible name at all.
   */
  @property({ type: Boolean, reflect: true, attribute: "hide-label" })
  hideLabel = false;
  /** Drops the card behind the field, for a surface that already provides one. */
  @property({ type: Boolean, reflect: true }) flat = false;
  @property({ type: Boolean, reflect: true }) readonly = false;
  @property({ type: String }) autocomplete: AutoFill | "" = "";
  @property({ type: String }) inputmode = "";
  @property({ type: String }) min?: string;
  @property({ type: String }) max?: string;
  @property({ type: String }) step?: string;
  @property({ type: Number }) minlength?: number;
  @property({ type: Number }) maxlength?: number;
  @property({ type: String }) pattern?: string;

  @query("input") private inputEl?: HTMLInputElement;

  protected get control(): HTMLInputElement | undefined {
    return this.inputEl;
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

  #onInput = (event: InputEvent) => {
    const input = event.target as HTMLInputElement;
    this.value = input.value;
    this.field.sync();
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
      background-color: var(--color-white);
      border-radius: var(--radius-16);
      padding: var(--spacing-12);
    }

    .field__label {
      font-size: 0.75rem;
      line-height: 1.25rem;
      font-weight: 600;
      color: var(--font-color);
    }

    /* With the label hidden there is nothing left to pad around: the control
       becomes the whole field. */
    :host([hide-label]) .field {
      background-color: transparent;
      padding: 0;
    }

    /* Same result, asked for explicitly: the label stays but the card behind it
       goes, for forms whose surface already provides one. The ration sheet
       wants a card per product; the event sheet lays its fields straight onto
       the sheet background. */
    :host([flat]) .field {
      background-color: transparent;
      padding: 0;
    }

    /* The control, not the input, draws the box — that is what lets the icon
       and the suffix sit in their own columns and still read as inside the
       field. The leading column collapses to nothing when there is no icon. */
    .field__control {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      /* A custom property rather than a ::part override, so a consumer can
         retint the field without also beating the focus rule below — outer
         ::part declarations win over the shadow tree's own. */
      background-color: var(--app-input-background, var(--color-input-drawer));
      border: 1px solid var(--app-input-background, var(--color-input-drawer));
      border-radius: var(--radius-8);
      padding-inline: var(--spacing-12);
      min-height: 2.75rem;
      box-sizing: border-box;
      transition:
        border-color var(--duration-fast) ease,
        box-shadow var(--duration-fast) ease;
    }

    @media (hover: hover) and (pointer: fine) {
      :host(:not([disabled])) .field__control:hover {
        border-color: var(--color-brown-middle);
      }
    }

    .field__control:has(.field__input:focus-visible) {
      border-color: var(--color-brown-dark);
      box-shadow: 0 0 0 3px var(--color-theme-brown-background);
    }

    :host([disabled]) .field__control {
      background-color: var(--color-disabled-surface);
      cursor: not-allowed;
    }

    :host([readonly]) .field__control {
      background-color: var(--color-brown-light-bg);
    }

    .field__icon {
      grid-column: 1;
      /* app-icon pads its own host, which is too much inside a field. */
      padding: 0;
      padding-inline-end: var(--spacing-8);
      color: var(--color-brown-light);
      /* Clicks fall through to the control; delegatesFocus then focuses the input. */
      pointer-events: none;
    }

    .field__input {
      grid-column: 2;
      font: inherit;
      font-size: 0.813rem;
      color: var(--font-color);
      background: none;
      border: 0;
      padding: var(--spacing-8) 0;
      min-width: 0;
      width: 100%;
      box-sizing: border-box;
    }

    .field__input:focus {
      outline: none;
    }

    .field__input::placeholder {
      color: var(--color-brown-light);
    }

    /* type="search" draws a blue system clear button in Chrome that fights
       every colour in this palette, and no design here asks for one. */
    .field__input::-webkit-search-cancel-button {
      display: none;
    }

    .field__input:disabled {
      color: var(--color-disabled-content);
      cursor: not-allowed;
    }

    .field__suffix {
      grid-column: 3;
      justify-self: end;
      padding-inline-start: var(--spacing-8);
      font-size: var(--font-size-base);
      color: var(--color-brown-light);
      white-space: nowrap;
      /* Clicks fall through to the control; delegatesFocus then focuses the input. */
      pointer-events: none;
      user-select: none;
    }

    :host([disabled]) .field__suffix {
      color: var(--color-disabled-content);
    }

    :host(:state(invalid)) .field__control {
      border-color: var(--app-field-error-color);
    }

    :host(:state(invalid)) .field__control:has(.field__input:focus-visible) {
      box-shadow: var(--app-field-error-ring);
    }
  `;

  render() {
    // `.autocomplete` and `.step` are property bindings, not attributes. Both
    // IDL properties are typed by lib.dom exactly as this component holds them
    // (`AutoFill`, and a string because `step="any"` is legal), whereas the
    // bundled HTML attribute data lit-plugin type-checks templates against is
    // narrower for both — which is what the `as any` / `as unknown as number`
    // casts here used to be silencing. `''` is each property's own default, so
    // it means the same as omitting the attribute.
    const { hintId, errorId, message } = this.messages;
    const suffixId = `${this.fieldId}-suffix`;
    // The suffix is a unit, so it belongs in the accessible description.
    const described = describedBy(
      this.suffix && suffixId,
      this.helpText && hintId,
      message && errorId,
    );

    return html`
      <div class="field">
        <label
          class="field__label ${this.hideLabel ? "visually-hidden" : ""}"
          part="label"
          for=${this.fieldId}
        >
          ${this.label}${
            this.required
              ? html`<span
                  class="field__required"
                  part="required"
                  aria-hidden="true"
                >
                  *</span
                >`
              : nothing
          }
        </label>
        <div class="field__control" part="control">
          ${
            this.icon
              ? html`<app-icon
                  class="field__icon"
                  part="icon"
                  icon=${this.icon}
                ></app-icon>`
              : nothing
          }
          <input
            id=${this.fieldId}
            part="input"
            class="field__input"
            type=${this.type}
            name=${ifDefined(this.name || undefined)}
            .value=${live(this.value)}
            placeholder=${ifDefined(this.placeholder || undefined)}
            .autocomplete=${this.autocomplete}
            inputmode=${ifDefined(this.inputmode || undefined)}
            min=${ifDefined(this.min)}
            max=${ifDefined(this.max)}
            .step=${this.step ?? ""}
            minlength=${ifDefined(this.minlength)}
            maxlength=${ifDefined(this.maxlength)}
            pattern=${ifDefined(this.pattern)}
            ?required=${this.required}
            ?disabled=${this.disabled}
            ?readonly=${this.readonly}
            aria-invalid=${this.invalid ? "true" : "false"}
            aria-describedby=${ifDefined(described)}
            @input=${this.#onInput}
            @blur=${this.field.markTouched}
          />
          ${
            this.suffix
              ? html`<span class="field__suffix" part="suffix" id=${suffixId}
                  >${this.suffix}</span
                >`
              : nothing
          }
        </div>
        ${fieldMessages({ hintId, errorId, helpText: this.helpText, message })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-input": AppInput;
  }
}
