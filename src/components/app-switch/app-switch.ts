import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { live } from 'lit/directives/live.js';
import { BaseElement } from '../../commons/base-element.ts';

let nextId = 0;

/**
 * An on/off preference toggle, form-associated like the other fields.
 *
 * Built on a real checkbox with `role="switch"`: that keeps the native label
 * wiring, the space-bar behaviour and form submission, while a screen reader
 * announces "activé/désactivé" instead of "coché".
 *
 * **The one form-associated field that does not extend `FormFieldElement`, on
 * purpose.** That base class exists to share validity plumbing — `required`,
 * `error`, `invalid`, `touched`, a `FormControl` mirroring a native control's
 * `validity`. A switch has no constraint to violate; it is always in one of two
 * valid states. Inheriting the machinery would hand it a `required` property
 * that cannot fail and an error slot nothing can fill. What it actually shares
 * with the other three — `attachInternals`, a `form` getter, the reset and
 * restore callbacks — is the handful of lines below.
 *
 * Lays itself out as a full row (label left, track right) so it drops straight
 * into a `.container` card without a wrapper.
 *
 * @fires switch-change - `{ checked: boolean }`. Listen for this, not the
 * native `change`, which is `composed: false` and never leaves the shadow root.
 */
@customElement('app-switch')
export class AppSwitch extends BaseElement {
  static formAssociated = true;

  static shadowRootOptions = { ...BaseElement.shadowRootOptions, delegatesFocus: true };

  @property({ type: String }) label = '';
  @property({ type: String }) name = '';
  @property({ type: String }) value = 'on';
  @property({ type: Boolean, reflect: true }) checked = false;
  @property({ type: Boolean, reflect: true }) disabled = false;

  readonly #internals: ElementInternals;
  readonly #id = `app-switch-${++nextId}`;
  #defaultChecked = false;

  constructor() {
    super();
    this.#internals = this.attachInternals();
  }

  protected firstUpdated() {
    this.#defaultChecked = this.checked;
    this.#setFormValue();
  }

  protected updated() {
    this.#setFormValue();
  }

  // --- Form-associated custom element lifecycle ---

  formResetCallback() {
    this.checked = this.#defaultChecked;
  }

  formDisabledCallback(disabled: boolean) {
    this.disabled = disabled;
  }

  formStateRestoreCallback(state: string | FormData | null) {
    this.checked = typeof state === 'string';
  }

  get form(): HTMLFormElement | null {
    return this.#internals.form;
  }

  #setFormValue() {
    this.#internals.setFormValue(this.checked ? this.value : null);
  }

  /**
   * The native `change` event is not composed, so it stops at the shadow
   * boundary — a consumer listening on `<app-switch>` would never hear it.
   * Re-emit it under the app's own event name.
   */
  #onChange = (event: Event) => {
    this.checked = (event.target as HTMLInputElement).checked;
    this.dispatchEvent(
      new CustomEvent('switch-change', {
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

    .switch {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-12);
      cursor: pointer;
    }

    :host([disabled]) .switch {
      cursor: not-allowed;
    }

    .switch__label {
      font-size: var(--font-size-base);
      color: var(--font-color);
    }

    :host([disabled]) .switch__label {
      color: var(--color-brown-light);
    }

    .switch__track {
      appearance: none;
      position: relative;
      flex-shrink: 0;
      margin: 0;
      width: 2.75rem;
      height: 1.625rem;
      border-radius: var(--radius-pill);
      background-color: var(--color-control-track);
      cursor: inherit;
      transition: background-color var(--duration-medium) ease;
    }

    .switch__track:checked {
      background-color: var(--color-brown-dark);
    }

    .switch__track:disabled {
      background-color: var(--color-disabled-line);
    }

    /* Knob and check mark are two pseudo-elements sliding by the same amount,
       so the mark stays centred in the knob for the whole travel. */
    .switch__track::before,
    .switch__track::after {
      content: '';
      position: absolute;
      top: 50%;
      transition:
        transform var(--duration-medium) var(--easing-out),
        opacity var(--duration-medium) var(--easing-out);
    }

    .switch__track::before {
      left: 0.1875rem;
      width: 1.25rem;
      height: 1.25rem;
      border-radius: var(--radius-pill);
      background-color: var(--color-white);
      transform: translateY(-50%);
    }

    .switch__track::after {
      left: 0.5rem;
      width: 0.625rem;
      height: 0.625rem;
      background-color: var(--color-brown-dark);
      /* Same tick as app-checkbox — no icon component inside a form control. */
      clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 45% 62%);
      transform: translateY(-50%) scale(0.9);
      opacity: 0;
    }

    .switch__track:checked::before {
      transform: translateY(-50%) translateX(1.125rem);
    }

    .switch__track:checked::after {
      transform: translateY(-50%) translateX(1.125rem) scale(1);
      opacity: 1;
    }

    .switch__track:disabled::after {
      background-color: var(--color-disabled-content);
    }

    .switch__track:focus-visible {
      outline: 2px solid var(--color-brown-dark);
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      .switch__track::before,
      .switch__track::after {
        transition: opacity var(--duration-medium) var(--easing-out);
      }
    }
  `;

  render() {
    return html`
      <label class="switch" part="row" for=${this.#id}>
        <span class="switch__label" part="label">${this.label}</span>
        <input
          id=${this.#id}
          part="track"
          class="switch__track"
          type="checkbox"
          role="switch"
          name=${ifDefined(this.name || undefined)}
          value=${this.value}
          .checked=${live(this.checked)}
          ?disabled=${this.disabled}
          @change=${this.#onChange}
        />
      </label>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-switch': AppSwitch;
  }
}
