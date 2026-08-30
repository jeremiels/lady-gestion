import { html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { LightElement } from '../commons/base-element.ts';
import { LiveQuery, downloadBackup, metaRepo, readBackupFile } from '../data/index.ts';
import { ACCOUNT } from '../data/account.ts';

import '../components/app-icon/app-icon.ts';
import '../components/app-switch/app-switch.ts';
import '../components/app-avatar/app-avatar.ts';

/** Display only — no password is stored anywhere in this app. */
const PASSWORD_MASK = '*'.repeat(9);

/**
 * Until Google Drive backup lands, this screen is the only thing standing
 * between the user and losing everything to a cleared browser storage — so
 * it states plainly how stale the last backup is rather than hiding it.
 */
@customElement('profile-view')
export class ProfileView extends LightElement {
  @state() private status = '';
  @state() private error = '';

  @query('#backup-file') private fileInput?: HTMLInputElement;

  #daysSinceBackup = new LiveQuery(this, () => metaRepo.daysSinceBackup());
  #notifications = new LiveQuery(this, () => metaRepo.getNotificationsEnabled());


  // Written straight to `meta` rather than held in component state: a
  // preference that forgets itself on every navigation is a bug the user sees.
  #onNotificationsChange = (event: CustomEvent<{ checked: boolean }>) => {
    void metaRepo.setNotificationsEnabled(event.detail.checked);
  };

  #onExport = async () => {
    this.error = '';
    try {
      await downloadBackup();
      this.status = 'Sauvegarde téléchargée.';
    } catch (error: unknown) {
      this.error = error instanceof Error ? error.message : 'Export impossible.';
    }
  };

  #onImportClick = () => this.fileInput?.click();

  #onImportFile = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.status = '';
    this.error = '';

    try {
      const { imported, skipped } = await readBackupFile(file);
      this.status = `${imported} enregistrement(s) restauré(s), ${skipped} ignoré(s) car déjà à jour.`;
    } catch (error: unknown) {
      this.error = error instanceof Error ? error.message : 'Import impossible.';
    } finally {
      // Lets the same file be picked again after a failure.
      input.value = '';
    }
  };

  render() {
    return html`
      <section class="profile-view">
        <hgroup class="section-group">
          <h1 class="section-title" tabindex="-1">Profil</h1>
          <p class="section-subtitle">Mon compte utilisateur</p>
        </hgroup>

        ${this.#renderIdentity()} ${this.#renderPersonalInfo()} ${this.#renderPreferences()}
        ${this.#renderAccount()} ${this.#renderBackup()}
      </section>
    `;
  }

  #renderIdentity() {
    return html`
      <div class="profile-view__identity">
        <!-- Decorative: the name it initialises is spelled out right next to it. -->
        <app-avatar aria-hidden="true" initial=${ACCOUNT.firstName.charAt(0)}></app-avatar>
        <div>
          <p class="profile-view__name">${ACCOUNT.firstName}</p>
          <p class="profile-view__email">${ACCOUNT.email}</p>
        </div>
      </div>
    `;
  }

  #renderPersonalInfo() {
    return html`
      <section class="profile-view__section">
        <h2 class="section-title-small">Informations personnelles</h2>
        <div class="container">
          <ul class="meta-list">
            ${this.#renderMetaItem('Prénom', ACCOUNT.firstName)}
            ${this.#renderMetaItem('Nom', ACCOUNT.lastName)}
            ${this.#renderMetaItem('Email', ACCOUNT.email)}
            ${this.#renderMetaItem('Mot de passe', PASSWORD_MASK)}
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
    // Both actions are inert: there is no session to end and no account to
    // delete while the app is device-local. Wiring "Supprimer mon compte" to
    // wipe IndexedDB needs a confirmation step first — it is unrecoverable.
    return html`
      <section class="profile-view__section">
        <h2 class="section-title-small">Compte</h2>
        <div class="container">
          <ul class="meta-list">
            <li class="meta-item">
              <button class="profile-view__action pressable" type="button">
                <span>Se déconnecter</span>
                <app-icon icon="signOut"></app-icon>
              </button>
            </li>
            <li class="meta-item">
              <button class="profile-view__action pressable" type="button">
                <span>Supprimer mon compte</span>
                <app-icon icon="trash"></app-icon>
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
            <button class="profile-view__button pressable" type="button" @click=${this.#onExport}>
              Exporter les données
            </button>
            <button class="profile-view__button profile-view__button--ghost pressable" type="button" @click=${this.#onImportClick}>
              Restaurer un fichier
            </button>
          </div>
          <input id="backup-file" type="file" accept="application/json,.json" hidden @change=${this.#onImportFile} />
          <p class="profile-view__note">
            Les fichiers (ordonnances, factures scannées) ne sont pas encore inclus dans l’export —
            seules leurs fiches le sont.
          </p>
          ${this.status ? html`<p class="profile-view__status">${this.status}</p>` : nothing}
          ${this.error ? html`<p class="profile-view__error">${this.error}</p>` : nothing}
        </div>
      </section>
    `;
  }

  #renderBackupAge() {
    // `Infinity` when there has never been a backup; `undefined` for the tick
    // before the first emission. Both read as "no backup yet".
    const days = this.#daysSinceBackup.value;
    if (days === undefined || !Number.isFinite(days)) {
      return 'Aucune sauvegarde effectuée pour l’instant.';
    }

    if (days <= 0) return 'Dernière sauvegarde : aujourd’hui.';
    if (days === 1) return 'Dernière sauvegarde : hier.';
    return `Dernière sauvegarde : il y a ${days} jours.`;
  }
}
