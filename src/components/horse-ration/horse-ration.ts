import { css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { repeat } from "lit/directives/repeat.js";
import { BaseElement } from "../../commons/base-element.ts";
import { todayISO, type IsoDate } from "../../data/dates.ts";
import {
  formatSeasonRange,
  isInSeason,
  summariseSuspension,
} from "../../data/seasons.ts";
import type { RationItem } from "../../data/types.ts";
import {
  RATION_UNIT_LABEL,
  formatRationAmount,
} from "../../types/horse.types.ts";

import "../app-icon/app-icon.ts";

export type RationRowDetail = { id: string };

/**
 * The horse's daily ration: one row per product, struck through when out of
 * season, and a footnote saying what is suspended.
 *
 * Presentational — the owning view runs the query and owns the edit sheet and
 * the delete confirmation; this only asks for them. Read-only on the horse
 * page; `editable` on Personnaliser mon interface › Ration adds a pencil and a
 * bin to every row.
 *
 * @fires ration-edit - `{ id: string }`, a row's pencil was pressed.
 * @fires ration-delete - `{ id: string }`, a row's bin was pressed.
 */
@customElement("horse-ration")
export class HorseRation extends BaseElement {
  @property({ attribute: false }) rations: RationItem[] = [];

  /**
   * Resolved once by the caller and threaded through: the rows and the
   * footnote must agree about what is suspended, and both default to "now" if
   * left to themselves.
   */
  @property({ type: String }) today: IsoDate = todayISO();

  /** Shows the per-row edit and delete buttons. */
  @property({ type: Boolean }) editable = false;

  static componentStyles = css`
    :host {
      display: grid;
      gap: var(--spacing-12);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    /* Restated rather than inherited: \`.section-title\` lives in the document's
       components layer, which a shadow root does not see. Kept in step with
       styles/components/section.css by hand, as week-strip does. */
    .title {
      margin: 0;
      font-family: var(--font-family-heading);
      font-size: 1.125rem;
      line-height: 1.25rem;
      font-weight: 700;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: var(--spacing-8);
      margin-inline-start: auto;
      flex-shrink: 0;
    }

    .action-button {
      appearance: none;
      display: grid;
      place-items: center;
      background: none;
      border: none;
      padding: var(--spacing-4);
      border-radius: var(--radius-8);
      color: var(--color-brown-dark);
      cursor: pointer;
    }

    @media (hover: hover) and (pointer: fine) {
      .action-button:hover {
        background: var(--color-brown-light-bg);
      }
    }

    /* Sized on the glyph, not on \`app-icon\`'s host — the host carries its own
       padding, so constraining it instead squeezes the SVG to a sliver. */
    .action-button app-icon {
      --icon-size: 1rem;

      padding: 0;
    }

    .list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-12);
      list-style: none;
      margin: 0;
      padding: var(--spacing-16);
      border-radius: var(--radius-12);
      background-color: var(--color-white);
    }

    .item {
      display: flex;
      align-items: center;
      gap: var(--spacing-12);
    }

    .item:not(:last-child) {
      border-bottom: 1px solid var(--color-divider);
      padding-bottom: var(--spacing-12);
    }

    .item__marker {
      flex-shrink: 0;
      width: 0.375rem;
      height: 0.375rem;
      border-radius: var(--radius-pill);
      background: var(--color-brown-light);
    }

    .item__content {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
      min-width: 0;
    }

    .item__text {
      display: grid;
      gap: var(--spacing-2);
      min-width: 0;
    }

    .item__label {
      font-weight: 600;
      font-size: var(--font-size-sm);
      line-height: 1.25rem;
      color: var(--font-color);
    }

    .item__season {
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--color-brown-light);
    }

    .item__separator {
      flex-shrink: 0;
      font-size: 0.625rem;
    }

    .item__quantity {
      font-size: var(--font-size-sm);
      display: flex;
      align-items: baseline;
      gap: var(--spacing-4);
      white-space: nowrap;
    }

    .item__amount {
      font-size: var(--font-size-sm);
      font-weight: 700;
      color: var(--font-color);
    }

    .item__unit {
      font-size: var(--font-size-sm);
      font-weight: 500;
      color: var(--color-brown-light);
    }

    /* Out of season. Struck through rather than hidden: the line is still part
       of the plan, it is just not being fed today. \`line-through\` sits on the
       text spans, not the row, so it doesn't drag a rule across the whole card. */
    .item--suspended {
      opacity: 0.45;
    }

    .item--suspended .item__label,
    .item--suspended .item__season,
    .item--suspended .item__quantity {
      text-decoration: line-through;
    }

    .note {
      display: flex;
      align-items: center;
      gap: var(--spacing-8);
      margin: 0;
      padding: var(--spacing-12);
      border-radius: var(--radius-12);
      background: var(--color-brown-light-bg);
      font-size: 0.8125rem;
      color: var(--color-brown-middle);
    }

    .note__icon {
      flex-shrink: 0;
      padding: 0;
      color: var(--color-brown-middle);
      --icon-size: 1.125rem;
    }

    .empty {
      margin: 0;
      font-size: var(--font-size-sm);
      color: var(--color-brown-middle);
    }
  `;

  render() {
    const note = summariseSuspension(
      this.rations.map((ration) => ration.season),
      this.today,
    );

    return html`
      ${
        this.rations.length === 0
          ? html`<p class="empty">Aucune ration enregistrée pour le moment.</p>`
          : html`
              <ul class="list">
                ${repeat(
                  this.rations,
                  (ration) => ration.id,
                  (ration) => this.#renderItem(ration),
                )}
              </ul>
            `
      }
      ${
        note
          ? html`
              <p class="note">
                <app-icon class="note__icon" icon="info"></app-icon>
                <span>${note}</span>
              </p>
            `
          : nothing
      }
    `;
  }

  #renderItem(ration: RationItem) {
    const suspended = !isInSeason(ration.season, this.today);

    return html`
      <li class=${classMap({ item: true, "item--suspended": suspended })}>
        <span class="item__marker" aria-hidden="true"></span>
        <div class="item__content">
          <span class="item__text">
            <span class="item__label">
              <!-- The strike-through is the only visual cue, and it reaches no
                   screen reader — so the state is spelled out here instead. -->
              ${suspended ? html`<span class="visually-hidden">Suspendu — </span>` : nothing}
              ${ration.label}
            </span>
            ${
              ration.season
                ? html`<span class="item__season"
                    >${formatSeasonRange(ration.season)}</span
                  >`
                : nothing
            }
          </span>
          <span class="item__separator">•</span>
          <span class="item__quantity">
            <span class="item__amount"
              >${formatRationAmount(ration.quantity)}</span
            >
            <span class="item__unit">${RATION_UNIT_LABEL[ration.unit]}</span>
          </span>
        </div>
        ${this.editable ? this.#renderActions(ration) : nothing}
      </li>
    `;
  }

  #renderActions(ration: RationItem) {
    return html`
      <span class="actions">
        <button
          class="action-button pressable pressable--small"
          type="button"
          aria-label="Modifier ${ration.label}"
          @click=${() => this.#emit("ration-edit", ration.id)}
        >
          <app-icon icon="pen"></app-icon>
        </button>
        <button
          class="action-button pressable pressable--small"
          type="button"
          aria-label="Supprimer ${ration.label}"
          @click=${() => this.#emit("ration-delete", ration.id)}
        >
          <app-icon icon="trash"></app-icon>
        </button>
      </span>
    `;
  }

  #emit(type: "ration-edit" | "ration-delete", id: string) {
    this.dispatchEvent(
      new CustomEvent<RationRowDetail>(type, {
        detail: { id },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "horse-ration": HorseRation;
  }
}
