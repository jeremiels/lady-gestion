import { html, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import { LightElement } from '../commons/base-element.ts';
import { ViewState } from '../commons/controllers/view-state.ts';
import { goBack } from '../commons/navigation.ts';
import {
  activeHorseQuery,
  byDateDescending,
  eventsRepo,
  formatCents,
  formatPeriod,
  formatPeriodHeading,
  formatPeriodNote,
  inPeriod,
  periodOf,
  periodOptions,
  sumByType,
  todayISO,
  type BudgetGranularity,
  type BudgetPeriod,
  type BudgetSlice,
} from '../data/index.ts';
import type { HorseEvent } from '../data/types.ts';
import { eventType } from '../types/event.types.ts';
import type { SegmentedOption } from '../components/app-segmented/app-segmented.ts';
import type { DonutSlice } from '../components/app-donut-chart/app-donut-chart.ts';

import '../components/app-donut-chart/app-donut-chart.ts';
import '../components/app-icon/app-icon.ts';
import '../components/app-segmented/app-segmented.ts';
import '../components/app-select/app-select.ts';
import '../components/event-card/event-card.ts';

/** Where back falls to — this view is only reachable from the dashboard. */
const HOME = '/';

/** Text segments, not icons: "M" and "A" would mean nothing. */
const GRANULARITIES: SegmentedOption[] = [
  { value: 'month', label: 'Mois' },
  { value: 'year', label: 'Année' },
];

/**
 * Which period this page is showing, kept on the history entry rather than on
 * the element — see `ViewState`. Opening a row and pressing Retour comes back
 * to the same month or year; arriving fresh from the dashboard starts at today.
 *
 * The two keys are held separately rather than one being derived from the
 * other, so switching to Année and back returns to the month that was selected.
 * Converting a single key loses the day-level choice on the way out and has to
 * guess it on the way back.
 */
type BudgetUiState = {
  granularity: BudgetGranularity;
  monthKey: string;
  yearKey: string;
};

@customElement('budget-view')
export class BudgetView extends LightElement {
  #ui = new ViewState<BudgetUiState>(this, 'budget', () => ({
    granularity: 'month',
    monthKey: periodOf(todayISO(), 'month').key,
    yearKey: periodOf(todayISO(), 'year').key,
  }));

  /**
   * Every budget for the horse, not just the selected period.
   *
   * This is forced, not lazy. `LiveQuery` subscribes once in `hostConnected`
   * and Dexie re-runs it only when a table it read is *written* to — picking
   * another month is component state, not a write, so a query narrowed by the
   * period would go stale the moment the user touched the picker. Filtering in
   * memory is correct and cheap at this size; `EventsView` does the same for
   * the same reason.
   *
   * `listBudget` already drops rows with no amount and cancelled ones.
   */
  #budget = activeHorseQuery<HorseEvent[]>(this, (horseId) => eventsRepo.listBudget(horseId), []);


  /**
   * The one place the stored granularity is read, so the picker, the heading
   * and the ledger cannot disagree about which period is on screen — every
   * other read here takes this result rather than the bag.
   *
   * Tested for the non-default branch on purpose: a granularity restored from
   * an older build's history entry falls back to the month view rather than to
   * a year nothing asked for.
   */
  get #period(): BudgetPeriod {
    const { granularity, monthKey, yearKey } = this.#ui.value;

    return granularity === 'year'
      ? { granularity: 'year', key: yearKey }
      : { granularity: 'month', key: monthKey };
  }

  #onGranularityChange = (event: CustomEvent<{ value: string }>) => {
    this.#ui.patch({ granularity: event.detail.value as BudgetGranularity });
  };

  #onPeriodChange = (event: CustomEvent<{ value: string }>) => {
    const key = event.detail.value;
    this.#ui.patch(this.#period.granularity === 'year' ? { yearKey: key } : { monthKey: key });
  };

  render() {
    const all = this.#budget.value ?? [];
    const period = this.#period;
    const { granularity } = period;
    const events = inPeriod(all, period).sort(byDateDescending);
    const slices = sumByType(events);

    return html`
      <section class="budget-view">
        <header class="budget-view__header">
          <button
            class="budget-view__back pressable pressable--small"
            type="button"
            aria-label="Retour"
            @click=${() => goBack(HOME)}
          >
            <app-icon icon="chevronLeft"></app-icon>
          </button>
          <h1 class="budget-view__title" tabindex="-1">Dépenses</h1>
        </header>

        <div class="container budget-view__summary">
          <div class="budget-view__controls">
            <app-segmented
              label="Période"
              .options=${GRANULARITIES}
              .value=${granularity}
              @segment-change=${this.#onGranularityChange}
            ></app-segmented>
            <app-select
              pill
              label=${granularity === 'year' ? 'Année affichée' : 'Mois affiché'}
              .options=${periodOptions(all, granularity).map((option) => ({
                value: option.key,
                label: formatPeriod(option),
              }))}
              .value=${period.key}
              @select-change=${this.#onPeriodChange}
            ></app-select>
          </div>

          <app-donut-chart
            caption="Total"
            note=${formatPeriodNote(period)}
            .slices=${this.#donutSlices(slices)}
            .formatValue=${this.#formatTotal}
          ></app-donut-chart>

          ${slices.length === 0
            ? html`<p class="budget-view__empty">Aucune dépense sur cette période.</p>`
            : this.#renderLegend(slices)}
        </div>

        <!-- Dropped whole rather than shown with an empty message: the card
             above already says there is nothing, and a second notice under a
             heading with no rows says it twice. -->
        ${events.length === 0 ? nothing : this.#renderLedger(events, granularity)}
      </section>
    `;
  }

  #renderLedger(events: HorseEvent[], granularity: BudgetGranularity) {
    return html`
      <section class="budget-view__ledger">
        <h2 class="budget-view__group-title">${formatPeriodHeading(granularity)}</h2>
        <!-- Keyed: changing the period replaces the whole ledger, and the
             month/year segmented control is component state rather than a
             write, so this re-renders far more often than the data changes. -->
        <ul class="budget-view__list">
          ${repeat(
            events,
            (event) => event.id,
            (event) => html`
              <li>
                <event-card layout="budget" .event=${event}></event-card>
              </li>
            `,
          )}
        </ul>
      </section>
    `;
  }

  /**
   * The chart takes colours, not categories — it is domain-free.
   *
   * The pale background tone rather than the solid one: the design's ring is
   * a tint, and eight saturated wedges would fight the rest of the page. The
   * legend beside it carries the meaning, so nothing rests on telling two
   * similar pastels apart.
   */
  #donutSlices(slices: BudgetSlice[]): DonutSlice[] {
    return slices.map((slice) => ({
      id: slice.type,
      label: eventType.label(slice.type),
      value: slice.cents,
      color: eventType.theme(slice.type).backgroundColor,
    }));
  }

  /**
   * Formats the counting-up centre figure.
   *
   * Rounded to whole cents because the chart hands over a fraction mid-sweep,
   * and `formatCents` would otherwise render a jittering third decimal. The
   * chart guarantees the final frame is the exact total, so the settled figure
   * is never a rounding.
   */
  #formatTotal = (value: number): string => formatCents(Math.round(value));

  /**
   * The same `BudgetSlice[]` the chart was handed, so the ring and the list
   * beside it cannot disagree about what is in the period.
   */
  #renderLegend(slices: BudgetSlice[]) {
    return html`
      <ul class="budget-view__legend">
        ${repeat(
          slices,
          (slice) => slice.type,
          (slice) => html`
            <li class="budget-view__legend-item">
              <span
                class="budget-view__legend-dot"
                style=${styleMap({
                  backgroundColor: eventType.theme(slice.type).backgroundColor,
                })}
                aria-hidden="true"
              ></span>
              <span class="budget-view__legend-label">${eventType.label(slice.type)}</span>
              <span class="budget-view__legend-value">${formatCents(slice.cents)}</span>
            </li>
          `,
        )}
      </ul>
    `;
  }
}
