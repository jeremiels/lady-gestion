import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { BaseElement } from '../../commons/base-element.ts';
import { dayOfMonth, formatWeekdayShort, todayISO, type IsoDate } from '../../data/dates.ts';
import { formatWorkActivity, type WorkActivity } from '../../data/events.ts';

/**
 * One day of the dashboard's week strip: the weekday, the date, and what the
 * horse worked on that day.
 *
 * Two styles, and the second is `today` — the dark card the design puts under
 * the current day. Which day that is comes from the owning view rather than
 * being read here, the same way `app-calendar` takes an overridable `today`: a
 * component that samples the clock itself cannot be tested against a fixed week,
 * and two of them on a page could disagree across midnight.
 *
 * Deliberately not a link or a button. The strip is a glance at the week, not a
 * way through to anything, so it takes no focus and offers no target.
 *
 * The formatter comes straight from `data/events.ts` rather than the barrel:
 * `data/index.ts` pulls `db.ts`, which constructs Dexie at module scope, and
 * that would land the whole database in this card's chunk.
 */
@customElement('day-card')
export class DayCard extends BaseElement {
  /** The day this card stands for, `YYYY-MM-DD`. */
  @property({ type: String }) date: IsoDate = todayISO();

  /** The day's work session, or `null` for a day with none. */
  @property({ attribute: false }) activity: WorkActivity | null = null;

  /** The second of the two styles. Reflected so `:host([today])` can paint it. */
  @property({ type: Boolean, reflect: true }) today = false;

  static componentStyles = css`
    :host {
      display: block;
    }

    .day {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-4);
      padding: var(--spacing-10) var(--spacing-2);
      border-radius: var(--radius-8);
      background: var(--color-white);
      text-align: center;
      height: 5.75rem;
      border: 1px solid #F0ECE8;
      font-family: var(--font-family-body);
      font-weight: 400;
    }

    .day__date {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-2);
    }

    .day__weekday {
      font-size: 0.563rem;
      line-height: 0.844rem;
      font-weight: 600;
      color: var(--color-brown-light);
    }

    .day__number {
      font-size: 0.750rem;
      line-height: 0.938rem;
      font-weight: 500;
      color: var(--color-dark);
    }

    /* The line is reserved whether or not there is a session in it: a day with
       nothing has to stand as tall as its neighbours, or the numbers above stop
       lining up across the row.

       A column here is about 45px wide and Trotting is wider than that, so a
       long single word spills a little into the gutter — centred, and never as
       far as the next card, because the gutter is wider than the overflow.
       Wrapping it instead would need overflow-wrap: anywhere, which breaks a
       word mid-syllable; multi-word labels still wrap at their spaces, and the
       grid row stretches every card together so the numbers stay aligned. */
    .day__activity {
      min-height: 1lh;
      font-size: 0.563rem;
      line-height: 1.2;
      font-weight: 600;
      color: var(--color-dark);
    }

    /* Today, inverted — same hierarchy, not a different one: the weekday stays
       the quiet half and the number the loud one. */
    :host([today]) .day {
      background: var(--color-dark);
    }

    :host([today]) .day__weekday {
      color: var(--color-text-muted-on-dark);
    }

    :host([today]) .day__number,
    :host([today]) .day__activity {
      color: var(--color-white);
    }
  `;

  render() {
    return html`
      <div class="day">
        <time
          class="day__date"
          datetime=${this.date}
          aria-current=${ifDefined(this.today ? 'date' : undefined)}
        >
          <span class="day__weekday">${formatWeekdayShort(this.date)}</span>
          <span class="day__number">${dayOfMonth(this.date)}</span>
        </time>
        <p class="day__activity">
          ${this.activity === null ? nothing : formatWorkActivity(this.activity)}
        </p>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'day-card': DayCard;
  }
}
