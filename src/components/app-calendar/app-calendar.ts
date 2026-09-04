import { css, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { BaseElement } from '../../commons/base-element.ts';
import { MediaQuery } from '../../commons/controllers/media-query.ts';
import { slidingSelectionStyles } from '../../commons/sliding-selection.styles.ts';
import {
  addDays,
  addMonths,
  dayOfMonth,
  formatDayLong,
  formatMonthYear,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  todayISO,
  weekdayLabels,
  type IsoDate,
} from '../../data/dates.ts';
import {
  DEFAULT_WEEK_START,
  monthGrid,
  occurrencesByDate,
  weekDayIndex,
  type CalendarEvent,
  type WeekDay,
} from '../../data/icalendar.ts';

import '../app-icon/app-icon.ts';

/**
 * A month calendar: one dot under every day that has events, a filled circle on
 * the selected day and a tinted one on today.
 *
 * Presentational — it takes `CalendarEvent`s (the RFC 5545 view of an event,
 * see `src/data/icalendar.ts`) and never reads a repository itself, so the
 * owning view decides what a day means. Both the dots and the day list a
 * consumer renders underneath should come from the same
 * `occurrencesByDate()` map, or the two can disagree about a day.
 *
 * Keyboard support follows the ARIA grid pattern used by date pickers: the
 * grid holds a single tab stop and the arrow keys move a roving focus within
 * it, crossing month boundaries on their own.
 *
 * @fires date-select - `{ date: IsoDate }` when a day is chosen.
 * @fires month-change - `{ month: IsoDate, reason }` when the visible month
 * moves, whether from the arrows or from focus crossing a boundary.
 */
@customElement('app-calendar')
export class AppCalendar extends BaseElement {
  /** Occurrences to mark. Days outside the visible month are simply ignored. */
  @property({ attribute: false }) events: CalendarEvent[] = [];

  /** The selected day, `YYYY-MM-DD`. */
  @property({ type: String }) value: IsoDate | null = null;

  /** RFC 5545 `WKST`. Monday both by the RFC's default and by French habit. */
  @property({ type: String, attribute: 'week-start' }) weekStart: WeekDay = DEFAULT_WEEK_START;

  /** Overridable so a demo or a test can pin "today" to a fixed date. */
  @property({ type: String }) today: IsoDate = todayISO();

  /**
   * First day of the displayed month.
   *
   * Not `private`, for the same reason as `focusedDate` below: `updated()`
   * asks `changed.has('visibleMonth')`, which needs it in `keyof AppCalendar`.
   */
  @state() visibleMonth: IsoDate = startOfMonth(this.value ?? todayISO());

  /**
   * The day holding the grid's single tab stop.
   *
   * Not `private`: `changed.has(...)` in `updated()` needs it in `keyof AppCalendar`.
   */
  @state() focusedDate: IsoDate = this.value ?? todayISO();

  /**
   * Observed, not sampled: gates the WAAPI page transition below, which is a
   * JS-driven animation the blanket CSS `prefers-reduced-motion` block in the
   * reset can't reach. Same pattern `app-donut-chart` uses for its sweep.
   */
  #reducedMotion = new MediaQuery(this, '(prefers-reduced-motion: reduce)');

  // The travelling pill first, so the rules below still win at equal specificity.
  static componentStyles = [
    slidingSelectionStyles,
    css`
      :host {
        display: block;
      }

      .calendar__header {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: var(--spacing-8);
        margin-bottom: var(--spacing-16);
      }

      .calendar__nav {
        display: grid;
        place-items: center;
        width: 2rem;
        height: 2rem;
        padding: 0;
        border: none;
        border-radius: var(--radius-8);
        background: var(--color-brown-light-bg);
        color: var(--color-brown-dark);
        cursor: pointer;
      }

      @media (hover: hover) and (pointer: fine) {
        .calendar__nav:hover {
          background: var(--color-surface-hover);
        }
      }

      .calendar__nav-icon {
        height: 2rem;
        width: 2rem;
      }

      .calendar__month {
        text-align: center;
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--color-dark);
      }

      /* The seven columns are declared once, here. Every row below — the weekday
         header included — inherits them through subgrid, so a wider Saturday
         column can't drift out of line with its heading. */
      .calendar__grid {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        row-gap: var(--spacing-4);
        --sliding-selection-background: var(--color-brown-dark);
      }

      /* Held for one forced reflow while a month page lands — see #snapSelection. */
      .calendar__grid--paging {
        --sliding-selection-duration: 0s;
      }

      .calendar__row {
        display: grid;
        grid-template-columns: subgrid;
        grid-column: 1 / -1;
      }

      .calendar__weekday {
        justify-self: center;
        padding-bottom: var(--spacing-8);
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--color-brown-light);
      }

      /* Two rows: the day itself, then a fixed strip for the dot. Reserving the
         strip keeps every number on the same baseline whether or not its day has
         events. */
      .calendar__cell {
        display: grid;
        grid-template-rows: auto 0.625rem;
        justify-items: center;
        align-content: start;
      }

      /* isolation: isolate is load-bearing: it gives the button its own
         stacking context so the z-index: -1 pill below lands behind the
         button's own (transparent) background rather than behind whichever
         ancestor happens to establish the nearest context. */
      .calendar__day {
        position: relative;
        isolation: isolate;
        display: grid;
        place-items: center;
        width: 2rem;
        height: 1.5rem;
        padding: 0;
        border: none;
        border-radius: var(--radius-pill);
        background: transparent;
        color: var(--color-dark);
        font-family: inherit;
        font-size: 0.813rem;
        line-height: 1.5rem;
        font-weight: 600;
        cursor: pointer;
        transition: color var(--duration-fast) ease;
      }

      /* The pill. Both the today tint and the selection now live here rather
         than on the button, so the number never has to move out of its way and
         the two states can hand over to each other in one place.
         scale(0.9) and not scale(0) — a mark that grows from nothing is the
         one thing a real object never does. 0.9 rather than a deeper 0.8: on a
         2rem target the extra tenth is the difference between the pill settling
         and the pill popping. */
      .calendar__day::before {
        content: '';
        position: absolute;
        inset: 0;
        z-index: -1;
        border-radius: var(--radius-pill);
        background: transparent;
        transform: scale(0.9);
        opacity: 0;
        transition:
          transform var(--duration-fast) var(--easing-out),
          opacity var(--duration-fast) var(--easing-out),
          background-color var(--duration-fast) ease;
      }

      .calendar__day--outside {
        color: var(--color-text-muted-on-dark);
      }

      /* Today's pill is already present, just quiet — so selecting today
         recolours it in place instead of growing a second one over it. */
      .calendar__day--today::before {
        background: var(--color-brown-light-bg);
        transform: scale(1);
        opacity: 1;
      }

      .calendar__day--today.calendar__day--outside::before {
        opacity: 0;
      }

      /* Selection wins over today, which is why it comes last. */
      .calendar__day--selected {
        color: var(--color-white);
      }

      .calendar__day--selected::before {
        background: var(--color-brown-dark);
        transform: scale(1);
        opacity: 1;
      }

      /*
       * Where the pill travels, the selected day stops drawing its own. This
       * one rule covers both cases because it already wins over the today
       * tint above: a selected day that is also today goes transparent too,
       * so the travelling pill shows through instead of being hidden behind
       * today's opaque circle — the pill sits behind the row, not inside the
       * button.
       */
      @supports (anchor-name: --sliding-selection) {
        .calendar__day--selected::before {
          background: transparent;
        }

        /*
         * The ink waits for the pill. White on a circle that is still two
         * cells away is white on white, and the day vanishes for the length
         * of the travel. Only the *incoming* day waits — a day being left
         * needs its dark number back immediately, because the pill it was
         * standing on has already gone.
         */
        .calendar__day--selected {
          transition: color var(--duration-fast) ease var(--duration-fast);
        }
      }

      .calendar__day:focus-visible {
        outline: 2px solid var(--color-brown-dark);
        outline-offset: 2px;
      }

      .calendar__dot {
        width: 0.3125rem;
        height: 0.3125rem;
        margin-top: 0.1875rem;
        border-radius: var(--radius-pill);
        background: var(--color-brown-light);
      }

      /* The pill's growth is movement; its colour and its arrival are not. */
      @media (prefers-reduced-motion: reduce) {
        .calendar__day::before {
          transform: none;
          transition:
            opacity var(--duration-fast) var(--easing-out),
            background-color var(--duration-fast) ease;
        }

        /* The pill snaps here, so there is nothing left for the ink to wait for. */
        .calendar__day--selected {
          transition-delay: 0s;
        }
      }
    `,
  ];

  protected willUpdate(changed: PropertyValues<this>) {
    // Follow a selection made from outside — picking a date elsewhere should
    // bring its month into view rather than leave the grid where it was.
    if (changed.has('value') && this.value) {
      this.focusedDate = this.value;
      if (!isSameMonth(this.value, this.visibleMonth)) {
        this.visibleMonth = startOfMonth(this.value);
      }
    }
  }

  protected updated(changed: PropertyValues<this>) {
    if (changed.has('visibleMonth')) this.#snapSelection();

    if (!changed.has('focusedDate')) return;

    // Move the DOM focus along with the roving tab stop — but only when a day
    // already holds it. Refocusing whenever the date changes would yank focus
    // away on first render, and would pull it off the month arrows the moment
    // one was pressed, so a second press would land on a day instead.
    const root = this.renderRoot as ShadowRoot;
    if (!root.activeElement?.classList.contains('calendar__day')) return;

    root.querySelector<HTMLButtonElement>('.calendar__day[tabindex="0"]')?.focus();
  }

  /**
   * Drops the selection pill onto its new cell instead of letting it travel
   * there.
   *
   * A month page is a page change, not a move. The selected day can sit in
   * both grids at different places — 1 April is a spill day at the foot of
   * March and the second cell of April — and the pill would then slide the
   * height of the grid while the grid itself plays its own page transition:
   * two motions over one change, neither explaining the other.
   *
   * Zeroing the duration and *then* reading a layout property is what makes it
   * a snap: the read forces the style recalc that resolves the anchor, so the
   * new position is committed with no transition to run, and the class is off
   * again before anything else can animate from it.
   */
  #snapSelection() {
    const grid = this.renderRoot.querySelector<HTMLElement>('.calendar__grid');
    if (!grid) return;

    grid.classList.add('calendar__grid--paging');
    void grid.offsetHeight;
    grid.classList.remove('calendar__grid--paging');
  }

  #goToMonth = (month: IsoDate, reason: 'prev' | 'next' | 'keyboard') => {
    this.#setVisibleMonth(month);
    this.dispatchEvent(
      new CustomEvent('month-change', {
        detail: { month: this.visibleMonth, reason },
        bubbles: true,
        composed: true,
      }),
    );
  };

  /**
   * Changes the visible month and, when it actually moves, plays a slide in
   * the direction of travel — the one bit of state this component doesn't
   * otherwise make legible (the month `<h2>` swaps text instantly). Routes
   * every path that can change the month — nav buttons, keyboard paging, and
   * picking a day from an adjacent month in `#select` — through here so none
   * of them forgets the animation or disagrees about direction.
   */
  #setVisibleMonth = (month: IsoDate) => {
    const target = startOfMonth(month);
    if (target !== this.visibleMonth) {
      this.#playPageTransition(target > this.visibleMonth ? 'forward' : 'backward');
    }
    this.visibleMonth = target;
  };

  /**
   * WAAPI, not a CSS `animation`: it animates the grid *container* in place,
   * leaving the day `<button>`s themselves untouched. They're re-rendered
   * positionally (no `repeat()` key), which is what lets a button that's
   * already focused stay the same DOM node — and therefore stay focused —
   * across a month change; swapping to a keyed re-mount to get a retriggering
   * CSS animation would have broken exactly that.
   */
  #playPageTransition(direction: 'forward' | 'backward') {
    if (this.#reducedMotion.matches) return;

    const grid = this.renderRoot.querySelector<HTMLElement>('.calendar__grid');
    if (!grid) return;

    // Reads the shared tokens rather than restating them. `--duration-medium`
    // is authored in seconds, like every duration token in this codebase;
    // WAAPI wants milliseconds. A CSS `var()` consumer degrades gracefully
    // when a token isn't defined — a component-test fixture mounted without
    // the app's global stylesheet, say — falling back to its initial value
    // instead of animating; `Element.animate()` has no such fallback and
    // throws on a `NaN` duration, so that same case is guarded explicitly
    // below rather than inheriting the crash.
    const style = getComputedStyle(this);
    const duration = parseFloat(style.getPropertyValue('--duration-medium')) * 1000;
    const easing = style.getPropertyValue('--easing-out').trim();
    if (!(duration > 0) || !easing) return;

    const offset = direction === 'forward' ? '0.75rem' : '-0.75rem';

    // Cancel rather than let it compose: paging twice in quick succession
    // should retarget cleanly from wherever the grid currently is, not layer
    // a second animation on top of one still finishing.
    grid.getAnimations().forEach((animation) => animation.cancel());
    grid.animate(
      [
        { opacity: 0, transform: `translateX(${offset})` },
        { opacity: 1, transform: 'translateX(0)' },
      ],
      { duration, easing, fill: 'both' },
    );
  }

  /**
   * Pages one month, carrying the roving focus along with the grid.
   *
   * Stepping both by the same delta is the whole of it, because `focusedDate`
   * is always inside `visibleMonth` — every path that writes one writes the
   * other (field init, `willUpdate`, `#select`, `#moveFocus`, and this). And
   * `addMonths` already clamps into a shorter month, so 31 January paged
   * forward lands on 28 February by itself.
   *
   * This replaced a `clampToMonth`/`monthsBetween` pair that computed the same
   * two values the long way round — and re-implemented `dates.ts`'s own
   * `YYYY-MM-DD` splitting to do it.
   */
  #stepMonth = (delta: number, reason: 'prev' | 'next') => {
    this.focusedDate = addMonths(this.focusedDate, delta);
    this.#goToMonth(addMonths(this.visibleMonth, delta), reason);
  };

  #onPrevMonth = () => this.#stepMonth(-1, 'prev');

  #onNextMonth = () => this.#stepMonth(1, 'next');

  #select = (date: IsoDate) => {
    this.value = date;
    this.focusedDate = date;
    this.#setVisibleMonth(date);

    this.dispatchEvent(
      new CustomEvent('date-select', {
        detail: { date },
        bubbles: true,
        composed: true,
      }),
    );
  };

  /** Moves the roving focus, pulling the visible month along when it crosses out. */
  #moveFocus = (date: IsoDate) => {
    this.focusedDate = date;
    if (!isSameMonth(date, this.visibleMonth)) this.#goToMonth(date, 'keyboard');
  };

  #onKeyDown = (event: KeyboardEvent) => {
    const from = this.focusedDate;
    const weekStartIndex = weekDayIndex(this.weekStart);

    switch (event.key) {
      case 'ArrowLeft':
        this.#moveFocus(addDays(from, -1));
        break;
      case 'ArrowRight':
        this.#moveFocus(addDays(from, 1));
        break;
      case 'ArrowUp':
        this.#moveFocus(addDays(from, -7));
        break;
      case 'ArrowDown':
        this.#moveFocus(addDays(from, 7));
        break;
      case 'Home':
        this.#moveFocus(startOfWeek(from, weekStartIndex));
        break;
      case 'End':
        this.#moveFocus(addDays(startOfWeek(from, weekStartIndex), 6));
        break;
      case 'PageUp':
        this.#moveFocus(addMonths(from, event.shiftKey ? -12 : -1));
        break;
      case 'PageDown':
        this.#moveFocus(addMonths(from, event.shiftKey ? 12 : 1));
        break;
      case 'Enter':
      case ' ':
        this.#select(from);
        break;
      default:
        return;
    }

    // Only reached when a key above matched: keep the page from scrolling and
    // Space from re-triggering the focused button's click.
    event.preventDefault();
  };

  render() {
    const weeks = monthGrid(this.visibleMonth, this.weekStart);

    // monthGrid is RFC-accurate and therefore 4-6 rows depending on how the
    // month falls across week boundaries (five for February, six for
    // August...), which otherwise resizes the grid under the user's finger
    // while paging. Six rows fits every month, so pad shorter ones out with
    // outside days from the following month.
    while (weeks.length < 6) {
      const lastDate = weeks.at(-1)?.at(-1) ?? this.visibleMonth;
      weeks.push(Array.from({ length: 7 }, (_, index) => addDays(lastDate, index + 1)));
    }

    const first = weeks[0]?.[0] ?? this.visibleMonth;
    const last = weeks.at(-1)?.at(-1) ?? this.visibleMonth;
    const occurrences = occurrencesByDate(this.events, first, last);

    return html`
      <header class="calendar__header">
        <button
          class="calendar__nav"
          type="button"
          aria-label="Mois précédent"
          @click=${this.#onPrevMonth}
        >
          <app-icon class="calendar__nav-icon" icon="chevronLeft"></app-icon>
        </button>
        <h2 class="calendar__month" aria-live="polite">${formatMonthYear(this.visibleMonth)}</h2>
        <button
          class="calendar__nav"
          type="button"
          aria-label="Mois suivant"
          @click=${this.#onNextMonth}
        >
          <app-icon class="calendar__nav-icon" icon="chevronRight"></app-icon>
        </button>
      </header>

      <div
        class="calendar__grid sliding-selection"
        role="grid"
        aria-label="Calendrier, ${formatMonthYear(this.visibleMonth)}"
        @keydown=${this.#onKeyDown}
      >
        <div class="calendar__row" role="row">
          ${weekdayLabels(weekDayIndex(this.weekStart)).map(
            (day) => html`
              <span class="calendar__weekday" role="columnheader" aria-label=${day.long}>
                ${day.narrow}
              </span>
            `,
          )}
        </div>
        ${weeks.map(
          (week) => html`
            <div class="calendar__row" role="row">
              ${week.map((date) => this.#renderDay(date, occurrences.get(date)?.length ?? 0))}
            </div>
          `,
        )}
      </div>
    `;
  }

  #renderDay(date: IsoDate, count: number) {
    const selected = date === this.value;
    const isToday = date === this.today;
    const outside = !isSameMonth(date, this.visibleMonth);

    // Days spilling in from the neighbouring months carry no dot: the grid
    // shows them for shape, not for content, and their own month says it
    // properly. One flag drives both the dot and its spoken equivalent, so a
    // screen reader is never told about a marker that isn't there.
    const marked = count > 0 && !outside;

    // The dot is decorative, so the count has to reach a screen reader through
    // the label instead.
    const events = marked ? `, ${count} ${count === 1 ? 'évènement' : 'évènements'}` : '';

    return html`
      <div class="calendar__cell" role="gridcell" aria-selected=${selected ? 'true' : 'false'}>
        <button
          class=${classMap({
            calendar__day: true,
            'calendar__day--outside': outside,
            'calendar__day--today': isToday,
            'calendar__day--selected': selected,
            // Moving this class is the whole animation: the pill anchors to it
            // and the browser interpolates the four insets between the cells.
            'sliding-selection__active': selected,
          })}
          type="button"
          tabindex=${date === this.focusedDate ? 0 : -1}
          aria-current=${ifDefined(isToday ? 'date' : undefined)}
          aria-label="${formatDayLong(date)}${events}"
          @click=${() => this.#select(date)}
        >
          ${dayOfMonth(date)}
        </button>
        ${marked ? html`<span class="calendar__dot"></span>` : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-calendar': AppCalendar;
  }
}
