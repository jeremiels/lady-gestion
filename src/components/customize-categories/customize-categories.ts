import { css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";
import { BaseElement } from "../../commons/base-element.ts";
import { byOrder, type ResolvedCategory } from "../../data/categories.ts";
import { THEME_META } from "../../theme/theme.ts";
import { iconStyle } from "../app-icon/app-icon.ts";

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

  static componentStyles = css`
    :host {
      display: grid;
      gap: var(--spacing-8);
    }

    /* Restated from customize-form.styles.ts, which a shadow root does not
       see — the same section title and white list as Profil and Cheval. */
    .title {
      margin: 0;
      font-size: 0.75rem;
      line-height: 0.875rem;
      font-weight: bold;
      color: var(--color-brown-middle);
    }

    .list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      list-style: none;
      margin: 0;
      padding: var(--spacing-12);
      border-radius: var(--radius-12);
      background-color: var(--color-white);
    }

    .item {
      display: grid;
      grid-template-columns: auto 1fr;
      align-items: center;
      column-gap: var(--spacing-12);
    }

    .item:not(:last-child) {
      border-bottom: 1px solid var(--color-divider);
      padding-bottom: 1rem;
    }

    .item__icon {
      --icon-size: 1rem;
    }
  `;

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
      <h2 class="title">Catégories affichées</h2>
      <ul class="list">
        ${repeat(
          byOrder(this.categories),
          (category) => category.id,
          (category) => html`
            <li class="item">
              <app-icon
                class="item__icon"
                aria-hidden="true"
                .icon=${category.icon}
                style=${styleMap(iconStyle(THEME_META[category.theme]))}
              ></app-icon>
              <app-switch
                label=${category.label}
                .checked=${category.enabled}
                @switch-change=${this.#onToggle(category.id)}
              ></app-switch>
            </li>
          `,
        )}
      </ul>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "customize-categories": CustomizeCategories;
  }
}
