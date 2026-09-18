import { css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";
import { customizeFormStyles } from "../../commons/customize-form.styles.ts";
import { ageInYears, formatAge, todayISO } from "../../data/dates.ts";
import type { FieldError } from "../../data/forms.ts";
import {
  HORSE_FIELDS,
  HORSE_SEXES,
  HORSE_TEXT_MAX,
  type HorseField,
} from "../../data/services/horses.service.ts";
import type { Horse } from "../../data/types.ts";
import { HORSE_SEX_LABEL } from "../../types/horse.types.ts";

export type HorseSubmitDetail = { form: HTMLFormElement };

export type HorseFieldErrors = Partial<Record<HorseField, FieldError>>;

type TextField = Exclude<HorseField, "sex" | "birthDate">;

/**
 * The Cheval tab of Personnaliser mon interface: the horse page's record card
 * (identité, origine), with every value editable in place, and a save button.
 *
 * Same card and rows as the Profil tab (`customizeFormStyles`). Presentational
 * — the owning view hands the form to `horsesService.saveHorseProfile`.
 *
 * Âge is shown, never stored: the row displays the age and holds the birth
 * date underneath, so tapping it opens the platform date picker and the age
 * follows the pick before anything is saved.
 *
 * @fires horse-submit - `{ form: HTMLFormElement }`, after `preventDefault`.
 */
@customElement("customize-horse")
export class CustomizeHorse extends BaseElement {
  @property({ attribute: false }) horse: Horse | null = null;
  @property({ attribute: false }) errors: HorseFieldErrors = {};
  @property({ type: String }) status = "";

  /** The birth date as currently picked, so the age can follow it. */
  @state() private birthDate = "";

  static componentStyles = [
    customizeFormStyles,
    css`
      .item__select {
        appearance: none;
        text-align-last: end;
        cursor: pointer;
      }

      /* The age is what shows; the date input sits transparently on top of it,
         so the tap lands on the real control and its native picker. */
      .item__age {
        position: relative;
        display: grid;
        justify-items: end;
        min-width: 0;
      }

      .item__age .item__input {
        position: absolute;
        inset: 0;
        opacity: 0;
        cursor: pointer;
      }

      .item__age:has(.item__input:focus-visible) {
        outline: var(--focus-ring);
        outline-offset: 4px;
        border-radius: var(--radius-8);
      }
    `,
  ];

  protected willUpdate(changed: PropertyValues<this>) {
    // Re-seeded only when the record itself changes — a save, or the first
    // load — so an unsaved pick is not thrown away by an unrelated render.
    if (changed.has("horse")) this.birthDate = this.horse?.birthDate ?? "";
  }

  #onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    this.dispatchEvent(
      new CustomEvent<HorseSubmitDetail>("horse-submit", {
        detail: { form: event.currentTarget as HTMLFormElement },
        bubbles: true,
        composed: true,
      }),
    );
  };

  #onBirthDateInput = (event: Event) => {
    this.birthDate = (event.target as HTMLInputElement).value;
  };

  /**
   * Opens the picker on a click anywhere on the row's value. iOS does this by
   * itself for a date input; Chromium on desktop only focuses a date segment.
   */
  #openPicker = (event: Event) => {
    try {
      (event.currentTarget as HTMLInputElement).showPicker();
    } catch {
      // Already open, or not user-activated — the input still has focus.
    }
  };

  render() {
    const horse = this.horse;

    return html`
      <form novalidate @submit=${this.#onSubmit}>
        <section class="section">
          <h2 class="title">Identité</h2>
          <ul class="list">
            ${this.#renderSex(horse)} ${this.#renderAge()}
            ${this.#renderText("breed", "Race", horse)}
            ${this.#renderText("sireNumber", "N° Sire", horse, 20)}
          </ul>
        </section>
        <section class="section">
          <h2 class="title">Origine</h2>
          <ul class="list">
            ${this.#renderText("coat", "Robe", horse)}
            ${this.#renderText("damName", "Mère", horse)}
            ${this.#renderText("sireName", "Père", horse)}
          </ul>
        </section>
        <button class="submit pressable" type="submit">Enregistrer</button>
        ${
          this.status
            ? html`<p class="status" role="status">${this.status}</p>`
            : nothing
        }
      </form>
    `;
  }

  #renderSex(horse: Horse | null) {
    const id = "horse-sex";
    const error = this.errors.sex;
    return html`
      <li class="item">
        <label class="item__label" for=${id}>Sexe</label>
        <select
          class="item__input item__select"
          id=${id}
          name=${HORSE_FIELDS.sex}
          aria-invalid=${error ? "true" : "false"}
          aria-describedby=${error ? `${id}-error` : nothing}
        >
          ${HORSE_SEXES.map(
            (sex) => html`
              <option value=${sex} ?selected=${horse?.sex === sex}>
                ${HORSE_SEX_LABEL[sex]}
              </option>
            `,
          )}
        </select>
        ${this.#renderError(id, "sex")}
      </li>
    `;
  }

  #renderAge() {
    const id = "horse-birthDate";
    const error = this.errors.birthDate;
    return html`
      <li class="item">
        <label class="item__label" for=${id}
          >Âge<span class="visually-hidden"> — date de naissance</span></label
        >
        <span class="item__age">
          <span class="item__value" aria-hidden="true"
            >${formatAge(ageInYears(this.birthDate || null))}</span
          >
          <input
            class="item__input"
            id=${id}
            name=${HORSE_FIELDS.birthDate}
            type="date"
            max=${todayISO()}
            .value=${this.birthDate}
            aria-invalid=${error ? "true" : "false"}
            aria-describedby=${error ? `${id}-error` : nothing}
            @input=${this.#onBirthDateInput}
            @click=${this.#openPicker}
          />
        </span>
        ${this.#renderError(id, "birthDate")}
      </li>
    `;
  }

  #renderText(
    name: TextField,
    label: string,
    horse: Horse | null,
    maxLength = HORSE_TEXT_MAX,
  ) {
    const id = `horse-${name}`;
    const error = this.errors[name];
    return html`
      <li class="item">
        <label class="item__label" for=${id}>${label}</label>
        <input
          class="item__input"
          id=${id}
          name=${HORSE_FIELDS[name]}
          type="text"
          autocomplete="off"
          maxlength=${maxLength}
          placeholder="—"
          .value=${horse?.[name] ?? ""}
          aria-invalid=${error ? "true" : "false"}
          aria-describedby=${error ? `${id}-error` : nothing}
        />
        ${this.#renderError(id, name)}
      </li>
    `;
  }

  #renderError(id: string, name: HorseField) {
    const error = this.errors[name];
    return error
      ? html`<p class="item__error" id=${`${id}-error`}>${error}</p>`
      : nothing;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "customize-horse": CustomizeHorse;
  }
}
