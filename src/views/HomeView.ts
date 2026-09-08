import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { LightElement } from "../commons/base-element.ts";
import { appHref } from "../commons/base-path.ts";
import {
  activeHorseQuery,
  LiveQuery,
  endOfMonth,
  eventsRepo,
  eventTypesRepo,
  findEventType,
  horsesRepo,
  startOfMonth,
  todayISO,
} from "../data/index.ts";
import type { EventTypeDef, HorseEvent } from "../data/types.ts";
import { ACCOUNT } from "../data/account.ts";
import "../components/horse-card/horse-card.ts";
import "../components/budget-card/budget-card.ts";
import "../components/week-strip/week-strip.ts";
import "../components/event-card/event-card.ts";
import "../components/app-avatar/app-avatar.ts";

/** The dashboard shows the next few appointments, not the whole agenda. */
const UPCOMING_LIMIT = 3;

@customElement("home-view")
export class HomeView extends LightElement {
  #horse = new LiveQuery(this, () => horsesRepo.getActive());

  #eventTypes = new LiveQuery<EventTypeDef[]>(this, () =>
    eventTypesRepo.listAll(),
  );

  // Already filtered to still-to-happen `planned` events, soonest first.
  #upcoming = activeHorseQuery<HorseEvent[]>(
    this,
    (horseId) =>
      eventsRepo.listUpcoming(
        horseId,
        this.#eventTypes.value ?? [],
        UPCOMING_LIMIT,
      ),
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
      return eventsRepo.totalSpent(
        horseId,
        startOfMonth(today),
        endOfMonth(today),
      );
    },
    0,
  );

  render() {
    const upcoming = this.#upcoming.value ?? [];
    const types = this.#eventTypes.value ?? [];

    return html`
      <section class="home-view">
        <div class="home-view__header">
          <hgroup class="section-group">
            <h1 class="section-title" tabindex="-1">Tableau de bord</h1>
            <p class="section-subtitle">Suivi de Ladympala</p>
          </hgroup>
          <a
            class="home-view__profile-link pressable"
            href=${appHref("/profile")}
            aria-label="Profil"
          >
            <app-avatar
              aria-hidden="true"
              initial=${ACCOUNT.firstName.charAt(0)}
              size="2.5rem"
            ></app-avatar>
          </a>
        </div>

        <week-strip></week-strip>

        <section class="section-appointments">
          <h2 class="section-title">Rendez-vous à venir</h2>
          ${
            upcoming.length === 0
              ? html`<p class="appointment-empty">
                  Aucun rendez-vous à venir.
                </p>`
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
                          <event-card
                            layout="dashboard"
                            .event=${event}
                            .type=${findEventType(types, event.type) ?? null}
                          ></event-card>
                        </li>
                      `,
                    )}
                  </ul>
                `
          }
        </section>

        <horse-card .horse=${this.#horse.value ?? null}></horse-card>
        <budget-card .totalCents=${this.#monthSpend.value ?? 0}></budget-card>
      </section>
    `;
  }
}
