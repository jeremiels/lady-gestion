import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { LightElement } from '../commons/base-element.ts';
import { appHref } from '../commons/base-path.ts';
import {
  activeHorseQuery,
  LiveQuery,
  endOfMonth,
  eventsRepo,
  horsesRepo,
  startOfMonth,
  todayISO,
  weekGrid,
  workActivityByDate,
} from '../data/index.ts';
import type { HorseEvent } from '../data/types.ts';
import { ACCOUNT } from '../data/account.ts';
import '../components/horse-card/horse-card.ts';
import '../components/budget-card/budget-card.ts';
import '../components/day-card/day-card.ts';
import '../components/event-card/event-card.ts';
import '../components/app-avatar/app-avatar.ts';

/** The dashboard shows the next few appointments, not the whole agenda. */
const UPCOMING_LIMIT = 3;

@customElement('home-view')
export class HomeView extends LightElement {
  #horse = new LiveQuery(this, () => horsesRepo.getActive());

  // Already filtered to still-to-happen `planned` events, soonest first.
  #upcoming = activeHorseQuery<HorseEvent[]>(
    this,
    (horseId) => eventsRepo.listUpcoming(horseId, UPCOMING_LIMIT),
    [],
  );

  /**
   * This calendar month's spend, in cents.
   *
   * The month is resolved inside the query rather than held as state: this
   * re-runs whenever `events` is written to, so a row added after midnight on
   * the 1st lands in the new month without the view tracking the date itself.
   */
  #monthSpend = activeHorseQuery<number>(
    this,
    (horseId) => {
      const today = todayISO();
      return eventsRepo.totalSpent(horseId, startOfMonth(today), endOfMonth(today));
    },
    0,
  );

  /**
   * This week's events, Monday to Sunday.
   *
   * The week is resolved inside the query for the same reason the month above
   * is: `LiveQuery` re-runs on a write, not on a clock, so holding the range as
   * state would only add a second thing to keep in step. An app left open
   * across a Sunday midnight keeps showing the old week until the next write —
   * the trade already made one query up.
   */
  #week = activeHorseQuery<HorseEvent[]>(
    this,
    (horseId) => {
      const days = weekGrid(todayISO());
      return eventsRepo.listInRange(horseId, days[0], days[6]);
    },
    [],
  );

  render() {
    const upcoming = this.#upcoming.value ?? [];
    // Resolved once and used for both the grid and the today flag, so the strip
    // cannot draw a week that disagrees with the day it highlights.
    const today = todayISO();
    const days = weekGrid(today);
    const activities = workActivityByDate(this.#week.value ?? []);

    return html`
      <section class="home-view">
        <div class="home-view__header">
          <hgroup class="section-group">
            <h1 class="section-title" tabindex="-1">Tableau de bord</h1>
            <p class="section-subtitle">Suivi de Ladympala</p>
          </hgroup>
          <a class="home-view__profile-link pressable" href=${appHref('/profile')} aria-label="Profil">
            <app-avatar aria-hidden="true" initial=${ACCOUNT.firstName.charAt(0)} size="2.5rem"></app-avatar>
          </a>
        </div>

        <section class="section-appointments">
          <h2 class="section-title">Rendez-vous à venir</h2>
          ${upcoming.length === 0
            ? html`<p class="appointment-empty">Aucun rendez-vous à venir.</p>`
            : html`
                <!-- Keyed: this is a top-3 window onto a moving list, so a new
                     appointment sooner than the current first pushes every row
                     down by one — the exact case positional binding rewrites
                     wholesale. -->
                <ul class="appointment-list">
                  ${repeat(
                    upcoming,
                    (event) => event.id,
                    (event) => html`
                      <li>
                        <event-card layout="dashboard" .event=${event}></event-card>
                      </li>
                    `,
                  )}
                </ul>
              `}
        </section>

        <section class="section-week">
          <h2 class="section-title">Cette semaine</h2>
          <!-- Positional, not keyed: seven cells in a fixed order, which is
               exactly what positional binding is for. The appointment list
               above is keyed because its window slides. -->
          <ul class="week-list">
            ${days.map(
              (date) => html`
                <li>
                  <day-card
                    .date=${date}
                    .activity=${activities.get(date) ?? null}
                    ?today=${date === today}
                  ></day-card>
                </li>
              `,
            )}
          </ul>
        </section>

        <horse-card .horse=${this.#horse.value ?? null}></horse-card>
        <budget-card .totalCents=${this.#monthSpend.value ?? 0}></budget-card>
      </section>
    `;
  }
}
