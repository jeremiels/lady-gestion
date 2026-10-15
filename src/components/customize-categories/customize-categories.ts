import { css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { live } from "lit/directives/live.js";
import { BaseElement } from "../../commons/base-element.ts";
import { appHref } from "../../commons/base-path.ts";
import { customizeFormStyles } from "../../commons/customize-form.styles.ts";
import { categoryEditorPath } from "../../commons/sections.ts";
import { byOrder, type ResolvedCategory } from "../../data/categories.ts";

import "../app-icon/app-icon.ts";
import "../app-switch/app-switch.ts";

export type CategoryToggleDetail = { id: string; enabled: boolean };

/**
 * The Catégories tab of Personnaliser mon interface: every category, one row
 * each — its label, a switch, and a pencil opening it in the form builder —
 * under "Nouvelle catégorie".
 *
 * Flat on purpose, children listed at the same level as their parent: a
 * parent's switch does not reach its children, so a tree would suggest a
 * cascade that does not exist. Switching one off hides it, and every post
 * filed under it, from the whole UI; nothing is deleted.
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
        grid-template-columns: minmax(0, 1fr) auto;
      }

      .new {
        display: block;
        padding: var(--spacing-12) var(--spacing-16);
        border-radius: var(--radius-8);
        background: var(--color-brown-dark);
        color: var(--color-white);
        font-weight: 600;
        text-align: center;
        text-decoration: none;
      }

      .edit {
        display: grid;
        place-items: center;
        width: 2.25rem;
        height: 2.25rem;
        border-radius: var(--radius-8);
        color: var(--color-brown-dark);
      }

      .new:focus-visible,
      .edit:focus-visible {
        outline: var(--focus-ring);
        outline-offset: var(--focus-ring-offset);
      }

      .edit app-icon {
        --icon-size: 1rem;

        padding: 0;
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
        <a class="new pressable" href=${appHref(categoryEditorPath(null))}>
          Nouvelle catégorie
        </a>
        <ul class="list">
          ${repeat(
            byOrder(this.categories),
            (category) => category.id,
            (category) => html`
              <li class="item">
                <app-switch
                  label=${category.label}
                  .checked=${live(category.enabled)}
                  @switch-change=${this.#onToggle(category.id)}
                ></app-switch>
                <a
                  class="edit pressable pressable--small"
                  href=${appHref(categoryEditorPath(category.id))}
                  aria-label=${`Modifier « ${category.label} »`}
                >
                  <app-icon icon="pen"></app-icon>
                </a>
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
