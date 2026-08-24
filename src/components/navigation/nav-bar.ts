import { css, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { BaseElement } from '../../commons/base-element.ts';

/** Layout shell for the fixed bottom navigation. Items are slotted in by `app-root`. */
@customElement('nav-bar')
export class NavBar extends BaseElement {
  static componentStyles = css`
    /* Two boxes, deliberately. The surface spans the viewport — it is the
       fixed element at the bottom edge, and anything narrower lets the page
       scroll visibly past it on a wide window. The items inside it track the
       content column instead, or they drift to the far corners while the
       content above stays centred. */
    .nav-bar {
      background-color: var(--color-page);
      /* The bar is fixed to the bottom edge, so on a notched phone in
         standalone mode its labels would sit under the home indicator.
         The .main-content rule already reserves this inset on the assumption
         that the bar absorbs it. */
      padding-block: var(--spacing-16);
      padding-bottom: calc(var(--spacing-16) + env(safe-area-inset-bottom, 0px));
    }

    .nav-bar__items {
      display: flex;
      justify-content: space-around;
      align-items: center;
      /* The same column .main-content uses, down to the inline padding, so the
         outermost items line up with the content above them rather than landing
         4px off. The token pierces the shadow boundary like every other. */
      max-width: var(--content-max-width);
      margin-inline: auto;
      padding-inline: var(--spacing-20);
    }
  `;

  render() {
    return html`
      <nav class="nav-bar">
        <div class="nav-bar__items">
          <slot></slot>
        </div>
      </nav>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'nav-bar': NavBar;
  }
}
