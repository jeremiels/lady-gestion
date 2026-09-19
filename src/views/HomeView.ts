import { html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { LightElement } from "../commons/base-element.ts";
import { appHref } from "../commons/base-path.ts";
import {
  activeHorseQuery,
  COURSE_CATEGORY_KEYS,
  LiveQuery,
  endOfMonth,
  postsRepo,
  categoriesRepo,
  coursePhase,
  findCategory,
  horsesRepo,
  isCourse,
  isCourseOngoing,
  profileRepo,
  startOfMonth,
  todayISO,
  upcomingAppointments,
  type ResolvedCategory,
} from "../data/index.ts";
import type { Post } from "../data/types.ts";
import { displayProfile } from "../data/account.ts";
import "../components/horse-card/horse-card.ts";
import "../components/budget-card/budget-card.ts";
import "../components/documents-card/documents-card.ts";
import "../components/week-strip/week-strip.ts";
import "../components/post-card/post-card.ts";
import "../components/course-card/course-card.ts";
import "../components/app-avatar/app-avatar.ts";

/** The dashboard shows the next few appointments, not the whole agenda. */
const UPCOMING_LIMIT = 3;

/**
 * Hardcoded until the drive is wired up.
 *
 * Deliberately not `DOCUMENT_CATEGORIES.length`: those six are the vault's
 * fixed filing structure, and what this card will end up counting is the
 * drive's own folders.
 */
const DOCUMENT_FOLDERS = 5;

@customElement("home-view")
export class HomeView extends LightElement {
  #horse = new LiveQuery(this, () => horsesRepo.getActive());
  #profile = new LiveQuery(this, () => profileRepo.get());

  #categories = new LiveQuery<ResolvedCategory[]>(this, () =>
    categoriesRepo.listEnabled(),
  );

  // Already filtered to still-to-happen `planned` events, soonest first — not
  // yet narrowed to appointments or capped to `UPCOMING_LIMIT`; `render()`
  // does both, joined against `#categories` fresh on every render. See
  // `upcomingAppointments`'s doc comment for why that join cannot live inside
  // this query instead.
  #upcoming = activeHorseQuery<Post[]>(
    this,
    (horseId) => postsRepo.listUpcoming(horseId),
    [],
  );

  // Every cure and traitement, not only the running ones: which have started
  // and which have ended both depend on today, so `render()` narrows it
  // rather than the query.
  #courses = activeHorseQuery<Post[]>(
    this,
    (horseId) => postsRepo.listByCategory(horseId, COURSE_CATEGORY_KEYS),
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
      return postsRepo.totalSpent(
        horseId,
        startOfMonth(today),
        endOfMonth(today),
      );
    },
    0,
  );

  render() {
    const types = this.#categories.value ?? [];
    const today = todayISO();
    // A cure is an appointment category, so it sits in this list until the day
    // it starts — from then on it belongs to "En cours" below, not to both.
    // Only its first day can actually collide (`listUpcoming` is already
    // `date >= today`), but phrasing it as the phase keeps it right for a row
    // whose status was set by hand.
    const upcoming = upcomingAppointments(
      (this.#upcoming.value ?? []).filter(
        (post) => !isCourse(post) || coursePhase(post, today) === "upcoming",
      ),
      types,
      UPCOMING_LIMIT,
    );
    const ongoing = (this.#courses.value ?? []).filter((post) =>
      isCourseOngoing(post, today),
    );

    return html`
      <section class="home-view">
        <div class="home-view__header">
          <hgroup class="section-group">
            <h1 class="page-title" tabindex="-1">Tableau de bord</h1>
            <p class="section-subtitle">Suivi de Ladympala</p>
          </hgroup>
          <a
            class="home-view__profile-link pressable"
            href=${appHref("/profile")}
            aria-label="Profil"
          >
            <app-avatar
              aria-hidden="true"
              initial=${displayProfile(this.#profile.value).firstName.charAt(0)}
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
                          <post-card
                            layout="dashboard"
                            .post=${event}
                            .category=${findCategory(types, event.categoryKey) ?? null}
                          ></post-card>
                        </li>
                      `,
                    )}
                  </ul>
                `
          }
        </section>

        ${
          // Left out entirely when nothing is running, rather than an empty
          // block on the dashboard.
          ongoing.length > 0
            ? html`
                <section class="section-courses">
                  <h2 class="section-title">En cours</h2>
                  <ul class="course-list">
                    ${repeat(
                      ongoing,
                      (post) => post.id,
                      (post) => html`
                        <li>
                          <course-card
                            layout="compact"
                            .post=${post}
                            .category=${findCategory(types, post.categoryKey) ?? null}
                            .today=${today}
                          ></course-card>
                        </li>
                      `,
                    )}
                  </ul>
                </section>
              `
            : nothing
        }

        <horse-card .horse=${this.#horse.value ?? null}></horse-card>
        <div class="home-view__section-col">
          <budget-card .totalCents=${this.#monthSpend.value ?? 0}></budget-card>
          <documents-card .folderCount=${DOCUMENT_FOLDERS}></documents-card>
        </div>
      </section>
    `;
  }
}
