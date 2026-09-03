import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { LightElement } from '../commons/base-element.ts';
import { ViewState } from '../commons/controllers/view-state.ts';
import {
  activeHorseQuery,
  eventsRepo,
  formatDayLong,
  formatMonthYear,
  occurrencesByDate,
  toCalendarEvent,
  todayISO,
  type IsoDate,
} from '../data/index.ts';
import type { HorseEvent } from '../data/types.ts';
import { EVENT_TYPES_BY_LABEL, eventType, type EventTypeKey } from '../types/event.types.ts';
import type { SegmentedOption } from '../components/app-segmented/app-segmented.ts';

import '../components/app-calendar/app-calendar.ts';
import '../components/app-chip/app-chip.ts';
import '../components/app-input/app-input.ts';
import '../components/app-segmented/app-segmented.ts';
import '../components/event-card/event-card.ts';

type ViewMode = 'calendar' | 'list';

/**
 * What this page looks like, which is a property of the *visit* rather than of
 * the element — see `ViewState`. Everything the user has set here survives
 * opening an event and pressing Retour; a fresh visit from the nav bar is a new
 * history entry and so starts from the defaults below.
 */
type EventsUiState = {
  mode: ViewMode;
  selected: IsoDate;
  query: string;
  /** `null` is the "Tous" chip. */
  typeFilter: EventTypeKey | null;
};

const VIEW_MODES: SegmentedOption[] = [
  { value: 'calendar', icon: 'date', label: 'Vue calendrier' },
  { value: 'list', icon: 'list', label: 'Vue liste' },
];

/**
 * Folds accents and case so "controle" finds "Contrôle" — the whole point of a
 * search box on French copy.
 */
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

