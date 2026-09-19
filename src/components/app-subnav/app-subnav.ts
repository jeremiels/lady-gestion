import { css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { BaseElement } from "../../commons/base-element.ts";
import { segmentedStyles } from "../../commons/segmented.styles.ts";

export type SubnavItem = {
  /** Already a rendered href — `appHref()` applied by the caller. */
  href: string;
  label: string;
  /** Which page is on screen is the caller's answer, as for `nav-item`. */
  current: boolean;
};

/**
 * Second-level navigation: the sub-pages of one page, as a row of links.
 *
 * Looks exactly like `app-segmented` (both take `segmentedStyles`) but is not
 * one. A segmented control picks a value and is a radio group; this moves to
 * another URL, so it is a `<nav>` of real anchors with `aria-current="page"` —
 * deep-linkable, in the history, and intercepted by `Router` like every other
 * link, the history fallback included (it walks `composedPath()`, so a link in
 * this shadow root is found). No roving tabindex and no arrow keys: every link
 * is its own tab stop, as links are everywhere else.
 */
@customElement("app-subnav")
export class AppSubnav extends BaseElement {
  @property({ attribute: false }) items: SubnavItem[] = [];
  /** Names the nav landmark, e.g. "Sections de la fiche". */
  @property({ type: String }) label = "";

  static componentStyles = [
    ...segmentedStyles,
    css`
      /*
       * Full width, unlike a segmented control: a page's sub-nav spans its
       * column. Each link starts from its own text width and they share out
       * whatever is left, so a long label keeps its room instead of being
       * squeezed into an equal quarter.
       *
       * No padding of their own: the free space is what spaces the labels out.
       * Segmented's fixed 16px ran four labels 24px past the 338px column of a
       * 393px phone, and any fixed value only moves the width where that
       * happens — at 8px it was 320px. Without it they fit down to ~290px.
       *
       * Below that, a label is truncated rather than pushing the page sideways:
       * min-width: 0 lets a link shrink under its text width, and the
       * ellipsis says something was cut.
       */
      :host {
        display: flex;
        /* As a grid or flex item the host would otherwise refuse to go under
           its content width, and the truncation below would never kick in. */
        min-width: 0;
      }

      .segmented {
        display: flex;
        flex: 1;
        min-width: 0;
      }

      .segmented__option--text {
        display: grid;
        place-items: center;
        flex: 1 1 auto;
        min-width: 0;
        padding-inline: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        text-align: center;
        line-height: 1rem;
      }
    `,
  ];

  render() {
    return html`
      <nav class="segmented sliding-selection" aria-label=${this.label}>
        ${this.items.map(
          (item) => html`
            <a
              class=${classMap({
                segmented__option: true,
                "segmented__option--text": true,
                "segmented__option--current": item.current,
                // The pill anchors to this class — see sliding-selection.styles.
                "sliding-selection__active": item.current,
              })}
              href=${item.href}
              aria-current=${ifDefined(item.current ? "page" : undefined)}
              >${item.label}</a
            >
          `,
        )}
      </nav>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-subnav": AppSubnav;
  }
}
