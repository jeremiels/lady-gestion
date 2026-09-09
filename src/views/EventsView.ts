import { html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { LightElement } from "../commons/base-element.ts";
import { ViewState } from "../commons/controllers/view-state.ts";
import {
  activeHorseQuery,
  byLabel,
  eventsRepo,
  eventTypesRepo,
  findEventType,
  formatDayLong,
  formatMonthYear,
  LiveQuery,
  occurrencesByDate,
  toCalendarEvent,
  childrenOf,
  rootOf,
  rootsOf,
  subtreeKeys,
  todayISO,
  type IsoDate,
  type ResolvedEventType,
} from "../data/index.ts";
import type { HorseEvent } from "../data/types.ts";
import type { SegmentedOption } from "../components/app-segmented/app-segmented.ts";

import "../components/app-calendar/app-calendar.ts";
import "../components/app-chip/app-chip.ts";
import "../components/app-input/app-input.ts";
import "../components/app-segmented/app-segmented.ts";
import "../components/event-card/event-card.ts";

type ViewMode = "calendar" | "list";

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
  typeFilter: string | null;
};

const VIEW_MODES: SegmentedOption[] = [
  { value: "calendar", icon: "date", label: "Vue calendrier" },
  { value: "list", icon: "list", label: "Vue liste" },
];

/**
 * Folds accents and case so "controle" finds "Contrôle" — the whole point of a
 * search box on French copy.
 */
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

@customElement("events-view")
export class EventsView extends LightElement {
  #ui = new ViewState<EventsUiState>(this, "events", () => ({
    mode: "calendar",
    selected: todayISO(),
    query: "",
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
  #events = activeHorseQuery<HorseEvent[]>(
    this,
    (horseId) => eventsRepo.listByHorse(horseId),
    [],
  );

  #eventTypes = new LiveQuery<ResolvedEventType[]>(this, () =>
    eventTypesRepo.listResolved(),
  );

  #onModeChange = (event: CustomEvent<{ value: string }>) => {
    this.#ui.patch({ mode: event.detail.value as ViewMode });
  };

  #onDateSelect = (event: CustomEvent<{ date: IsoDate }>) => {
    this.#ui.patch({ selected: event.detail.date });
  };

  #onSearch = (event: Event) => {
    this.#ui.patch({ query: (event.target as HTMLInputElement).value });
  };

  #onFilter = (type: string | null) => () => {
    this.#ui.patch({ typeFilter: type });
  };

  /** Cancelled events are hidden here for the same reason the calendar hides them. */
  #visibleEvents(types: ResolvedEventType[]): HorseEvent[] {
    const { query, typeFilter } = this.#ui.value;
    const needle = normalize(query.trim());

    // A root chip covers its children too — `subtreeKeys` is a singleton for a
    // type with none, which is exactly the `event.type === typeFilter` this
    // replaces on a flat catalogue.
    const keys = typeFilter === null ? null : subtreeKeys(types, typeFilter);

    return (this.#events.value ?? []).filter((event) => {
      if (event.status === "cancelled") return false;
      if (keys && !keys.has(event.type)) return false;
      if (!needle) return true;

      const haystack = [
        event.title,
        event.notes ?? "",
        typeof event.customFields.counterparty === "string"
          ? event.customFields.counterparty
          : "",
        event.location ?? "",
        findEventType(types, event.type)?.label ?? "",
      ].join(" ");
      return normalize(haystack).includes(needle);
    });
  }

  render() {
    const types = this.#eventTypes.value ?? [];

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
        ${
          this.#ui.value.mode === "list"
            ? this.#renderList(types)
            : this.#renderCalendar(types)
        }
      </section>
    `;
  }

  #renderCalendar(types: ResolvedEventType[]) {
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
        ${
          dayEvents.length === 0
            ? html`<p class="events-view__empty">
                Aucun évènement ce jour-là.
              </p>`
            : this.#renderCards(dayEvents, types)
        }
      </section>
    `;
  }

  #renderList(types: ResolvedEventType[]) {
    const { query } = this.#ui.value;
    const events = this.#visibleEvents(types);

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

      ${this.#renderFilters(types)}
      ${
        months.size === 0
          ? html`<p class="events-view__empty">
              Aucun évènement ne correspond.
            </p>`
          : repeat(
              months,
              ([month]) => month,
              ([month, group]) => html`
                <section class="events-view__group">
                  <h2 class="events-view__group-title">
                    ${formatMonthYear(`${month}-01`)}
                  </h2>
                  ${this.#renderCards(group, types)}
                </section>
              `,
            )
      }
    `;
  }

  /**
   * One chip per *root* type, and a second row for the selected root's
   * children.
   *
   * Roots only on the first row because a child's chip beside its parent's
   * would filter a subset of what the parent already covers, in the same
   * colour, in a row that is already wide enough to scroll. Selecting a root
   * takes its whole subtree (`#visibleEvents`), and the second row is how you
   * narrow to one child from there — so nothing becomes unreachable, it moves
   * one tap away.
   *
   * A flat catalogue is every type being a root, so this renders exactly the
   * row it did before types could nest, and the second row never appears.
   */
  #renderFilters(types: ResolvedEventType[]) {
    const { typeFilter } = this.#ui.value;
    const selected =
      typeFilter === null ? undefined : findEventType(types, typeFilter);
    const root = selected ? rootOf(types, selected) : undefined;
    const children = root ? childrenOf(types, root.id) : [];

    return html`
      <div
        class="events-view__filters"
        role="group"
        aria-label="Filtrer par type"
      >
        <app-chip
          label="Tous"
          ?selected=${typeFilter === null}
          @click=${this.#onFilter(null)}
        ></app-chip>
        ${byLabel(rootsOf(types)).map(
          (type) => html`
            <app-chip
              label=${type.label}
              ?selected=${root?.key === type.key}
              @click=${this.#onFilter(type.key)}
            ></app-chip>
          `,
        )}
      </div>

      ${
        root === undefined || children.length === 0
          ? nothing
          : html`
              <div
                class="events-view__filters events-view__filters--nested"
                role="group"
                aria-label="Filtrer dans ${root.label}"
              >
                <app-chip
                  label="Tous"
                  ?selected=${typeFilter === root.key}
                  @click=${this.#onFilter(root.key)}
                ></app-chip>
                ${byLabel(children).map(
                  (child) => html`
                    <app-chip
                      label=${child.label}
                      ?selected=${typeFilter === child.key}
                      @click=${this.#onFilter(child.key)}
                    ></app-chip>
                  `,
                )}
              </div>
            `
      }
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
  #renderCards(events: HorseEvent[], types: ResolvedEventType[]) {
    return html`
      <ul class="events-view__list">
        ${repeat(
          events,
          (event) => event.id,
          (event) => html`
            <li>
              <event-card
                .event=${event}
                .type=${findEventType(types, event.type) ?? null}
              ></event-card>
            </li>
          `,
        )}
      </ul>
    `;
  }
}
