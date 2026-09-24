import { css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";
import { appHref } from "../../commons/base-path.ts";
import { formatMonthDe, monthOf } from "../../data/seasons.ts";
import { todayISO, type IsoDate } from "../../data/dates.ts";
import { formatCents } from "../../data/money.ts";

/**
 * This month's spend.
 *
 * Presentational — the owning view runs the query and passes the total down, so
 * the card stays reusable for another period. It used to hardcode "300 €" and
 * "Budget d'août", the month being a string literal that would still have said
 * août in December.
 */
@customElement("budget-card")
export class BudgetCard extends BaseElement {
  /** Total spend for `month`, in integer cents. `null` renders as "—". */
  @property({ attribute: false }) totalCents: number | null = null;

  /** Any day in the month being summarised. */
  @property({ type: String }) month: IsoDate = todayISO();

  static componentStyles = css`
    :host {
      display: block;
    }

    /* The whole card is the target, and the link text a screen reader announces
       is "Dépenses" plus the amount rather than a "voir" tacked on the end.

       height: 100% rather than the stretch keyword, which WebKit only knows
       prefixed: the host is a grid item stretched to the row documents-card
       sets, so its height is definite and the percentage resolves everywhere. */
    .budget__link {
      display: block;
      color: inherit;
      text-decoration: none;
      border-radius: var(--radius-12);
      height: 100%;
    }

    .budget__link:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }

    .budget {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: flex-start;
      padding: var(--spacing-16);
      background-color: var(--color-card-budget);
      border-radius: var(--radius-12);
      color: var(--color-white);
      height: 100%;
    }

    .budget__info {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }

    .budget__title {
      font-size: 0.813rem;
      line-height: 1rem;
      font-weight: 500;
    }

    .budget__subtitle {
      font-size: 0.625rem;
      line-height: 0.75rem;
      color: var(--color-text-muted-on-dark);
      font-weight: 500;
    }

    .budget__amount {
      font-size: 1.313rem;
      line-height: 1.625rem;
      font-weight: 700;
    }
  `;

  render() {
    const month = monthOf(this.month);

    // An anchor rather than a click handler: the Navigation API intercepts it
    // for free, and where that API is missing this still works as a real page
    // load — the service worker answers any path with the cached shell.
    return html`
      <a class="budget__link pressable" href="${appHref("/budget")}">
        <section class="budget">
          <div class="budget__info">
            <h2 class="budget__title">Dépenses</h2>
            <div class="budget__subtitle">
              ${month === null ? "Du mois" : `Du mois ${formatMonthDe(month)}`}
            </div>
          </div>
          <div class="budget__amount">${formatCents(this.totalCents)}</div>
        </section>
      </a>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "budget-card": BudgetCard;
  }
}
