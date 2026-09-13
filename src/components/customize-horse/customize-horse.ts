import { css, html } from "lit";
import { customElement } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";

/**
 * The Cheval tab of Personnaliser mon interface. A placeholder until its
 * content is designed: only the title, so the sub-nav has somewhere to land.
 */
@customElement("customize-horse")
export class CustomizeHorse extends BaseElement {
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
    return html`<h2 class="title">Cheval</h2>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "customize-horse": CustomizeHorse;
  }
}
