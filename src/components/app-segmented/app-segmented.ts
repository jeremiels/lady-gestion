import { css, html, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { BaseElement } from '../../commons/base-element.ts';
import { slidingSelectionStyles } from '../../commons/sliding-selection.styles.ts';
import type { IconName } from '../app-icon/icons.ts';

import '../app-icon/app-icon.ts';

export type SegmentedOption = {
  value: string;
  /** Use `undefined` to show `label` as text instead. */
  icon: IconName | undefined;
  /** The visible text in a text segment; the accessible name in an icon one. */
  label: string;
};

/**
 * A segmented control: pick exactly one of a handful of options.
 *
 * Segments show an icon where the option has one and their label as text where
 * it doesn't — "Mois | Année" needs words, a calendar/list switch doesn't. The
 * two are not mixed within one control by anything today, but nothing stops it.
 *
 * Exposed as a radio group rather than a set of toggle buttons — the choice is
 * mutually exclusive, so a screen reader should hear "1 of 2" and the arrow
 * keys should move between segments, which `aria-pressed` buttons don't give.
 * A single tab stop, like the calendar grid.
 *
 * @fires segment-change - `{ value: string }`. Fired only when the value
 * actually changes; re-selecting the active segment is a no-op.
 */
@customElement('app-segmented')
export class AppSegmented extends BaseElement {
  @property({ attribute: false }) options: SegmentedOption[] = [];
  @property({ type: String }) value = '';
  /** Names the group itself, e.g. "Affichage". */
  @property({ type: String }) label = '';

  // The shared pill first, so the rules below still win at equal specificity.
  static componentStyles = [
    slidingSelectionStyles,
    css`
      :host {
        display: inline-flex;
      }

      .segmented {
        display: inline-flex;
        gap: var(--spacing-4);
        padding: var(--spacing-4);
        border-radius: var(--radius-pill);
        background: var(--color-brown-light-bg);
      }

      .segmented__option {
        display: grid;
        place-items: center;
        width: 2.5rem;
        height: 2.25rem;
        padding: 0;
        border: none;
        border-radius: var(--radius-pill);
        background: transparent;
        font: inherit;
        color: var(--color-brown-light);
        cursor: pointer;
        /* The ink is on the same clock as the pill that travels under it —
           at --duration-fast the incoming label finished darkening 50ms
           before the pill arrived beneath it. */
        transition:
          background-color var(--duration-fast) ease,
          color var(--duration-medium) var(--easing-standard);
      }

      /* A word cannot live in the fixed square an icon sits in. */
      .segmented__option--text {
        width: auto;
        padding-inline: var(--spacing-16);
        font-size: 0.9375rem;
        font-weight: 600;
        white-space: nowrap;
      }

      .segmented__option[aria-checked='true'] {
        background: var(--color-white);
        color: var(--color-brown-dark);
      }

      /*
       * Where the pill exists it is the selected surface, and this one has to
       * go: the segment being left keeps its own background for as long as it
       * takes to fade, which is a second white shape sitting in the path of the
       * one still travelling. The colour above stays — it carries the state on
       * both paths.
       */
      @supports (anchor-name: --sliding-selection) {
        .segmented__option[aria-checked='true'] {
          background: transparent;
        }
      }

      .segmented__option:focus-visible {
        outline: 2px solid var(--color-brown-dark);
        outline-offset: 2px;
      }
    `,
  ];

  #select = (value: string) => {
    if (value === this.value) return;
    this.value = value;
    this.dispatchEvent(
      new CustomEvent('segment-change', {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
  };

  /** Arrows move *and* select, which is the expected behaviour for a radio group. */
  #onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (step === undefined) return;

    const index = this.options.findIndex((option) => option.value === this.value);
    const next = this.options[(index + step + this.options.length) % this.options.length];
    if (!next) return;

    event.preventDefault();
    this.#select(next.value);
    // The focus move happens in `updated()`, once the new tab stop exists.
  };

  protected updated(changed: PropertyValues<this>) {
    if (!changed.has('value')) return;

    // Move DOM focus onto the newly selected segment — but only when a segment
    // already holds it. Lit renders asynchronously, so doing this straight after
    // `#select()` queried the *old* DOM and re-focused the segment being left,
    // stranding focus on an element that had just become `tabindex="-1"`.
    // Guarded so a programmatic `.value` change from a view can't steal focus.
    const root = this.renderRoot as ShadowRoot;
    if (!root.activeElement?.classList.contains('segmented__option')) return;

    root.querySelector<HTMLButtonElement>('.segmented__option[tabindex="0"]')?.focus();
  }

  render() {
    return html`
      <div
        class="segmented sliding-selection"
        role="radiogroup"
        aria-label=${this.label}
        @keydown=${this.#onKeyDown}
      >
        ${this.options.map((option) => {
          const checked = option.value === this.value;
          // aria-label only in icon mode: where the label is visible it already
          // *is* the accessible name, and setting it again announces it twice.
          return html`
            <button
              class=${classMap({
                'segmented__option': true,
                'segmented__option--text': !option.icon,
                // Moving this class is the whole animation — the pill anchors
                // to it and the browser interpolates the rest.
                'sliding-selection__active': checked,
              })}
              type="button"
              role="radio"
              aria-checked=${checked ? 'true' : 'false'}
              aria-label=${ifDefined(option.icon ? option.label : undefined)}
              tabindex=${checked ? 0 : -1}
              @click=${() => this.#select(option.value)}
            >
              ${option.icon ? html`<app-icon .icon=${option.icon}></app-icon>` : option.label}
            </button>
          `;
        })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-segmented': AppSegmented;
  }
}
