import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { BaseElement } from '../../commons/base-element.ts';
import type { ThemeMeta } from '../../theme/theme.ts';

/**
 * Fills the two custom properties below from any theme, for `styleMap`.
 *
 * The mirror of `iconStyle` in `app-icon.ts`, and there for the same reason:
 * this component used to resolve an `EventTypeKey` itself, which meant the
 * event taxonomy could name a tag and the document taxonomy could not — so
 * `EventDetailView` already passed these two properties by hand for documents.
 * That hand-written path is now the only path, and it serves both.
 */
export const tagStyle = (theme: ThemeMeta) => ({
  '--app-tag-color': theme.color,
  '--app-tag-background': theme.backgroundColor,
});

/**
 * A small coloured pill naming a category.
 *
 * Domain-free: it takes the words and the colours, and knows nothing about what
 * is being labelled. Shadow DOM, like every other reusable component here — it
 * used to render into light DOM and take its colours from global `.tag--<type>`
 * rules, which forced every ancestor to be light DOM too. The colours come in
 * as custom properties, which pierce shadow boundaries, so nothing above it has
 * to give up encapsulation to render a tag.
 */
@customElement('app-tag')
export class AppTag extends BaseElement {
  @property({ type: String }) label = '';

  static componentStyles = css`
    :host {
      display: inline-block;
    }

    .tag {
      display: inline-block;
      padding: var(--spacing-2) var(--spacing-6);
      border-radius: var(--radius-pill);
      background-color: var(--app-tag-background, var(--color-brown-middle));
      color: var(--app-tag-color, var(--color-white));
      font-weight: 600;
      font-size: 0.688rem;
    }
  `;

  // The two custom properties fall back to the component's own defaults in the
  // stylesheet above, so a tag rendered without a theme is still legible.
  render() {
    return html`<span class="tag">${this.label}</span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-tag': AppTag;
  }
}
