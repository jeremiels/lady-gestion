import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { appHref } from "../commons/base-path.ts";
import { LightElement } from "../commons/base-element.ts";
import { goBack } from "../commons/navigation.ts";
import {
  HORSE_TABS,
  horseTabPath,
  type HorseTab,
} from "../commons/sections.ts";
import {
  LiveQuery,
  activeHorseQuery,
  horsesRepo,
  rationsRepo,
  rationsService,
  todayISO,
} from "../data/index.ts";
import type { RationItem } from "../data/types.ts";
import type { SubnavItem } from "../components/app-subnav/app-subnav.ts";
import type { RationSubmitDetail } from "../components/ration-sheet/ration-sheet.ts";

import "../components/app-icon/app-icon.ts";
import "../components/app-subnav/app-subnav.ts";
import "../components/horse-card/horse-card.ts";
import "../components/horse-profile/horse-profile.ts";
import "../components/horse-ration/horse-ration.ts";
import "../components/ration-sheet/ration-sheet.ts";

/** Only ever opened from the dashboard, so that's the only fallback back needs. */
const HOME = "/";

/**
 * The horse's page, and the container for its sub-pages.
 *
 * Owns the data (both queries), the edit sheet's open state and the save; every
 * piece of the page itself is a presentational component fed from here. Which
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

  @state() private rationSheetOpen = false;

  // Both re-run automatically whenever a table they read is written to, so
  // saving the ration sheet re-renders the list without any manual refresh.
  #horse = new LiveQuery(this, () => horsesRepo.getActive());
  #rations = activeHorseQuery<RationItem[]>(
    this,
    (horseId) => rationsRepo.listByHorse(horseId),
    [],
  );

  #openRationSheet = () => {
    this.rationSheetOpen = true;
  };

  #closeRationSheet = () => {
    this.rationSheetOpen = false;
  };

  #goBack = () => goBack(HOME);

  /**
   * Hands the sheet's form to `rationsService.saveRationSheet`, against the
   * same list that rendered it.
   *
   * Passing `#rations.value` rather than letting the service read the plan back
   * is the point: the schema, the lookup and the diff all have to run against
   * the lines the user was actually looking at.
   *
   * A failed parse leaves the sheet open with nothing said, as it always has.
   * Every normal path is already blocked by the inputs' own `required` and
   * `pattern`, so reaching here means the platform was bypassed — there is no
   * field to point at and no wording that would help.
   */
  #onRationSubmit = async (event: CustomEvent<RationSubmitDetail>) => {
    const result = await rationsService.saveRationSheet(
      this.#rations.value ?? [],
      event.detail.form,
    );

    if (result.ok) this.rationSheetOpen = false;
  };

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
        <h1 class="visually-hidden" tabindex="-1">
          ${horse?.name ?? "Fiche du cheval"}
        </h1>
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
      case "ration": {
        const rations = this.#rations.value ?? [];
        return html`
          <horse-ration
            .rations=${rations}
            .today=${todayISO()}
            @ration-edit=${this.#openRationSheet}
          ></horse-ration>
          <ration-sheet
            .open=${this.rationSheetOpen}
            .rations=${rations}
            @ration-submit=${this.#onRationSubmit}
            @sheet-close=${this.#closeRationSheet}
          ></ration-sheet>
        `;
      }
      case "cheval":
        return html`<horse-profile
          .horse=${this.#horse.value ?? null}
        ></horse-profile>`;
      default: {
        // Cures and Traitements have no content yet.
        const label = HORSE_TABS.find((tab) => tab.id === this.tab)!.label;
        return html`<p class="horse-view__tab-placeholder">${label}</p>`;
      }
    }
  }
}
