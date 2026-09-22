import { html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { appHref } from "../commons/base-path.ts";
import { LightElement } from "../commons/base-element.ts";
import { Today } from "../commons/controllers/today.ts";
import { navigateTo } from "../commons/navigation.ts";
import {
  CUSTOMIZE_TABS,
  customizeTabPath,
  type CustomizeTab,
} from "../commons/sections.ts";
import {
  LiveQuery,
  activeHorseQuery,
  categoriesRepo,
  horsesRepo,
  horsesService,
  profileRepo,
  rationsRepo,
  rationsService,
  readForm,
  text,
} from "../data/index.ts";
import { displayProfile } from "../data/account.ts";
import type { RationItem } from "../data/types.ts";
import type { CategoryToggleDetail } from "../components/customize-categories/customize-categories.ts";
import type {
  HorseFieldErrors,
  HorseSubmitDetail,
} from "../components/customize-horse/customize-horse.ts";
import type { SubnavItem } from "../components/app-subnav/app-subnav.ts";
import type {
  RationAddDetail,
  RationAddErrors,
} from "../components/customize-ration/customize-ration.ts";
import type { RationRowDetail } from "../components/horse-ration/horse-ration.ts";
import type { RationSubmitDetail } from "../components/ration-sheet/ration-sheet.ts";
import {
  PROFILE_FIELDS,
  type ProfileFieldErrors,
  type ProfileSubmitDetail,
} from "../components/customize-profile/customize-profile.ts";

import "../components/app-icon/app-icon.ts";
import "../components/app-modal/app-modal.ts";
import "../components/ration-sheet/ration-sheet.ts";
import "../components/app-subnav/app-subnav.ts";
import "../components/customize-profile/customize-profile.ts";
import "../components/customize-ration/customize-ration.ts";
import "../components/customize-categories/customize-categories.ts";
import "../components/customize-horse/customize-horse.ts";

/**
 * The parent page. Back goes there directly rather than through history:
 * switching tabs pushes entries, so `goBack` would walk back through the tabs.
 */
const PROFILE = "/profile";

const PROFILE_SCHEMA = {
  [PROFILE_FIELDS.firstName]: text({ required: true, maxLength: 80 }),
  [PROFILE_FIELDS.lastName]: text({ maxLength: 80 }),
  [PROFILE_FIELDS.email]: text({ required: true, maxLength: 254 }),
};

/**
 * Personnaliser mon interface, and the container for its sub-pages — the same
 * split as `HorseView`: the tab is the URL, handed down by the route table;
 * this owns the query and the save, the tabs are presentational.
 */
@customElement("customize-view")
export class CustomizeView extends LightElement {
  /** Re-renders when the day turns, so the today passed below moves with it. */
  #today = new Today(this);

  @property({ attribute: false }) tab: CustomizeTab = CUSTOMIZE_TABS[0].id;

  @state() private profileErrors: ProfileFieldErrors = {};
  @state() private profileStatus = "";

  @state() private horseErrors: HorseFieldErrors = {};
  @state() private horseStatus = "";

  @state() private rationErrors: RationAddErrors = {};
  @state() private rationSheetOpen = false;
  /**
   * The line the edit sheet was last opened on. Kept after closing so the sheet
   * does not empty while it animates out.
   */
  @state() private rationToEdit: RationItem | null = null;
  @state() private rationEditErrors: RationAddErrors = {};
  /** The line waiting on the delete confirmation, or `null` when it is closed. */
  @state() private rationToDelete: RationItem | null = null;

  #profile = new LiveQuery(this, () => profileRepo.get());
  #horse = new LiveQuery(this, () => horsesRepo.getActive());
  #rations = activeHorseQuery<RationItem[]>(
    this,
    (horseId) => rationsRepo.listByHorse(horseId),
    [],
  );

  /** Every category, switched off or not — the one list that shows both. */
  #categories = new LiveQuery(this, () => categoriesRepo.listResolved());

  #goBack = () => navigateTo(appHref(PROFILE));

  #onCategoryToggle = async (event: CustomEvent<CategoryToggleDetail>) => {
    await categoriesRepo.setEnabled(event.detail.id, event.detail.enabled);
  };

  #onProfileSubmit = async (event: CustomEvent<ProfileSubmitDetail>) => {
    this.profileStatus = "";
    const result = readForm(event.detail.data, PROFILE_SCHEMA);
    if (!result.ok) {
      this.profileErrors = result.errors;
      return;
    }

    this.profileErrors = {};
    await profileRepo.save(result.value);
    this.profileStatus = "Modifications enregistrées.";
  };

  #onHorseSubmit = async (event: CustomEvent<HorseSubmitDetail>) => {
    const horse = this.#horse.value;
    if (!horse) return;

    this.horseStatus = "";
    const result = await horsesService.saveHorseProfile(
      horse,
      event.detail.form,
    );
    if (!result.ok) {
      this.horseErrors = result.errors;
      return;
    }

    this.horseErrors = {};
    this.horseStatus = "Modifications enregistrées.";
  };

  #onRationAdd = async (event: CustomEvent<RationAddDetail>) => {
    const horse = this.#horse.value;
    if (!horse) return;

    const { form } = event.detail;
    const result = await rationsService.addRation(horse.id, form);
    if (!result.ok) {
      this.rationErrors = result.errors;
      return;
    }

    this.rationErrors = {};
    form.reset();
  };

  #onRationEdit = (event: CustomEvent<RationRowDetail>) => {
    this.rationEditErrors = {};
    this.rationToEdit =
      this.#rations.value?.find((ration) => ration.id === event.detail.id) ??
      null;
    this.rationSheetOpen = this.rationToEdit !== null;
  };

  #closeRationSheet = () => {
    this.rationSheetOpen = false;
  };

  /**
   * Hands the sheet's form to `rationsService.updateRation`, against the line
   * the sheet was opened on. A failed parse leaves the sheet open with its
   * errors.
   */
  #onRationSubmit = async (event: CustomEvent<RationSubmitDetail>) => {
    const ration = this.rationToEdit;
    if (!ration) return;

    const result = await rationsService.updateRation(ration, event.detail.form);
    if (!result.ok) {
      this.rationEditErrors = result.errors;
      return;
    }

    this.rationSheetOpen = false;
  };

  #onRationDelete = (event: CustomEvent<RationRowDetail>) => {
    this.rationToDelete =
      this.#rations.value?.find((ration) => ration.id === event.detail.id) ??
      null;
  };

  #closeDeleteModal = () => {
    this.rationToDelete = null;
  };

  #confirmRationDelete = async () => {
    const ration = this.rationToDelete;
    this.rationToDelete = null;
    if (ration) await rationsRepo.remove(ration.id);
  };

  render() {
    return html`
      <section class="customize-view">
        <header class="customize-view__header">
          <button
            class="customize-view__back pressable pressable--small"
            type="button"
            aria-label="Retour"
            @click=${this.#goBack}
          >
            <app-icon icon="chevronLeft"></app-icon>
          </button>
          <h1 class="page-title">Personnaliser mon interface</h1>
        </header>
        <app-subnav
          label="Sections de personnalisation"
          .items=${this.#subnavItems()}
        ></app-subnav>
        <div class="customize-view__panel">${this.#renderTab()}</div>
      </section>
    `;
  }

  #subnavItems(): SubnavItem[] {
    return CUSTOMIZE_TABS.map((tab) => ({
      href: appHref(customizeTabPath(tab.id)),
      label: tab.label,
      current: tab.id === this.tab,
    }));
  }

  #renderTab() {
    switch (this.tab) {
      case "profil":
        return html`<customize-profile
          .profile=${displayProfile(this.#profile.value)}
          .errors=${this.profileErrors}
          status=${this.profileStatus}
          @profile-submit=${this.#onProfileSubmit}
        ></customize-profile>`;
      case "ration":
        return this.#renderRation();
      case "categories":
        return html`<customize-categories
          .categories=${this.#categories.value ?? []}
          @category-toggle=${this.#onCategoryToggle}
        ></customize-categories>`;
      case "cheval":
        return html`<customize-horse
          .horse=${this.#horse.value ?? null}
          .errors=${this.horseErrors}
          status=${this.horseStatus}
          @horse-submit=${this.#onHorseSubmit}
        ></customize-horse>`;
    }
  }

  #renderRation() {
    const rations = this.#rations.value ?? [];
    const toDelete = this.rationToDelete;

    return html`
      <customize-ration
        .rations=${rations}
        .today=${this.#today.value}
        .errors=${this.rationErrors}
        @ration-add=${this.#onRationAdd}
        @ration-edit=${this.#onRationEdit}
        @ration-delete=${this.#onRationDelete}
      ></customize-ration>
      <ration-sheet
        .open=${this.rationSheetOpen}
        .ration=${this.rationToEdit}
        .errors=${this.rationEditErrors}
        @ration-submit=${this.#onRationSubmit}
        @sheet-close=${this.#closeRationSheet}
      ></ration-sheet>
      <app-modal
        heading="Supprimer le produit ?"
        description=${toDelete ? `« ${toDelete.label} » sera retiré de la ration.` : ""}
        .open=${toDelete !== null}
        @modal-close=${this.#closeDeleteModal}
      >
        <div slot="footer" class="customize-view__confirm-actions">
          <button
            class="customize-view__button"
            type="button"
            @click=${this.#closeDeleteModal}
          >
            Annuler
          </button>
          <button
            class="customize-view__button customize-view__button--danger"
            type="button"
            @click=${this.#confirmRationDelete}
          >
            Supprimer
          </button>
        </div>
      </app-modal>
    `;
  }
}
