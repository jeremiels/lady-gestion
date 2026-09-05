import { css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";

/**
 * A filter pill.
 *
 * Presentational: it renders a toggle button and lets the native click bubble
 * (retargeted to the host, so `@click` on `<app-chip>` works). Which chips are
 * selected, and whether that is one or several, is the owning view's business.
 */
@customElement("app-chip")
export class AppChip extends BaseElement {
  @property({ type: String }) label = "";
  @property({ type: Boolean, reflect: true }) selected = false;

  static componentStyles = css`
    :host {
      display: inline-flex;
    }

    .chip {
      border: none;
      border-radius: var(--radius-pill);
      padding: var(--spacing-4) var(--spacing-12);
      background: var(--color-white);
      color: var(--color-brown-middle);
      font-family: inherit;
      font-size: 0.875rem;
      font-weight: 600;
      line-height: 1.0625rem;
      white-space: nowrap;
      cursor: pointer;
      transition:
        background-color var(--duration-fast) ease,
        color var(--duration-fast) ease;
    }

    :host([selected]) .chip {
      background: var(--color-brown-dark);
      color: var(--color-white);
      font-weight: 600;
    }

    .chip:focus-visible {
      outline: 2px solid var(--color-brown-dark);
      outline-offset: 2px;
    }
  `;

  render() {
    return html`
      <button
        class="chip"
        type="button"
        aria-pressed=${this.selected ? "true" : "false"}
      >
        ${this.label}
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-chip": AppChip;
  }
}