@customElement('events-view')
export class EventsView extends LightElement {
  #ui = new ViewState<EventsUiState>(this, 'events', () => ({
    mode: 'calendar',
    selected: todayISO(),
    query: '',
    typeFilter: null,
  }));

  /**
   * Every event for the horse, not just the visible month.
   *
   * A `LiveQuery` subscribes once and Dexie re-runs it only when a table it
   * read is written to — paging to another month, typing in the search box or
   * picking a chip is component state, not a write, so a query narrowed by any
   * of those would go stale. Filtering in memory is correct and cheap at this
   * size; swap in `eventsRepo.listInRange` with an explicit re-subscribe if the
   * row count ever makes that worthwhile.
   */
  #events = activeHorseQuery<HorseEvent[]>(this, (horseId) => eventsRepo.listByHorse(horseId), []);


  #onModeChange = (event: CustomEvent<{ value: string }>) => {
    this.#ui.patch({ mode: event.detail.value as ViewMode });
  };

  #onDateSelect = (event: CustomEvent<{ date: IsoDate }>) => {
    this.#ui.patch({ selected: event.detail.date });
  };

  #onSearch = (event: Event) => {
    this.#ui.patch({ query: (event.target as HTMLInputElement).value });
  };

  #onFilter = (type: EventTypeKey | null) => () => {
    this.#ui.patch({ typeFilter: type });
  };

  /** Cancelled events are hidden here for the same reason the calendar hides them. */
  #visibleEvents(): HorseEvent[] {
    const { query, typeFilter } = this.#ui.value;
    const needle = normalize(query.trim());

    return (this.#events.value ?? []).filter((event) => {
      if (event.status === 'cancelled') return false;
      if (typeFilter && event.type !== typeFilter) return false;
      if (!needle) return true;

      const haystack = [
        event.title,
        event.notes ?? '',
        event.providerName ?? '',
        event.location ?? '',
        eventType.label(event.type),
      ].join(' ');
      return normalize(haystack).includes(needle);
    });
  }

  render() {
    return html`
      <section class="events-view">
        <header class="events-view__header">
          <hgroup class="section-group">
            <h1 class="section-title" tabindex="-1">Activités</h1>
            <p class="section-subtitle">Récap des activités</p>
          </hgroup>
          <app-segmented
            label="Affichage"
            .options=${VIEW_MODES}
            .value=${this.#ui.value.mode}
            @segment-change=${this.#onModeChange}
          ></app-segmented>
        </header>

        <!-- Tested for the non-default branch, so a mode restored from an older
             build's history entry falls back to the calendar rather than to a
             list nothing asked for. -->
        ${this.#ui.value.mode === 'list' ? this.#renderList() : this.#renderCalendar()}
      </section>
    `;
  }

  #renderCalendar() {
    const { selected } = this.#ui.value;
    const events = this.#events.value ?? [];
    const calendarEvents = events.map(toCalendarEvent);

    // One pass feeds both the dots and the list below, so the two can never
    // disagree about which events fall on the selected day.
    const occurrences = occurrencesByDate(calendarEvents, selected, selected);
    const byUid = new Map(events.map((event) => [event.id, event]));
    const dayEvents = (occurrences.get(selected) ?? [])
      .map((occurrence) => byUid.get(occurrence.uid))
      .filter((event): event is HorseEvent => event !== undefined);

    return html`
      <app-calendar
        class="container events-view__calendar"
        .events=${calendarEvents}
        .value=${selected}
        @date-select=${this.#onDateSelect}
      ></app-calendar>

      <section class="events-view__day">
        <h2 class="events-view__group-title">${formatDayLong(selected)}</h2>
        ${dayEvents.length === 0
          ? html`<p class="events-view__empty">Aucun évènement ce jour-là.</p>`
          : this.#renderCards(dayEvents)}
      </section>
    `;
  }

  #renderList() {
    const { query, typeFilter } = this.#ui.value;
    const events = this.#visibleEvents();

    // `listByHorse` already returns newest first, so grouping in order gives
    // months descending and, inside each, days descending.
    const months = new Map<string, HorseEvent[]>();
    for (const event of events) {
      const month = event.date.slice(0, 7);
      const group = months.get(month);
      if (group) group.push(event);
      else months.set(month, [event]);
    }

    return html`
      <app-input
        class="events-view__search"
        label="Rechercher un évènement"
        hide-label
        type="search"
        icon="search"
        placeholder="Rechercher un soin, un rendez-vous…"
        .value=${query}
        @input=${this.#onSearch}
      ></app-input>

      <div class="events-view__filters" role="group" aria-label="Filtrer par type">
        <app-chip
          label="Tous"
          ?selected=${typeFilter === null}
          @click=${this.#onFilter(null)}
        ></app-chip>
        ${EVENT_TYPES_BY_LABEL.map(
          (type) => html`
            <app-chip
              label=${eventType.label(type)}
              ?selected=${typeFilter === type}
              @click=${this.#onFilter(type)}
            ></app-chip>
          `,
        )}
      </div>

      ${months.size === 0
        ? html`<p class="events-view__empty">Aucun évènement ne correspond.</p>`
        : repeat(
            months,
            ([month]) => month,
            ([month, group]) => html`
              <section class="events-view__group">
                <h2 class="events-view__group-title">${formatMonthYear(`${month}-01`)}</h2>
                ${this.#renderCards(group)}
              </section>
            `,
          )}
    `;
  }

  /**
   * Keyed by event id, not rendered positionally.
   *
   * The search box, the type chips and the day picker all reorder and resize
   * this list without any write happening, and `map()` binds parts by position:
   * typing one more letter re-points every surviving card at a different
   * record and re-renders all of them, rather than dropping the handful that
   * stopped matching. `repeat()` moves the DOM instead.
   */
  #renderCards(events: HorseEvent[]) {
    return html`
      <ul class="events-view__list">
        ${repeat(
          events,
          (event) => event.id,
          (event) => html`
            <li>
              <event-card .event=${event}></event-card>
            </li>
          `,
        )}
      </ul>
    `;
  }
}
