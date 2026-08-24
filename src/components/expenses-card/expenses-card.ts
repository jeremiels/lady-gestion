import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { BaseElement } from '../../commons/base-element.ts';
import { appHref } from '../../commons/base-path.ts';
import { formatMonthDe, monthOf } from '../../data/seasons.ts';
import { todayISO, type IsoDate } from '../../data/dates.ts';
import { formatCents } from '../../data/money.ts';

/**
 * This month's spend.
 *
 * Presentational — the owning view runs the query and passes the total down, so
 * the card stays reusable for another period. It used to hardcode "300 €" and
 * "Budget d'août", the month being a string literal that would still have said
 * août in December.
 */
@customElement('expenses-card')
export class ExpensesCard extends BaseElement {
  /** Total spend for `month`, in integer cents. `null` renders as "—". */
  @property({ attribute: false }) totalCents: number | null = null;

  /** Any day in the month being summarised. */
  @property({ type: String }) month: IsoDate = todayISO();

  static componentStyles = css`
    /* The whole card is the target, and the link text a screen reader announces
       is "Dépenses" plus the amount rather than a "voir" tacked on the end. */
    .expenses__link {
      display: block;
      color: inherit;
      text-decoration: none;
      border-radius: var(--radius-12);
    }

    .expenses__link:focus-visible {
      outline: 2px solid var(--color-brown-dark);
      outline-offset: 2px;
    }

    .expenses {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--spacing-20);
      background-color: var(--color-card-expenses);
      border-radius: var(--radius-12);
      color: var(--color-white);
    }

    .expenses__info {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }

    .expenses__title {
      font-size: 0.813rem;
      line-height: 1.25rem;
      font-weight: 700;
    }

    .expenses__subtitle {
      font-size: 0.813rem;
      line-height: 1.25rem;
      color: var(--color-text-muted-on-dark);
      font-weight: 500;
    }

    .expenses__amount {
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
      <a class="expenses__link pressable" href="${appHref('/expenses')}">
        <section class="expenses">
          <div class="expenses__info">
            <h2 class="expenses__title">Dépenses</h2>
            <div class="expenses__subtitle">
              ${month === null ? 'Budget du mois' : `Budget ${formatMonthDe(month)}`}
            </div>
          </div>
          <div class="expenses__amount">${formatCents(this.totalCents)}</div>
        </section>
      </a>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'expenses-card': ExpensesCard;
  }
}