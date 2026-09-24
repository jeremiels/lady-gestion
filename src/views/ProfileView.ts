import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { LightElement } from "../commons/base-element.ts";
import { appHref } from "../commons/base-path.ts";
import { goBack } from "../commons/navigation.ts";
import { CUSTOMIZE_ROOT } from "../commons/sections.ts";
import { BackupActions } from "../commons/backup-actions.ts";
import { Today } from "../commons/controllers/today.ts";
import {
  LiveQuery,
  daysBetween,
  metaRepo,
  profileRepo,
  toIsoDate,
} from "../data/index.ts";
import { displayProfile } from "../data/account.ts";

import "../components/app-icon/app-icon.ts";
import "../components/app-switch/app-switch.ts";
import "../components/app-avatar/app-avatar.ts";

/** Only ever opened from the dashboard's avatar, so that's the only fallback back needs. */
const HOME = "/";

/** Display only — no password is stored anywhere in this app. */
const PASSWORD_MASK = "*".repeat(9);

/**
 * Until Google Drive backup lands, this screen is the only thing standing
 * between the user and losing everything to a cleared browser storage — so
 * it states plainly how stale the last backup is rather than hiding it.
 */
@customElement("profile-view")
export class ProfileView extends LightElement {
  #profile = new LiveQuery(this, () => profileRepo.get());
  #lastBackupAt = new LiveQuery(this, () => metaRepo.getLastBackupAt());
  #notifications = new LiveQuery(this, () =>
    metaRepo.getNotificationsEnabled(),
  );
  #today = new Today(this);
  #backup = new BackupActions(this);

  #goBack = () => goBack(HOME);

  // Written straight to `meta` rather than held in component state: a
  // preference that forgets itself on every navigation is a bug the user sees.
  #onNotificationsChange = (event: CustomEvent<{ checked: boolean }>) => {
    void metaRepo.setNotificationsEnabled(event.detail.checked);
  };

  render() {
    return html`
      <section class="profile-view">
        <header class="profile-view__header">
          <button
            class="profile-view__back pressable pressable--small"
            type="button"
            aria-label="Retour"
            @click=${this.#goBack}
          >
            <app-icon icon="chevronLeft"></app-icon>
          </button>
          <hgroup class="section-group">
            <h1 class="page-title" tabindex="-1">Profil</h1>
            <p class="section-subtitle">Mon compte utilisateur</p>
          </hgroup>
        </header>

        ${this.#renderIdentity()} ${this.#renderPersonalInfo()}
        ${this.#renderPreferences()} ${this.#renderAccount()}
        ${this.#renderBackup()}
      </section>
    `;
  }

  #renderIdentity() {
    const account = displayProfile(this.#profile.value);
    return html`
      <div class="profile-view__identity">
        <!-- Decorative: the name it initialises is spelled out right next to it. -->
        <app-avatar
          aria-hidden="true"
          initial=${account.firstName.charAt(0)}
        ></app-avatar>
        <div>
          <p class="profile-view__name">${account.firstName}</p>
          <p class="profile-view__email">${account.email}</p>
        </div>
      </div>
    `;
  }

  #renderPersonalInfo() {
    const account = displayProfile(this.#profile.value);
    return html`
      <section class="profile-view__section">
        <h2 class="section-title-small">Informations personnelles</h2>
        <div class="container">
          <ul class="meta-list">
            ${this.#renderMetaItem("Prénom", account.firstName)}
            ${this.#renderMetaItem("Nom", account.lastName)}
            ${this.#renderMetaItem("Email", account.email)}
            ${this.#renderMetaItem("Mot de passe", PASSWORD_MASK)}
          </ul>
        </div>
      </section>
    `;
  }

  #renderMetaItem(label: string, value: string) {
    return html`
      <li class="meta-item">
        <span class="meta-label">${label}</span>
        <span class="meta-value">${value}</span>
      </li>
    `;
  }

  #renderPreferences() {
    return html`
      <section class="profile-view__section">
        <h2 class="section-title-small">Préférences</h2>
        <div class="container">
          <app-switch
            label="Notifications"
            .checked=${this.#notifications.value ?? true}
            @switch-change=${this.#onNotificationsChange}
          ></app-switch>
        </div>
      </section>
    `;
  }

  #renderAccount() {
    // "Se déconnecter" and "Supprimer mon compte" are inert: there is no
    // session to end and no account to delete while the app is device-local. Wiring "Supprimer mon compte" to
    // wipe IndexedDB needs a confirmation step first — it is unrecoverable.
    return html`
      <section class="profile-view__section">
        <h2 class="section-title-small">Compte</h2>
        <div class="container">
          <ul class="meta-list">
            <li class="meta-item">
              <a
                class="profile-view__action pressable"
                href=${appHref(CUSTOMIZE_ROOT)}
              >
                <app-icon icon="slidersHorizontal"></app-icon>
                <span class="meta-label-large"
                  >Personnaliser mon interface</span
                >
              </a>
            </li>
            <li class="meta-item">
              <button class="profile-view__action pressable" type="button">
                <app-icon icon="signOut"></app-icon>
                <span class="meta-label-large">Se déconnecter</span>
              </button>
            </li>
            <li class="meta-item">
              <button class="profile-view__action pressable" type="button">
                <app-icon icon="trash"></app-icon>
                <span class="meta-label-large">Supprimer mon compte</span>
              </button>
            </li>
          </ul>
        </div>
      </section>
    `;
  }

  #renderBackup() {
    return html`
      <section class="profile-view__section">
        <h2 class="section-title-small">Sauvegarde</h2>
        <div class="container profile-view__backup">
          <p class="profile-view__hint">${this.#renderBackupAge()}</p>
          <div class="profile-view__actions">
            <button
              class="profile-view__button pressable"
              type="button"
              @click=${this.#backup.export}
            >
              Exporter les données
            </button>
            <button
              class="profile-view__button profile-view__button--ghost pressable"
              type="button"
              @click=${this.#backup.restore}
            >
              Restaurer un fichier
            </button>
          </div>
          <p class="profile-view__note">
            Les fichiers (ordonnances, factures scannées) ne sont pas encore
            inclus dans l’export — seules leurs fiches le sont.
          </p>
          ${this.#backup.renderMessage({
            region: "profile-view__message-region",
            status: "profile-view__status",
            error: "profile-view__error",
          })}
        </div>
      </section>
    `;
  }

  #renderBackupAge() {
    // `undefined` both when there has never been a backup and for the tick
    // before the first emission. Both read as "no backup yet".
    const last = this.#lastBackupAt.value;
    if (!last) return "Aucune sauvegarde effectuée pour l’instant.";

    // Calendar days in local time, not elapsed 24-hour spans: a backup at
    // 23:00 is "hier" at 08:00 the next morning.
    const days = daysBetween(toIsoDate(new Date(last)), this.#today.value);
    if (days <= 0) return "Dernière sauvegarde : aujourd’hui.";
    if (days === 1) return "Dernière sauvegarde : hier.";
    return `Dernière sauvegarde : il y a ${days} jours.`;
  }
}
