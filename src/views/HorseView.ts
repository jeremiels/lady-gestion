import { html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { LightElement } from '../commons/base-element.ts';
import {
  DEFAULT_SEASON,
  LiveQuery,
  activeHorseQuery,
  ageInYears,
  bool,
  decimal,
  formatAge,
  formatSeasonRange,
  horsesRepo,
  isInSeason,
  rationsRepo,
  readForm,
  summariseSuspension,
  todayISO,
  type IsoDate,
} from '../data/index.ts';
import type { Horse, RationItem } from '../data/types.ts';
import {
  HORSE_SEX_LABEL,
  RATION_UNIT_LABEL,
  formatRationAmount,
} from '../types/horse.types.ts';

import '../components/horse-card/horse-card.ts';
import '../components/app-icon/app-icon.ts';
import '../components/app-bottom-sheet/app-bottom-sheet.ts';
import '../components/app-input/app-input.ts';
import '../components/app-checkbox/app-checkbox.ts';

@customElement('horse-view')
export class HorseView extends LightElement {
  @state() private rationSheetOpen = false;

  // Both re-run automatically whenever a table they read is written to, so
  // adding a ration below re-renders the list without any manual refresh.
  #horse = new LiveQuery(this, () => horsesRepo.getActive());
  #rations = activeHorseQuery<RationItem[]>(this, (horseId) => rationsRepo.listByHorse(horseId), []);

  #openRationSheet = () => {
    this.rationSheetOpen = true;
  };

  #closeRationSheet = () => {
    this.rationSheetOpen = false;
  };

  /**
   * Reads the sheet back against the same list that rendered it.
   *
   * The schema is built from `rations`, the field names are built from
   * `rations`, and the results are looked up by the same ids — so the form and
   * its reader cannot drift apart. The version before this hardcoded five
   * product names in the markup and read four different keys, and saving wrote
   * one unlabeled row and dropped the rest.
   */
  #onRationSubmit = async (event: SubmitEvent) => {
    event.preventDefault();

    const rations = this.#rations.value ?? [];
    const schema = Object.fromEntries(
      rations.flatMap((ration) => [
        [`quantity-${ration.id}`, decimal({ required: true, min: 0 })],
        [`seasonal-${ration.id}`, bool()],
      ]),
    );

    // Native constraint validation already blocked every normal path; this
    // catches the ones that skip it, where a NaN would be permanent.
    const result = readForm(event.target as HTMLFormElement, schema);
    if (!result.ok) return;

    const patches = rations.flatMap((ration) => {
      const quantity = result.value[`quantity-${ration.id}`] as number | null;
      if (quantity === null) return [];

      // Re-ticking "Saisonnier" restores the line's own window when it still has
      // one, so a stored Nov→Mar isn't quietly flattened to the default.
      const season = result.value[`seasonal-${ration.id}`]
        ? (ration.season ?? DEFAULT_SEASON)
        : null;

      // Untouched lines are skipped, not re-saved. `touch()` restamps
      // `updatedAt`, and `clearUntouchedSeedData` tells demo rows from real ones
      // by `createdAt === updatedAt` — writing all five here would make the
      // whole seed look hand-entered and survive the next restore.
      const unchanged =
        quantity === ration.quantity &&
        season?.from === ration.season?.from &&
        season?.to === ration.season?.to;

      return unchanged ? [] : [{ id: ration.id, patch: { quantity, season } }];
    });

    if (patches.length > 0) await rationsRepo.updateMany(patches);
    this.rationSheetOpen = false;
  };

  render() {
    const horse = this.#horse.value;
    // True through the whole first render pass, horse or no: the meta
    // sections need to exist in that very first paint (loading state, blank
    // fields) so the view transition captures them as their own named
    // elements, the same way `horse-card` is mounted unconditionally below.
    // Rendering them only once `horse` resolves would add them a tick after
    // the transition has already snapshotted the page, and they'd surface
    // with no entrance animation of their own — riding along on whatever the
    // rest of the page happens to be doing instead.
    const showMeta = horse != null || this.#horse.loading;

    return html`
      <section class="horse-view">
        <!--
          The visible title is the horse's name inside horse-card, which sits in
          a shadow root and so cannot serve as this page's heading. This gives
          the view a real h1 for the document outline and a focus target for the
          route change in app-root.
        -->
        <h1 class="visually-hidden" tabindex="-1">${horse?.name ?? 'Fiche du cheval'}</h1>
        <horse-card context-type="horse-view" class="horse-view__card" .horse=${horse ?? null}></horse-card>
        ${showMeta ? this.#renderIdentity(horse) : nothing}
        ${showMeta ? this.#renderOrigin(horse) : nothing}
        ${this.#renderRations()}
      </section>

      <app-bottom-sheet
        heading="Ration quotidienne"
        description="Modifier les produits et quantités"
        .open=${this.rationSheetOpen}
        @sheet-close=${this.#closeRationSheet}
      >
        <!--
          Keyed, and this is the one list where it is not just about render
          cost. These rows hold focusable app-inputs carrying whatever the user
          has typed; under a bare map() Lit binds parts positionally, so a
          write that reorders or removes a ration re-points every row at a
          different record and the in-progress edit — and the focus — lands on
          the wrong product.
        -->
        <form id="ration-form" class="ration-form" @submit=${this.#onRationSubmit}>
          ${repeat(
            this.#rations.value ?? [],
            (ration) => ration.id,
            (ration) => this.#renderRationField(ration),
          )}
        </form>
        <button slot="footer" class="horse-view__submit pressable" type="submit" form="ration-form">
          Enregistrer
        </button>
      </app-bottom-sheet>
    `;
  }

  #renderRationField(ration: RationItem) {
    // `role="group"` + `aria-labelledby` rather than fieldset/legend: it maps to
    // the same thing for a screen reader, and a <legend> is not laid out as a
    // normal child in every engine, so it can't be placed in the grid below.
    const nameId = `ration-name-${ration.id}`;

    return html`
      <div class="ration-field" role="group" aria-labelledby=${nameId}>
        <span class="ration-field__name" id=${nameId}>${ration.label}</span>
        <app-checkbox
          class="ration-field__seasonal"
          label="Saisonnier"
          name="seasonal-${ration.id}"
          ?checked=${ration.season !== null}
        ></app-checkbox>
        <!--
          A text input with inputmode=decimal, not type=number: a number input
          holds a locale-independent value, so a French user typing "1,5" hands
          back an empty string and their edit vanishes without a word. The
          pattern accepts either separator and the submit handler normalises it.
        -->
        <app-input
          class="ration-field__quantity"
          label="Quantité de ${ration.label}"
          hide-label
          name="quantity-${ration.id}"
          type="text"
          inputmode="decimal"
          pattern="[0-9]+([.,][0-9]+)?"
          suffix=${RATION_UNIT_LABEL[ration.unit]}
          .value=${formatRationAmount(ration.quantity)}
          required
        ></app-input>
      </div>
    `;
  }

  #renderIdentity(horse: Horse | undefined) {
    return html`
      <section class="horse-view__meta horse-view__meta--identity">
        <h2 class="section-title-small">Identité</h2>
        <div class="container">
          <ul class="meta-list">
            ${this.#renderMetaItem('Sexe', horse ? HORSE_SEX_LABEL[horse.sex] : null)}
            <!-- Derived, never stored: an age column is wrong within the year. -->
            ${this.#renderMetaItem('Âge', formatAge(ageInYears(horse?.birthDate ?? null)))}
            ${this.#renderMetaItem('Race', horse?.breed ?? null)}
            ${this.#renderMetaItem('N° Sire', horse?.sireNumber ?? null)}
          </ul>
        </div>
      </section>
    `;
  }

  #renderOrigin(horse: Horse | undefined) {
    return html`
      <section class="horse-view__meta horse-view__meta--origin">
        <h2 class="section-title-small">Origine</h2>
        <div class="container">
          <ul class="meta-list">
            ${this.#renderMetaItem('Robe', horse?.coat ?? null)}
            ${this.#renderMetaItem('Mère', horse?.damName ?? null)}
            ${this.#renderMetaItem('Père', horse?.sireName ?? null)}
          </ul>
        </div>
      </section>
    `;
  }

  #renderMetaItem(label: string, value: string | null) {
    return html`
      <li class="meta-item">
        <span class="meta-label">${label}</span>
        <span class="meta-value">${value || '—'}</span>
      </li>
    `;
  }

  #renderRations() {
    const rations = this.#rations.value ?? [];
    // Resolved once and threaded through: the rows and the footnote must agree
    // about what is suspended, and both default to "now" if left to themselves.
    const today = todayISO();
    const note = summariseSuspension(
      rations.map((ration) => ration.season),
      today,
    );

    return html`
      <section class="horse-view__section">
        <div class="horse-view__section-header">
          <h2 class="section-title">Ration quotidienne</h2>
          <button
            class="horse-view__edit-button pressable pressable--small"
            type="button"
            aria-label="Modifier la ration quotidienne"
            ?disabled=${rations.length === 0}
            @click=${this.#openRationSheet}
          >
            <app-icon icon="edit"></app-icon>
          </button>
        </div>
        ${rations.length === 0
          ? html`<p class="ration-empty">Aucune ration enregistrée pour le moment.</p>`
          : html`
              <ul class="ration-list container">
                ${repeat(
                  rations,
                  (ration) => ration.id,
                  (ration) => this.#renderRationItem(ration, today),
                )}
              </ul>
            `}
        ${note
          ? html`
              <p class="ration-note">
                <app-icon class="ration-note__icon" icon="info"></app-icon>
                <span>${note}</span>
              </p>
            `
          : nothing}
      </section>
    `;
  }

  #renderRationItem(ration: RationItem, today: IsoDate) {
    const suspended = !isInSeason(ration.season, today);

    return html`
      <li class="ration-item ${suspended ? 'ration-item--suspended' : ''}">
        <span class="ration-item__marker" aria-hidden="true"></span>
        <span class="ration-item__text">
          <span class="ration-item__label">
            <!-- The strike-through is the only visual cue, and it reaches no
                 screen reader — so the state is spelled out here instead. -->
            ${suspended ? html`<span class="visually-hidden">Suspendu — </span>` : nothing}
            ${ration.label}
          </span>
          ${ration.season
            ? html`<span class="ration-item__season">${formatSeasonRange(ration.season)}</span>`
            : nothing}
        </span>
        <span class="ration-item__quantity">
          <span class="ration-item__amount">${formatRationAmount(ration.quantity)}</span>
          <span class="ration-item__unit">${RATION_UNIT_LABEL[ration.unit]}</span>
        </span>
      </li>
    `;
  }
}
