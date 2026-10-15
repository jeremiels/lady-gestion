import { css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { BaseElement } from "../../commons/base-element.ts";
import type { ThemeKey } from "../../theme/theme.types.ts";
import { THEME_META } from "../../theme/theme.ts";
import { iconStyle } from "../app-icon/app-icon.ts";
import type { IconName } from "../app-icon/icons.ts";

import "../app-bottom-sheet/app-bottom-sheet.ts";
import "../app-icon/app-icon.ts";

export type IconPickDetail = { icon: IconName | null };

/**
 * The glyphs a category can wear: the app's domain icons, not its interface
 * ones — a chevron or a bin on a category tile would read as a control.
 */
export const CATEGORY_ICONS: readonly { icon: IconName; label: string }[] = [
  { icon: "firstAidKit", label: "Trousse de soins" },
  { icon: "tooth", label: "Dent" },
  { icon: "footprints", label: "Empreintes" },
  { icon: "heart", label: "Cœur" },
  { icon: "pawPrint", label: "Patte" },
  { icon: "cheval", label: "Cheval" },
  { icon: "cowboyHat", label: "Chapeau" },
  { icon: "cactus", label: "Cactus" },
  { icon: "carrot", label: "Carotte" },
  { icon: "shoppingCart", label: "Panier" },
  { icon: "farm", label: "Ferme" },
  { icon: "currencyEur", label: "Euro" },
  { icon: "date", label: "Calendrier" },
  { icon: "file", label: "Fichier" },
  { icon: "folder", label: "Dossier" },
  { icon: "pen", label: "Stylo" },
  { icon: "user", label: "Personne" },
  { icon: "home", label: "Maison" },
  { icon: "info", label: "Information" },
];

/**
 * Picks a category's icon, drawn in the category's own colour so the choice
 * looks the way the tile will. A child category may instead take its
 * parent's — `inherited` names that icon.
 *
 * @fires icon-pick - `{ icon }`, `null` for "take the parent's". The owner
 * clears `open`.
 * @fires sheet-close - From the inner `app-bottom-sheet`, on dismissal.
 */
@customElement("icon-picker-sheet")
export class IconPickerSheet extends BaseElement {
  @property({ type: Boolean }) open = false;
  /** The icon picked now; `null` while it is inherited. */
  @property({ attribute: false }) value: IconName | null = null;
  /** The colour the icons are drawn in. */
  @property({ attribute: false }) theme: ThemeKey = "taupe";
  /** The parent's icon, offered as "inherit" — `null` for a root. */
  @property({ attribute: false }) inherited: IconName | null = null;

  static componentStyles = css`
    :host {
      display: contents;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(3.25rem, 1fr));
      gap: var(--spacing-8);
      margin: 0;
      padding: 0 0 var(--spacing-16);
      list-style: none;
    }

    .option {
      appearance: none;
      display: grid;
      place-items: center;
      width: 100%;
      aspect-ratio: 1;
      padding: 0;
      border: 2px solid transparent;
      border-radius: var(--radius-12);
      background: var(--color-white);
      cursor: pointer;
    }

    .option[aria-pressed="true"] {
      border-color: var(--color-brown-dark);
    }

    .option:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }

    .inherit {
      appearance: none;
      display: flex;
      align-items: center;
      gap: var(--spacing-12);
      width: 100%;
      margin-bottom: var(--spacing-12);
      padding: var(--spacing-8) var(--spacing-12);
      border: 2px solid transparent;
      border-radius: var(--radius-12);
      background: var(--color-white);
      font: inherit;
      font-weight: 600;
      color: var(--color-brown-dark);
      cursor: pointer;
    }

    .inherit[aria-pressed="true"] {
      border-color: var(--color-brown-dark);
    }
  `;

  #pick(icon: IconName | null) {
    this.dispatchEvent(
      new CustomEvent<IconPickDetail>("icon-pick", {
        detail: { icon },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #glyph(icon: IconName) {
    return html`<app-icon
      .icon=${icon}
      style=${styleMap(iconStyle(THEME_META[this.theme]))}
    ></app-icon>`;
  }

  render() {
    return html`
      <app-bottom-sheet heading="Icône" .open=${this.open}>
        ${
          this.inherited
            ? html`<button
                class="inherit pressable"
                type="button"
                aria-pressed=${this.value === null}
                @click=${() => this.#pick(null)}
              >
                ${this.#glyph(this.inherited)} Celle de la catégorie parente
              </button>`
            : nothing
        }
        <ul class="grid">
          ${CATEGORY_ICONS.map(
            ({ icon, label }) => html`
              <li>
                <button
                  class="option pressable"
                  type="button"
                  aria-label=${label}
                  aria-pressed=${this.value === icon}
                  @click=${() => this.#pick(icon)}
                >
                  ${this.#glyph(icon)}
                </button>
              </li>
            `,
          )}
        </ul>
      </app-bottom-sheet>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "icon-picker-sheet": IconPickerSheet;
  }
}
