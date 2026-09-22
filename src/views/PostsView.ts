import { html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { LightElement } from "../commons/base-element.ts";
import { Today } from "../commons/controllers/today.ts";
import { ViewState } from "../commons/controllers/view-state.ts";
import {
  activeHorseQuery,
  byLabel,
  postsRepo,
  categoriesRepo,
  findCategory,
  formatDayLong,
  formatMonthYear,
  LiveQuery,
  occurrencesByDate,
  toCalendarEvent,
  childrenOf,
  courseLastDay,
  isCourse,
  isCourseOnDay,
  rootOf,
  rootsOf,
  subtreeKeys,
  todayISO,
  type IsoDate,
  type ResolvedCategory,
} from "../data/index.ts";
import type { Post } from "../data/types.ts";
import type { SegmentedOption } from "../components/app-segmented/app-segmented.ts";
import type { CalendarSpan } from "../components/app-calendar/app-calendar.ts";
import { THEME_META } from "../theme/theme.ts";

import "../components/app-calendar/app-calendar.ts";
import "../components/app-chip/app-chip.ts";
import "../components/app-input/app-input.ts";
import "../components/app-segmented/app-segmented.ts";
import "../components/course-card/course-card.ts";
import "../components/post-card/post-card.ts";

type ViewMode = "calendar" | "list";

/**
 * What this page looks like, which is a property of the *visit* rather than of
 * the element — see `ViewState`. Everything the user has set here survives
 * opening an event and pressing Retour; a fresh visit from the nav bar is a new
 * history entry and so starts from the defaults below.
 */
type PostsUiState = {
  mode: ViewMode;
  selected: IsoDate;
  query: string;
  /** `null` is the "Tous" chip. */
  categoryFilter: string | null;
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

@customElement("posts-view")
export class PostsView extends LightElement {
  /** Re-renders when the day turns, so the today passed below moves with it. */
  #today = new Today(this);

  #ui = new ViewState<PostsUiState>(this, "posts", () => ({
    mode: "calendar",
    selected: todayISO(),
    query: "",
    categoryFilter: null,
  }));

  /**
   * Every event for the horse, not just the visible month.
   *
   * A `LiveQuery` subscribes once and Dexie re-runs it only when a table it
   * read is written to — paging to another month, typing in the search box or
   * picking a chip is component state, not a write, so a query narrowed by any
   * of those would go stale. Filtering in memory is correct and cheap at this
   * size; swap in `postsRepo.listInRange` with an explicit re-subscribe if the
   * row count ever makes that worthwhile.
   */
  #events = activeHorseQuery<Post[]>(
    this,
    (horseId) => postsRepo.listByHorse(horseId),
    [],
  );

  #categories = new LiveQuery<ResolvedCategory[]>(this, () =>
    categoriesRepo.listEnabled(),
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
    this.#ui.patch({ categoryFilter: type });
  };

  /**
   * The chip filter, or `null` once the category it names has been switched
   * off — a remembered filter on a hidden category would otherwise show an
   * empty list with no chip lit to explain it. Trusted as-is until the
   * catalogue's `LiveQuery` settles.
   */
  get #categoryFilter(): string | null {
    const { categoryFilter } = this.#ui.value;
    const types = this.#categories.value;
    if (categoryFilter === null || types === undefined) return categoryFilter;
    return findCategory(types, categoryFilter) ? categoryFilter : null;
  }

  /** Cancelled events are hidden here for the same reason the calendar hides them. */
  #visiblePosts(
    types: ResolvedCategory[],
    categoryFilter: string | null,
  ): Post[] {
    const { query } = this.#ui.value;
    const needle = normalize(query.trim());

    // A root chip covers its children too — `subtreeKeys` is a singleton for a
    // type with none, which is exactly the `event.categoryKey === categoryFilter` this
    // replaces on a flat catalogue.
    const keys =
      categoryFilter === null ? null : subtreeKeys(types, categoryFilter);

    return (this.#events.value ?? []).filter((event) => {
      if (event.status === "cancelled") return false;
      if (keys && !keys.has(event.categoryKey)) return false;
      if (!needle) return true;

      const haystack = [
        event.title,
        event.notes ?? "",
        typeof event.customFields.counterparty === "string"
          ? event.customFields.counterparty
          : "",
        event.location ?? "",
        findCategory(types, event.categoryKey)?.label ?? "",
      ].join(" ");
      return normalize(haystack).includes(needle);
    });
  }

  render() {
    const types = this.#categories.value ?? [];

    return html`
      <section class="posts-view">
        <header class="posts-view__header">
          <hgroup class="section-group">
            <h1 class="page-title" tabindex="-1">Activités</h1>
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

  #renderCalendar(types: ResolvedCategory[]) {
    const { selected } = this.#ui.value;
    const today = this.#today.value;
    const all = this.#events.value ?? [];
    // A cure or a traitement is drawn as a bar over the days it runs, not as a
    // dot on the day it started — and listed under every one of those days,
    // not only the first. Cancelled ones go, as cancelled events do.
    const courses = all.filter(
      (event) => isCourse(event) && event.status !== "cancelled",
    );
    const events = all.filter((event) => !isCourse(event));
    const calendarEvents = events.map(toCalendarEvent);
    const spans = courses.flatMap((course): CalendarSpan[] => {
      const type = findCategory(types, course.categoryKey);
      return type
        ? [
            {
              id: course.id,
              start: course.date,
              end: courseLastDay(course, today),
              color: THEME_META[type.theme].color,
              label: course.title,
            },
          ]
        : [];
    });

    // One pass feeds both the dots and the list below, so the two can never
    // disagree about which events fall on the selected day.
    const occurrences = occurrencesByDate(calendarEvents, selected, selected);
    const byUid = new Map(events.map((event) => [event.id, event]));
    const dayEvents = (occurrences.get(selected) ?? [])
      .map((occurrence) => byUid.get(occurrence.uid))
      .filter((event): event is Post => event !== undefined);
    // After the day's own events, oldest course first.
    const dayCourses = courses
      .filter((course) => isCourseOnDay(course, selected, today))
      .reverse();
    const dayPosts = [...dayEvents, ...dayCourses];

    return html`
      <app-calendar
        class="container posts-view__calendar"
        .events=${calendarEvents}
        .spans=${spans}
        .value=${selected}
        @date-select=${this.#onDateSelect}
      ></app-calendar>

      <section class="posts-view__day">
        <h2 class="posts-view__group-title">${formatDayLong(selected)}</h2>
        ${
          dayPosts.length === 0
            ? html`<p class="posts-view__empty">Aucun évènement ce jour-là.</p>`
            : this.#renderCards(dayPosts, types)
        }
      </section>
    `;
  }

  #renderList(types: ResolvedCategory[]) {
    const { query } = this.#ui.value;
    const categoryFilter = this.#categoryFilter;
    const events = this.#visiblePosts(types, categoryFilter);

    // `listByHorse` already returns newest first, so grouping in order gives
    // months descending and, inside each, days descending.
    const months = new Map<string, Post[]>();
    for (const event of events) {
      const month = event.date.slice(0, 7);
      const group = months.get(month);
      if (group) group.push(event);
      else months.set(month, [event]);
    }

    return html`
      <app-input
        class="posts-view__search"
        label="Rechercher un évènement"
        hide-label
        type="search"
        icon="search"
        placeholder="Rechercher un soin, un rendez-vous…"
        .value=${query}
        @input=${this.#onSearch}
      ></app-input>

      ${this.#renderFilters(types, categoryFilter)}
      ${
        months.size === 0
          ? html`<p class="posts-view__empty">
              Aucun évènement ne correspond.
            </p>`
          : repeat(
              months,
              ([month]) => month,
              ([month, group]) => html`
                <section class="posts-view__group">
                  <h2 class="posts-view__group-title">
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
   * takes its whole subtree (`#visiblePosts`), and the second row is how you
   * narrow to one child from there — so nothing becomes unreachable, it moves
   * one tap away.
   *
   * A flat catalogue is every type being a root, so this renders exactly the
   * row it did before types could nest, and the second row never appears.
   */
  #renderFilters(types: ResolvedCategory[], categoryFilter: string | null) {
    const selected =
      categoryFilter === null ? undefined : findCategory(types, categoryFilter);
    const root = selected ? rootOf(types, selected) : undefined;
    const children = root ? childrenOf(types, root.id) : [];

    return html`
      <div
        class="posts-view__filters"
        role="group"
        aria-label="Filtrer par type"
      >
        <app-chip
          label="Tous"
          ?selected=${categoryFilter === null}
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
                class="posts-view__filters posts-view__filters--nested"
                role="group"
                aria-label="Filtrer dans ${root.label}"
              >
                <app-chip
                  label="Tous"
                  ?selected=${categoryFilter === root.key}
                  @click=${this.#onFilter(root.key)}
                ></app-chip>
                ${byLabel(children).map(
                  (child) => html`
                    <app-chip
                      label=${child.label}
                      ?selected=${categoryFilter === child.key}
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
  #renderCards(events: Post[], types: ResolvedCategory[]) {
    return html`
      <ul class="posts-view__list">
        ${repeat(
          events,
          (event) => event.id,
          (event) => html`
            <li>
              ${
                isCourse(event)
                  ? html`<course-card
                      .post=${event}
                      .category=${findCategory(types, event.categoryKey) ?? null}
                    ></course-card>`
                  : html`<post-card
                      .post=${event}
                      .category=${findCategory(types, event.categoryKey) ?? null}
                    ></post-card>`
              }
            </li>
          `,
        )}
      </ul>
    `;
  }
}
