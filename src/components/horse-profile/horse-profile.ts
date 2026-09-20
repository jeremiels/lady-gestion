import { css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";
import { ageInYears, formatAge } from "../../data/dates.ts";
import type { Horse } from "../../data/types.ts";
import { HORSE_SEX_LABEL } from "../../types/horse.types.ts";

import "../app-icon/app-icon.ts";

type MetaItem = {
  label: string;
  value: string | null;
  /**
   * Renders the value as a tap-to-copy control. There is no separate "text to
   * copy" field on purpose: what lands on the clipboard is what is on screen,
   * and a second string would be a second source of truth free to drift.
   */
  copyable?: boolean;
};

/** How long the confirmation holds, counted from the tap. */
const HOLD_MS = 3000;

/**
 * The horse's record card: identity (sex, age, breed, SIRE number) and origin
 * (coat, dam, sire), "—" wherever a value is unknown. The SIRE number is
 * tap-to-copy; it is the one value here that gets retyped elsewhere.
 *
 * Presentational — the owning view runs the query. `null` renders the same
 * blank card as a horse with nothing filled in, which is also the loading
 * state: the sections exist from the first paint instead of popping in.
 */
@customElement("horse-profile")
export class HorseProfile extends BaseElement {
  @property({ attribute: false }) horse: Horse | null = null;

  @state() private copied = false;

  #holdTimer: ReturnType<typeof setTimeout> | undefined;

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
      font-size: var(--font-size-xs);
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
      font-size: var(--font-size-xs);
      line-height: 1rem;
      color: var(--color-brown-middle);
    }

    .item__value {
      font-weight: bold;
      font-size: var(--font-size-sm);
      line-height: 0.938rem;
    }

    /*
     * The copy control: one grid cell with the value and the confirmation
     * stacked in it, and the button itself as both the clip and the tinted
     * surface.
     *
     * \`overflow\` clips at the *padding* box, not the content box, so a layer
     * pushed exactly its own height would still show through the padding. The
     * travel therefore carries the padding with it, which is all
     * \`--copy-travel\` says.
     */
    .copy {
      /* The layer's line box, named because three things depend on it: the
         layer height, the travel, and the negative margin below. A length, not
         the unitless 1.5, so it is stated once and inherits as-is. */
      --copy-line: 1.3125rem;

      display: grid;
      /* Each layer sized to its own content and parked on the right edge,
         rather than stretched across the track. The track is still as wide as
         the wider of the two — but the button carries no fill of its own, so
         what is seen is the layer's pill, hugging its own text and glyph. */
      justify-items: end;
      overflow: clip;
      appearance: none;
      border: none;
      padding: 0;
      /* The layer's padding given straight back, so the pill grows into the
         row gap and the card's own padding — both empty — rather than making
         this line taller than the three above it or pushing the number out of
         alignment with them. 1rem is \`.item__label\`'s line box above: the
         label is the tallest thing in every other row, so matching it is what
         keeps the rhythm. */
      margin-block: calc((1rem - var(--copy-line)) / 2 - var(--spacing-6));
      margin-inline-end: calc(-1 * var(--spacing-8));
      background: none;
      color: inherit;
      font: inherit;
      font-size: var(--font-size-sm);
      font-weight: bold;
      line-height: var(--copy-line);
      cursor: pointer;
    }

    .copy:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }

    /* The pill itself — each layer carries its own, so the fill is exactly as
       wide as the glyph and words inside it. Both share the one cell, so they
       are the same height and \`100%\` is the same distance to each; the
       line-height is restated at (0,2,0) so the \`.item__value\` layer cannot
       bring its own and make the two disagree. */
    .copy__layer {
      grid-area: 1 / 1;
      display: flex;
      align-items: center;
      gap: var(--spacing-6);
      padding: var(--spacing-6) var(--spacing-8);
      border-radius: var(--radius-8);
      line-height: var(--copy-line);
      white-space: nowrap;
      background-color: transparent;
      color: inherit;
      /* The symmetric curve for the travel, not one of the two decelerates:
         both are already at full speed on their first frame, and over a single
         row that start reads as a jolt rather than a slide. */
      transition:
        translate var(--duration-slow) var(--easing-standard),
        background-color var(--duration-medium) var(--easing-out),
        color var(--duration-medium) var(--easing-out);
    }

    /* Waits one full height above the opening — the button clips at its border
       box, which is one layer tall — and comes down to take the value's place.
       Dropping the attribute runs the same transition backwards, which is the
       whole of the return. */
    .copy__layer--done {
      translate: 0 -100%;
    }

    .copy[data-copied] .copy__layer--done {
      translate: 0 0;
      background-color: var(--color-theme-green-background);
      color: var(--color-theme-green);
      /* Per property, in the order declared above: the slide starts at once,
         the fill waits it out so the colour arrives once "Copié !" has landed.
         The delay lives only on this state, which is also how it un-delays —
         dropping the attribute drops it, and the colour leaves as the layers
         set off back. */
      transition-delay: 0s, var(--duration-slow), var(--duration-slow);
    }

    .copy[data-copied] .item__value {
      translate: 0 100%;
    }

    /* Sized on the glyph, not on \`app-icon\`'s host — the host carries its own
       padding, so constraining it instead squeezes the SVG to a sliver. */
    .copy app-icon {
      --icon-size: 1rem;

      padding: 0;
    }

    /* The slide is decoration; the word and the colour are the information.
       "Reduce" drops the first and keeps the second, and with nothing left to
       wait for the fill stops waiting. */
    @media (prefers-reduced-motion: reduce) {
      .copy__layer {
        transition: none;
      }

      .copy[data-copied] .copy__layer--done {
        transition-delay: 0s;
      }
    }
  `;

  disconnectedCallback() {
    clearTimeout(this.#holdTimer);
    super.disconnectedCallback();
  }

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
        { label: "N° Sire", value: horse?.sireNumber ?? null, copyable: true },
      ])}
      ${this.#renderSection("Origine", [
        { label: "Robe", value: horse?.coat ?? null },
        { label: "Mère", value: horse?.damName ?? null },
        { label: "Père", value: horse?.sireName ?? null },
      ])}
      <!-- Rendered from the first paint and never removed: a live region has to
           be in the accessibility tree *before* its contents change or the
           change is not announced. Same reason app-update-toast keeps
           \`role="status"\` on a wrapper that always exists. -->
      <p class="visually-hidden" role="status">
        ${this.copied ? "Numéro SIRE copié." : ""}
      </p>
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
                ${this.#renderValue(item)}
              </li>
            `,
          )}
        </ul>
      </section>
    `;
  }

  /**
   * A copyable row wraps the value in a button; every other row — and a
   * copyable row with nothing to copy — stays the bare span.
   *
   * `.item__value` carries the value and nothing else in both shapes, which is
   * the contract `HorseView.test.ts` reads the identity card through.
   */
  #renderValue(item: MetaItem) {
    const plain = html`<span class="item__value">${item.value || "—"}</span>`;
    if (!item.copyable || !item.value) return plain;

    const value = item.value;
    return html`
      <button
        class="copy"
        type="button"
        ?data-copied=${this.copied}
        aria-label=${`Copier le numéro SIRE ${value}`}
        @click=${() => this.#copy(value)}
      >
        <span class="copy__layer item__value">
          <app-icon icon="copy" aria-hidden="true"></app-icon>${value}
        </span>
        <!-- Announced through the live region in render(), not from here: as
             button content a reader would say it twice. -->
        <span class="copy__layer copy__layer--done" aria-hidden="true">
          <app-icon icon="check"></app-icon>Copié !
        </span>
      </button>
    `;
  }

  #copy = async (value: string) => {
    try {
      // No `"clipboard" in navigator` guard: the browser floor gives it
      // everywhere this app runs, so the check would be dead code. The
      // rejection is the real case — a denied permission, or a document that
      // lost focus between the tap and the write.
      await navigator.clipboard.writeText(value);
    } catch {
      // Nothing reached the clipboard, so nothing is confirmed.
      return;
    }

    // Awaited first, so the row never claims a copy that did not happen. A tap
    // during the hold re-copies and extends it: the attribute is already set,
    // so nothing replays, which is the least surprising thing a second tap can
    // do.
    clearTimeout(this.#holdTimer);
    this.copied = true;
    this.#holdTimer = setTimeout(() => (this.copied = false), HOLD_MS);
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "horse-profile": HorseProfile;
  }
}
