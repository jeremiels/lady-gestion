import { css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { BaseElement } from "../../commons/base-element.ts";
import { customizeFormStyles } from "../../commons/customize-form.styles.ts";
import { byOrder, type ResolvedCategory } from "../../data/categories.ts";

import "../app-icon/app-icon.ts";
import "../app-switch/app-switch.ts";

export type CategoryToggleDetail = { id: string; enabled: boolean };

/**
 * The Catégories tab of Personnaliser mon interface: every category, one row
 * each — its icon, its label and a switch.
 *
 * Flat on purpose, children listed at the same level as their parent: a
 * parent's switch does not reach its children, so a tree would suggest a
 * cascade that does not exist. Switching one off hides it, and every post
 * filed under it, from the whole UI; nothing is deleted.
 *
 * No way to add a category yet — a new one would need a form, and there is no
 * form builder to make one with.
 *
 * Presentational — the owning view holds the catalogue and writes the flag.
 *
 * @fires category-toggle - `{ id, enabled }`.
 */
@customElement("customize-categories")
export class CustomizeCategories extends BaseElement {
  /** The whole resolved catalogue, disabled rows included. */
  @property({ attribute: false }) categories: ResolvedCategory[] = [];

  static componentStyles = [
    customizeFormStyles,
    css`
      .item {
        display: block;
      }
    `,
  ];

  #onToggle = (id: string) => (event: CustomEvent<{ checked: boolean }>) => {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<CategoryToggleDetail>("category-toggle", {
        detail: { id, enabled: event.detail.checked },
        bubbles: true,
        composed: true,
      }),
    );
  };

  render() {
    return html`
      <section class="section">
        <ul class="list">
          ${repeat(
            byOrder(this.categories),
            (category) => category.id,
            (category) => html`
              <li class="item">
                <app-switch
                  label=${category.label}
                  .checked=${category.enabled}
                  @switch-change=${this.#onToggle(category.id)}
                ></app-switch>
              </li>
            `,
          )}
        </ul>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "customize-categories": CustomizeCategories;
  }
}
