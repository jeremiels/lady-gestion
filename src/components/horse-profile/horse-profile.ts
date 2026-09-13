import { css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";
import { ageInYears, formatAge } from "../../data/dates.ts";
import type { Horse } from "../../data/types.ts";
import { HORSE_SEX_LABEL } from "../../types/horse.types.ts";

type MetaItem = { label: string; value: string | null };

/**
 * The horse's record card: identity (sex, age, breed, SIRE number) and origin
 * (coat, dam, sire), "—" wherever a value is unknown.
 *
 * Presentational — the owning view runs the query. `null` renders the same
 * blank card as a horse with nothing filled in, which is also the loading
 * state: the sections exist from the first paint instead of popping in.
 */
@customElement("horse-profile")
export class HorseProfile extends BaseElement {
  @property({ attribute: false }) horse: Horse | null = null;

  /* The title and meta-list rules are restated rather than inherited: they live
     in the document's components layer (section.css, meta-list.css), which a
     shadow root does not see. Kept in step by hand, as week-strip does. */
  static componentStyles = css`
    :host {
      display: grid;
      gap: 1.5rem;
    }

    .section {
      display: grid;
      gap: 0.5rem;
    }

    .title {
      margin: 0;
      font-size: 0.75rem;
      line-height: 0.875rem;
      font-weight: bold;
      color: var(--color-brown-middle);
    }

    .list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      list-style: none;
      margin: 0;
      padding: var(--spacing-12);
      border-radius: var(--radius-12);
      background-color: var(--color-white);
    }

    .item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
    }

    .item:not(:last-child) {
      border-bottom: 1px solid var(--color-divider);
      padding-bottom: 1rem;
    }

    .item__label {
      font-weight: bold;
      font-size: 0.75rem;
      line-height: 1rem;
      color: var(--color-brown-middle);
    }

    .item__value {
      font-weight: bold;
      font-size: 0.875rem;
      line-height: 0.938rem;
    }
  `;

  render() {
    const horse = this.horse;

    return html`
      ${this.#renderSection("Identité", [
        { label: "Sexe", value: horse ? HORSE_SEX_LABEL[horse.sex] : null },
        // Derived, never stored: an age column is wrong within the year.
        {
          label: "Âge",
          value: formatAge(ageInYears(horse?.birthDate ?? null)),
        },
        { label: "Race", value: horse?.breed ?? null },
        { label: "N° Sire", value: horse?.sireNumber ?? null },
      ])}
      ${this.#renderSection("Origine", [
        { label: "Robe", value: horse?.coat ?? null },
        { label: "Mère", value: horse?.damName ?? null },
        { label: "Père", value: horse?.sireName ?? null },
      ])}
    `;
  }

  #renderSection(title: string, items: MetaItem[]) {
    return html`
      <section class="section">
        <h2 class="title">${title}</h2>
        <ul class="list">
          ${items.map(
            (item) => html`
              <li class="item">
                <span class="item__label">${item.label}</span>
                <span class="item__value">${item.value || "—"}</span>
              </li>
            `,
          )}
        </ul>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "horse-profile": HorseProfile;
  }
}
