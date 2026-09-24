import { css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  activeHorseQuery,
  courseDatesThisWeek,
  postsRepo,
  categoriesRepo,
  formatDayLong,
  LiveQuery,
  weekGrid,
  workSessionByDate,
  type IsoDate,
  type ResolvedCategory,
} from "../../data/index.ts";
import type { Post } from "../../data/types.ts";
import { BaseElement } from "../../commons/base-element.ts";
import { Today } from "../../commons/controllers/today.ts";

import "../day-card/day-card.ts";

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
   * `PostDetailView` uses for the event sheet — a value property that persists
   * and an open flag beside it.
   */
  @state() private selected: IsoDate | null = null;

  @state() private sheetOpen = false;

  /** Refreshes `#week` when the day turns, so Monday opens on the new week. */
  #today = new Today(this, () => this.#week.refresh());

  /** This week's events, Monday to Sunday. */
  #week = activeHorseQuery<Post[]>(
    this,
    (horseId) => {
      const days = weekGrid(this.#today.value);
      return postsRepo.listInRange(horseId, days[0], days[6]);
    },
    [],
  );

  #categories = new LiveQuery<ResolvedCategory[]>(this, () =>
    categoriesRepo.listEnabled(),
  );

  /** The type the day sheet writes to — the one type flagged `tracksWork`. */
  get #workType(): ResolvedCategory | null {
    return (
      (this.#categories.value ?? []).find((type) => type.tracksWork) ?? null
    );
  }

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
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }
  `;

  #open = (date: IsoDate) => async () => {
    // No work type to record against once the catalogue has settled: `travail`
    // is switched off in Personnaliser › Catégories, so there is nothing for
    // the sheet to write. Before it settles, open as always.
    if (this.#categories.value !== undefined && !this.#workType) return;

    // Loaded on the first tap rather than imported with the strip: the sheet
    // brings app-bottom-sheet and the form fields with it, which the dashboard
    // otherwise never draws, and the strip sits on the landing route. Both
    // flags land in one update afterwards, so the sheet's first render is
    // already open and its entry animation plays — as app-root does for the
    // post sheet.
    await import("../activity-sheet/activity-sheet.ts");
    this.selected = date;
    this.sheetOpen = true;
  };

  #close = () => {
    this.sheetOpen = false;
  };

  render() {
    // Resolved once and used for both the grid and the today flag, so the strip
    // cannot draw a week that disagrees with the day it highlights.
    const today = this.#today.value;
    const days = weekGrid(today);
    const sessions = workSessionByDate(
      this.#week.value ?? [],
      this.#categories.value ?? [],
    );
    const courseDates = courseDatesThisWeek(this.#week.value ?? []);
    const { selected, sheetOpen } = this;

    return html`
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
                  ?course=${courseDates.has(date)}
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
                .type=${this.#workType}
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
