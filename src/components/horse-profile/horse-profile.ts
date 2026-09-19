import { css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";
import { MediaQuery } from "../../commons/controllers/media-query.ts";
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

/**
 * Where the confirmation is in its cycle.
 *
 * `returning` and `snap` are the two halves of one move. The reel carries the
 * value twice — see the class comment on `.copy__reel` — so `returning` slides
 * on to the *upper* copy and `snap` puts the reel back on the lower one with no
 * transition. Both show the same text, which is what makes the reset invisible
 * and lets every step of the cycle travel downwards.
 */
type CopyState = "idle" | "copied" | "returning" | "snap";

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

  @state() private copyState: CopyState = "idle";

  /* Never `matchMedia(...).matches` read inside a method: that samples the
     answer once and never hears about it again. */
  #reducedMotion = new MediaQuery(this, "(prefers-reduced-motion: reduce)");

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

    .copy {
      display: flex;
      appearance: none;
      border: none;
      padding: 0;
      background: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }

    .copy:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }

    /*
     * The tinted surface, and the one element that changes colour.
     *
     * Separate from the button because the button wears \`.pressable\`, whose
     * \`transition: transform ...\` is a *shorthand* adopted after this
     * stylesheet — on the same element it would reset transition-property to
     * \`transform\` alone and the fill below would snap instead of fading.
     * Two elements, two transitions, nothing to out-rank.
     *
     * font-size and line-height are declared here rather than on the reel so
     * that \`1lh\` means the same number of pixels to every descendant: it
     * resolves against whichever element writes it, and the window and the
     * reel must agree on it exactly or the rows stop lining up with the
     * opening they slide through.
     */
    .copy__pill {
      display: inline-flex;
      padding: var(--spacing-6) var(--spacing-8);
      border-radius: var(--radius-8);
      font-size: var(--font-size-sm);
      line-height: 1.5;
      background-color: transparent;
      color: inherit;
      transition:
        background-color var(--duration-medium) var(--easing-out),
        color var(--duration-medium) var(--easing-out);
    }

    /* The pill is taller than bare text (one row plus its padding) and would
       stand this line above the three beside it. Both margins give that back:
       the block one so the row keeps the card's vertical rhythm, the inline one
       so the number stays flush right with Sexe/Âge/Race. The fill then bleeds
       into the row gap and the card's own padding, both empty. 0.938rem is
       \`.item__value\`'s line-height above — the height this row would have had
       without a pill. */
    .copy__pill {
      margin-block: calc((0.938rem - 1lh - 2 * var(--spacing-6)) / 2);
      margin-inline-end: calc(-1 * var(--spacing-8));
    }

    .copy[data-state="copied"] .copy__pill {
      background-color: var(--color-theme-mint);
      color: var(--color-white);
      /* The green is not synchronised by hand — it simply waits out the slide,
         so it arrives once "Copié !" has landed. The delay lives only on this
         state, which is also how it un-delays: dropping the state drops the
         delay, and the colour leaves as the reel sets off again. */
      transition-delay: var(--duration-slow);
    }

    /* Sized on the glyph, not on \`app-icon\`'s host — the host carries its own
       padding, so constraining it instead squeezes the SVG to a sliver. */
    .copy app-icon {
      --icon-size: 1rem;

      padding: 0;
    }

    /* One row tall, and the only thing that clips. \`clip\` rather than
       \`hidden\`: same cut, but it is not a scroll container, so nothing can
       ever scroll the reel off-position. */
    .copy__window {
      display: block;
      height: 1lh;
      overflow: clip;
    }

    /*
     * The reel: three rows, top to bottom [value, "Copié !", value].
     *
     * The window shows one of them, and every step moves the reel DOWN by one
     * row — so the text on screen leaves through the bottom and its successor
     * arrives from the top, which is the direction asked for. That only works
     * with the states running bottom-to-top: at rest the reel sits on the
     * lowest row, the confirmation is the middle one, and the row above it is
     * the value again, so the cycle can keep descending instead of rewinding.
     *
     * Driven by an attribute, not a custom property: an unregistered custom
     * property does not interpolate, so hanging \`translate\` off a \`--index\`
     * would jump rather than slide.
     */
    .copy__reel {
      display: block;
      translate: 0 calc(-2 * 1lh);
      /* The symmetric curve, not one of the two decelerates: both are already
         at full speed on their first frame, and over a single 21px row that
         start reads as a jolt rather than a reel picking up. This is also the
         token's own remit — content *moving* on screen rather than entering
         from nothing — and \`--duration-slow\` gives the travel enough time to
         be read as movement at all. */
      transition: translate var(--duration-slow) var(--easing-standard);
    }

    .copy[data-state="copied"] .copy__reel {
      translate: 0 calc(-1 * 1lh);
    }

    .copy[data-state="returning"] .copy__reel {
      translate: 0 0;
    }

    .copy[data-state="snap"] .copy__reel {
      transition: none;
    }

    /* Each row carries its own glyph, which is what makes the icon travel with
       the words it belongs to rather than cutting under them. The icon is
       1rem against a 1.3125rem line, so it never sets the row's height and the
       reel's unit stays the line. */
    .copy__row {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--spacing-6);
    }

    /* At (0,2,0) so the bottom row's own \`.item__value\` line-height cannot win
       whatever the declaration order. 1.5 rather than that 0.938rem because the
       reel's line-height *is* its unit — row, window and travel are all \`1lh\` —
       and a 1.072em line box would shave the accent off "Copié !" at this size.
       nowrap so the reel is as wide as its widest row from the first paint: the
       pill then keeps one width through the swap and nothing reflows. */
    .copy__reel .copy__text {
      font-size: var(--font-size-sm);
      font-weight: bold;
      line-height: 1.5;
      white-space: nowrap;
    }

    /* The slide is decoration; the word and the colour are the information.
       "Reduce" drops the first and keeps the second — so the swap becomes a
       cut, and with nothing left to wait for, the fill stops waiting. */
    @media (prefers-reduced-motion: reduce) {
      .copy__reel {
        transition: none;
      }

      .copy[data-state="copied"] .copy__pill {
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
      <!-- Rendered from the first paint and never removed: a live region has
           to be in the accessibility tree *before* its contents change or the
           change is not announced. Same reason app-update-toast keeps
           \`role="status"\` on a wrapper that always exists. -->
      <p class="visually-hidden" role="status">
        ${this.copyState === "copied" ? "Numéro SIRE copié." : ""}
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
   * `.item__value` carries the value and nothing else in both shapes. That is
   * the contract `HorseView.test.ts` reads the identity card through, and it is
   * why "Copié !" is the reel's sibling rather than its child.
   */
  #renderValue(item: MetaItem) {
    const plain = html`<span class="item__value">${item.value || "—"}</span>`;
    if (!item.copyable || !item.value) return plain;

    const value = item.value;
    return html`
      <button
        class="copy"
        type="button"
        data-state=${this.copyState}
        aria-label=${`Copier le numéro SIRE ${value}`}
        @click=${() => this.#copy(value)}
      >
        <span class="copy__pill">
          <span class="copy__window">
            <span class="copy__reel" @transitionend=${this.#onReelSettled}>
              <span class="copy__row" aria-hidden="true">
                <app-icon icon="copy"></app-icon>
                <span class="copy__text">${value}</span>
              </span>
              <!-- Announced through the live region in render(), not from
                   here: as button content a reader would say it twice. -->
              <span class="copy__row" aria-hidden="true">
                <app-icon icon="check"></app-icon>
                <span class="copy__text">Copié !</span>
              </span>
              <span class="copy__row">
                <app-icon icon="copy" aria-hidden="true"></app-icon>
                <span class="copy__text item__value">${value}</span>
              </span>
            </span>
          </span>
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

    // Awaited first, so the row never claims a copy that did not happen.
    clearTimeout(this.#holdTimer);
    this.copyState = "copied";
    this.#holdTimer = setTimeout(this.#release, HOLD_MS);
  };

  /**
   * A tap during the confirmation re-copies and extends the hold rather than
   * replaying the reel, which would mean flashing the number back in just to
   * slide it out again. `#copy` clears the timer before setting a new one, so
   * this needs nothing of its own.
   */
  #release = () => {
    // With no transition there will be no `transitionend`, so the two-step
    // return has nothing to drive it — and a cut is what "reduce" asked for.
    this.copyState = this.#reducedMotion.matches ? "idle" : "returning";
  };

  #onReelSettled = async (event: TransitionEvent) => {
    if (event.propertyName !== "translate") return;
    if (this.copyState !== "returning") return;

    // The reel has finished descending on to the upper copy of the value. It
    // reads the same as the lower one, so moving back to it is invisible — but
    // only if the frame that does it has the transition switched off.
    this.copyState = "snap";
    await this.updateComplete;
    requestAnimationFrame(() => {
      if (this.copyState === "snap") this.copyState = "idle";
    });
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "horse-profile": HorseProfile;
  }
}
