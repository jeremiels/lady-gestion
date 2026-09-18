import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { appHref } from "../commons/base-path.ts";
import { LightElement } from "../commons/base-element.ts";
import { goBackOutOf } from "../commons/navigation.ts";
import {
  HORSE_TABS,
  horseTabPath,
  isHorsePath,
  type HorseTab,
} from "../commons/sections.ts";
import {
  COURSE_CATEGORY_KEYS,
  LiveQuery,
  activeHorseQuery,
  categoriesRepo,
  horsesRepo,
  postsRepo,
  rationsRepo,
  todayISO,
  type ResolvedCategory,
} from "../data/index.ts";
import type { Post, RationItem } from "../data/types.ts";
import type { SubnavItem } from "../components/app-subnav/app-subnav.ts";

import "../components/app-icon/app-icon.ts";
import "../components/app-subnav/app-subnav.ts";
import "../components/horse-card/horse-card.ts";
import "../components/horse-courses/horse-courses.ts";
import "../components/horse-profile/horse-profile.ts";
import "../components/horse-ration/horse-ration.ts";

/** Only ever opened from the dashboard, so that's the only fallback back needs. */
const HOME = "/";

/**
 * The horse's page, and the container for its sub-pages.
 *
 * Owns the data (both queries); every piece of the page itself is a
 * presentational component fed from here. The ration is read-only here — it is
 * edited on Personnaliser mon interface › Ration (`CustomizeView`). Which
 * sub-page is shown is not state either — it is the URL, parsed by the route
 * table in `app-root` and handed down as `tab`.
 */
@customElement("horse-view")
export class HorseView extends LightElement {
  /**
   * From the URL; `null` for the bare `/horse`. Only builds the sub-nav's links
   * for now — the data still comes from `horsesRepo.getActive()`.
   */
  @property({ attribute: false }) horseId: string | null = null;
  @property({ attribute: false }) tab: HorseTab = HORSE_TABS[0].id;

  // Both re-run automatically whenever a table they read is written to, so an
  // edit made on the customize page shows here without any manual refresh.
  #horse = new LiveQuery(this, () => horsesRepo.getActive());
  #rations = activeHorseQuery<RationItem[]>(
    this,
    (horseId) => rationsRepo.listByHorse(horseId),
    [],
  );

  #categories = new LiveQuery<ResolvedCategory[]>(this, () =>
    categoriesRepo.listEnabled(),
  );

  // Both course tabs from one query; each tab narrows it to its own category.
  #courses = activeHorseQuery<Post[]>(
    this,
    (horseId) => postsRepo.listByCategory(horseId, COURSE_CATEGORY_KEYS),
    [],
  );

  // Out of the whole horse section, not one entry back: every tab switch pushes
  // an entry, so a plain `goBack` walked back through the tabs.
  #goBack = () => goBackOutOf(isHorsePath, HOME);

  render() {
    const horse = this.#horse.value;
    const horseId = this.horseId ?? horse?.id ?? null;

    return html`
      <section class="horse-view">
        <!--
          The visible title is the horse's name inside horse-card, which sits in
          a shadow root and so cannot serve as this page's heading. This gives
          the view a real h1 for the document outline and a focus target for the
          route change in app-root.
        -->
        <hgroup class="section-group">
          <h1 class="section-title" tabindex="-1">${horse?.name}</h1>
          <p class="section-subtitle">Fiche synthèse</p>
        </hgroup>
        <div class="horse-view__cover">
          <horse-card
            context-type="horse-view"
            class="horse-view__card"
            .horse=${horse ?? null}
          ></horse-card>
          <button
            class="horse-view__back pressable pressable--small"
            type="button"
            aria-label="Retour"
            @click=${this.#goBack}
          >
            <app-icon icon="chevronLeft"></app-icon>
          </button>
        </div>
        ${
          // Links need an id; only the bare `/horse` before the horse has
          // loaded has none, and that is a single tick.
          horseId
            ? html`<app-subnav
                class="horse-view__subnav"
                label="Sections de la fiche"
                .items=${this.#subnavItems(horseId)}
              ></app-subnav>`
            : nothing
        }
        <div class="horse-view__panel">${this.#renderTab()}</div>
      </section>
    `;
  }

  #subnavItems(horseId: string): SubnavItem[] {
    return HORSE_TABS.map((tab) => ({
      href: appHref(horseTabPath(horseId, tab.id)),
      label: tab.label,
      current: tab.id === this.tab,
    }));
  }

  #renderTab() {
    switch (this.tab) {
      case "ration":
        return html`<horse-ration
          .rations=${this.#rations.value ?? []}
          .today=${todayISO()}
        ></horse-ration>`;
      case "cures":
        return this.#renderCourses(
          "cures",
          "Cures",
          "Aucune cure enregistrée.",
        );
      case "traitements":
        return this.#renderCourses(
          "traitement",
          "Traitements",
          "Aucun traitement enregistré.",
        );
      case "cheval":
        return html`<horse-profile
          .horse=${this.#horse.value ?? null}
        ></horse-profile>`;
    }
  }

  #renderCourses(categoryKey: string, label: string, empty: string) {
    const posts = (this.#courses.value ?? []).filter(
      (post) => post.categoryKey === categoryKey,
    );
    return html`<horse-courses
      .posts=${posts}
      .categories=${this.#categories.value ?? []}
      .label=${label}
      .empty=${empty}
      .today=${todayISO()}
    ></horse-courses>`;
  }
}
