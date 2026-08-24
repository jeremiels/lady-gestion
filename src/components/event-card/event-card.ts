import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { BaseElement } from '../../commons/base-element.ts';
import { appHref } from '../../commons/base-path.ts';
import { formatDate, formatTime } from '../../data/dates.ts';
import { formatCents } from '../../data/money.ts';
import type { HorseEvent } from '../../data/types.ts';
import { eventType } from '../../types/event.types.ts';

import { iconStyle } from '../app-icon/app-icon.ts';
import { tagStyle } from '../app-tag/app-tag.ts';

/**
 * Which of the card's optional parts are shown. The record is the same in every
 * case; only what a given list has room to say about it changes.
 *
 * - `default` — everything: date, time and price on one meta line, notes under.
 * - `dashboard` — no notes. The dashboard is a three-row glance at what is
 *   coming up, and one vet's paragraph turns that into a wall of text.
 * - `expenses` — the price leaves the meta line for its own right-aligned cell,
 *   and the notes go, because a ledger is read down the amounts column.
 */
export type EventCardLayout = 'default' | 'dashboard' | 'expenses';

/**
 * One event in a list: category icon, title, date and price, its type as a tag
 * and the notes underneath.
 *
 * Presentational — the owning view holds the query and passes the record down.
 */
@customElement('event-card')
export class EventCard extends BaseElement {
  @property({ attribute: false }) event: HorseEvent | null = null;

  /** Reflected so the styles below can key off it. */
  @property({ type: String, reflect: true }) layout: EventCardLayout = 'default';

  static componentStyles = css`
    :host {
      display: block;
      /*
       * The card queries its own width rather than being told about it.
       *
       * :host is an ancestor of everything in this shadow root, so an
       * @container rule below resolves against the host's own box — no
       * container has to be declared by whoever renders the card, and no class
       * or attribute has to describe where it sits. The list decides how much
       * room the card gets; the card reads the result.
       *
       * Safe here specifically because the host is a block inside a grid track:
       * a block's inline size comes from its containing block, not its
       * contents, so the inline-size containment this turns on changes nothing.
       * It would collapse a content-sized host — which is why app-tag, app-chip
       * and app-segmented, all inline-flex, must not be given one.
       *
       * This is not what distinguishes the layout attribute below. Every list
       * in the app is a single full-width column, so the card is exactly as
       * wide on the dashboard as in the calendar; layout is an editorial choice
       * about how much to say, which no measurement can stand in for.
       */
      container-type: inline-size;
    }

    /* The whole card is the target — a phone-sized tap area, and it means the
       link text a screen reader announces is the event's own title rather than
       a "voir" tacked on the end. */
    .event-card__link {
      display: block;
      color: inherit;
      text-decoration: none;
      border-radius: var(--radius-12);
    }

    .event-card__link:focus-visible {
      outline: 2px solid var(--color-brown-dark);
      outline-offset: 2px;
    }

    /* Was the global .container class plus an override in
       styles/components/event-card.css. Both live here now that the card owns
       its own shadow root, so the padding no longer has to out-specify a shared
       class on the same element. */
    .event-card {
      display: grid;
      grid-template-columns: auto 1fr auto;
      grid-template-areas:
        "icon title tag"
        "icon meta  meta"
        "icon notes notes";
      align-items: start;
      column-gap: var(--spacing-8);
      row-gap: var(--spacing-4);
      padding: var(--spacing-16);
      border-radius: var(--radius-12);
      background-color: var(--color-white);
    }

    .event-card__icon {
      grid-area: icon;
      width: 2rem;
      height: 2rem;
      border-radius: var(--radius-8);
    }

    .event-card__title {
      grid-area: title;
      align-self: center;
      font-size: 0.875rem;
      line-height: 1.25rem;
      font-weight: 600;
      color: var(--color-dark);
    }

    .event-card__tag {
      grid-area: tag;
      align-self: center;
      justify-self: end;
    }

    .event-card__meta {
      grid-area: meta;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      font-size: 0.625rem;
      line-height: 0.875rem;
      font-weight: 500;
      color: var(--color-text-muted);
    }

    .event-card__meta span + span::before {
      content: "•";
      margin: 0 var(--spacing-6);
    }

    .event-card__notes {
      grid-area: notes;
      font-size: 0.75rem;
      line-height: 1.35;
      color: var(--color-text-muted);
    }

    /* The amount moves out of the meta line and under the tag, which is what
       makes a column of them scannable down the right edge. */
    :host([layout="expenses"]) .event-card {
      grid-template-areas:
        "icon title  tag"
        "icon meta   amount";
    }

    :host([layout="dashboard"]) .event-card {
      align-items: center;
      grid-template-areas:
        "icon title  tag"
        "icon meta   tag";
    }

    .event-card__amount {
      grid-area: amount;
      align-self: center;
      justify-self: end;
      white-space: nowrap;
      font-size: 0.9375rem;
      font-weight: 700;
      color: var(--color-dark);
    }

    /*
     * On a small phone the title and the tag cannot share a row.
     *
     * A 320px-wide device leaves the card about 17.5rem once the page padding
     * is taken off; the icon column and the gaps claim ~4rem of that, so a
     * title like "Rappel de vaccination" and a tag like "Vétérinaire" end up
     * fighting over roughly 13rem and the title wins by wrapping to three
     * lines. Below the threshold the tag drops onto its own row and both get
     * the full width.
     *
     * Keyed to the card's own inline size, not the viewport: the card is the
     * thing running out of room, and a viewport media query would be wrong the
     * moment one of these is ever rendered somewhere narrower than the page.
     */
    @container (max-inline-size: 20rem) {
      .event-card {
        grid-template-columns: auto 1fr;
        grid-template-areas:
          "icon title"
          "icon tag"
          "icon meta"
          "icon notes";
      }

      .event-card__tag {
        justify-self: start;
      }

      :host([layout="expenses"]) .event-card {
        grid-template-areas:
          "icon title"
          "icon tag"
          "icon meta"
          "icon amount";
      }

      :host([layout="expenses"]) .event-card__amount {
        justify-self: start;
      }
    }
  `;

