import { css, html } from "lit";
import { customElement } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";

/**
 * The Ration tab of Personnaliser mon interface. A placeholder until its
 * content is designed: only the title, so the sub-nav has somewhere to land.
 */
@customElement("customize-ration")
export class CustomizeRation extends BaseElement {
  static componentStyles = css`
    :host {
      display: block;
    }

    .title {
      margin: 0;
      font-family: var(--font-family-heading);
      font-size: 1.125rem;
      line-height: 1.25rem;
      font-weight: 700;
    }
  `;

  render() {
    return html`<h2 class="title">Ration</h2>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "customize-ration": CustomizeRation;
  }
}
