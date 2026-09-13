import { html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { appHref } from "../commons/base-path.ts";
import { LightElement } from "../commons/base-element.ts";
import { navigateTo } from "../commons/navigation.ts";
import {
  CUSTOMIZE_TABS,
  customizeTabPath,
  type CustomizeTab,
} from "../commons/sections.ts";
import { LiveQuery, profileRepo, readForm, text } from "../data/index.ts";
import { displayProfile } from "../data/account.ts";
import type { SubnavItem } from "../components/app-subnav/app-subnav.ts";
import {
  PROFILE_FIELDS,
  type ProfileFieldErrors,
  type ProfileSubmitDetail,
} from "../components/customize-profile/customize-profile.ts";

import "../components/app-icon/app-icon.ts";
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
  @property({ attribute: false }) tab: CustomizeTab = CUSTOMIZE_TABS[0].id;

  @state() private profileErrors: ProfileFieldErrors = {};
  @state() private profileStatus = "";

  #profile = new LiveQuery(this, () => profileRepo.get());

  #goBack = () => navigateTo(appHref(PROFILE));

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
          <h1 class="section-title" tabindex="-1">
            Personnaliser mon interface
          </h1>
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
        return html`<customize-ration></customize-ration>`;
      case "categories":
        return html`<customize-categories></customize-categories>`;
      case "cheval":
        return html`<customize-horse></customize-horse>`;
    }
  }
}