  render() {
    const event = this.event;
    if (!event) return nothing;

    // Resolved here rather than inside app-icon/app-tag: those two are
    // domain-free, so the view that knows what an event *is* supplies the glyph,
    // the wording and the colours.
    const theme = eventType.theme(event.type);
    const price = event.amountCents === null ? null : formatCents(event.amountCents, event.currency);
    const trailingAmount = this.layout === 'expenses';
    const showNotes = this.layout === 'default' && event.notes;

    // An anchor rather than a click handler: the Navigation API intercepts it
    // for free, and where that API is missing this still works as a real page
    // load — the service worker answers any path with the cached shell.
    return html`
      <a class="event-card__link pressable" href="${appHref(`/events/${event.id}`)}">
        <article class="event-card">
          <app-icon
            class="event-card__icon"
            icon=${eventType.icon(event.type)}
            style=${styleMap(iconStyle(theme))}
          ></app-icon>

          <h3 class="event-card__title">${event.title}</h3>
          <app-tag
            class="event-card__tag"
            label=${eventType.label(event.type)}
            style=${styleMap(tagStyle(theme))}
          ></app-tag>

          <p class="event-card__meta">
            <span>${formatDate(event.date)}</span>
            ${event.time ? html`<span>${formatTime(event.time)}</span>` : nothing}
            ${price && !trailingAmount ? html`<span>${price}</span>` : nothing}
          </p>

          <!-- U+2212, not a hyphen: it is the same width as the digits beside
               it, so a column of amounts stays aligned. -->
          ${price && trailingAmount
            ? html`<span class="event-card__amount">−&nbsp;${price}</span>`
            : nothing}

          ${showNotes ? html`<p class="event-card__notes">${event.notes}</p>` : nothing}
        </article>
      </a>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'event-card': EventCard;
  }
}
