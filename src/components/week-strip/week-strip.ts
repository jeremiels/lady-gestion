import { css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  activeHorseQuery,
  eventsRepo,
  formatDayLong,
  todayISO,
  weekGrid,
  workSessionByDate,
  type IsoDate,
} from "../../data/index.ts";
import type { HorseEvent } from "../../data/types.ts";
import { BaseElement } from "../../commons/base-element.ts";

import "../day-card/day-card.ts";
import "../activity-sheet/activity-sheet.ts";

/**
 * The dashboard's week at a glance, and the way to fill it in.
 *
 * Extracted from HomeView, which had grown a query, a grid and a card of its
 * own around what is really one component: the strip decides what a week is,
 * which day is today, and what each day says.
 *
 * Tapping a day opens a sheet naming that day and offering the activities as
 * chips. The strip owns the selection rather than the sheet because it is the
 * strip that knows which row each day is showing — the sheet is handed that row
 * and never looks one up, so the two cannot disagree about what a tap edits.
 */
@customElement("week-strip")
export class WeekStrip extends BaseElement {
  /**
   * The day the sheet is about, or `null` before it has ever been opened.
   *
   * Deliberately *not* cleared on close, and paired with a separate flag rather
   * than standing in for one. The sheet animates itself out over
   * `--duration-slow`, so a day cleared on close would re-title the heading
   * mid-exit; unmounting it outright would skip the exit entirely. Same shape
   * `EventDetailView` uses for the event sheet — a value property that persists
   * and an open flag beside it.
   */
  @state() private selected: IsoDate | null = null;

  @state() private sheetOpen = false;

  /**
   * This week's events, Monday to Sunday.
   *
   * The week is resolved inside the query rather than held as state: LiveQuery
   * re-runs on a write, not on a clock, so holding the range would only add a
   * second thing to keep in step. An app left open across a Sunday midnight
   * keeps showing the old week until the next write — the trade already made
   * one query up.
   */
  #week = activeHorseQuery<HorseEvent[]>(
    this,
    (horseId) => {
      const days = weekGrid(todayISO());
      return eventsRepo.listInRange(horseId, days[0], days[6]);
    },
    [],
  );

  static componentStyles = css`
    :host {
      display: grid;
      gap: var(--spacing-16);
    }

    /* Restated rather than inherited: the section-title class lives in the
       document's components layer, which a shadow root does not see. Kept in
       step with styles/components/section.css by hand — four declarations, and
       piercing the boundary for them would cost more than it saves. */
    .week__title {
      font-family: var(--font-family-heading);
      font-size: 1.125rem;
      line-height: 1.25rem;
      font-weight: 700;
    }

    /* Seven equal columns rather than a scroller: the whole point is seeing the
       week at once, and seven cells fit the readable column at every size the
       app runs at.

       minmax(0, 1fr) and not 1fr, which is minmax(auto, 1fr): a track that
       cannot shrink below its content widens for the one day holding the
       longest activity, and the whole week stops being a grid of equal days. */
    .week__list {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: var(--spacing-6);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    /* The button is the strip's, not the card's. day-card stays presentational
       and inert — it says so itself — so the target, the focus ring and the
       dialog semantics live out here where the behaviour is. */
    .week__day {
      display: block;
      width: 100%;
      padding: 0;
      border: none;
      background: none;
      font: inherit;
      color: inherit;
      text-align: inherit;
      cursor: pointer;
      border-radius: var(--radius-8);
    }

    .week__day:focus-visible {
      outline: 2px solid var(--color-brown-dark);
      outline-offset: 2px;
    }
  `;

  #open = (date: IsoDate) => () => {
    this.selected = date;
    this.sheetOpen = true;
  };

  #close = () => {
    this.sheetOpen = false;
  };

  render() {
    // Resolved once and used for both the grid and the today flag, so the strip
    // cannot draw a week that disagrees with the day it highlights.
    const today = todayISO();
    const days = weekGrid(today);
    const sessions = workSessionByDate(this.#week.value ?? []);
    const { selected, sheetOpen } = this;

    return html`
      <h2 class="week__title">Cette semaine</h2>
      <!-- Positional, not keyed: seven cells in a fixed order, which is exactly
           what positional binding is for. -->
      <ul class="week__list">
        ${days.map(
          (date) => html`
            <li>
              <button
                class="week__day pressable pressable--small"
                type="button"
                aria-haspopup="dialog"
                aria-expanded=${sheetOpen && selected === date ? "true" : "false"}
                aria-label=${`Activité du ${formatDayLong(date)}`}
                @click=${this.#open(date)}
              >
                <day-card
                  .date=${date}
                  .activity=${sessions.get(date)?.activity ?? null}
                  ?today=${date === today}
                ></day-card>
              </button>
            </li>
          `,
        )}
      </ul>

      <!-- Mounted on the first open and kept from then on: the sheet owns its
           own exit animation, and an element removed the moment it closes never
           gets to run one. -->
      ${
        selected === null
          ? nothing
          : html`
              <activity-sheet
                .open=${sheetOpen}
                .date=${selected}
                .existing=${sessions.get(selected) ?? null}
                @sheet-close=${this.#close}
              ></activity-sheet>
            `
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "week-strip": WeekStrip;
  }
}
