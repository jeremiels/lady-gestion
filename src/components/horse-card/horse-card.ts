import { css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";
import { appHref } from "../../commons/base-path.ts";
import { horsePath } from "../../commons/sections.ts";
import { ageInYears, formatAge } from "../../data/dates.ts";
import { HORSE_SEX_LABEL } from "../../types/horse.types.ts";
import type { Horse } from "../../data/types.ts";

/**
 * Encoded from the `.png` beside it, which is the source of truth and is never
 * imported, so it never reaches the bundle. Every byte here is downloaded by
 * each install.
 *
 * AVIF at the source's full 1536×2304, deliberately not downscaled to the
 * largest box the card is drawn in (1200×686 device px): the browser already
 * resamples the photo to the card, and resampling it twice measurably changes
 * the rendered pixels. Quality 70 keeps the card, rendered at DPR 3, within
 * 42 dB PSNR of the PNG itself. Regenerate outside the repo, since `sharp` is
 * deliberately not a dependency:
 *   npm i --prefix /tmp/img sharp && node -e "require('/tmp/img/node_modules/sharp')('<png>').avif({quality:70,effort:6}).toFile('<avif>')"
 */
const horseImageUrl = new URL(
  "../../assets/lea-ladympala-trop-mignonnes.avif",
  import.meta.url,
).href;

/** `default` is the dashboard card; `horse-view` adds the extra breeding rows. */
export type HorseCardContext = "default" | "horse-view";

@customElement("horse-card")
export class HorseCard extends BaseElement {
  @property({ type: String, attribute: "context-type", reflect: true })
  contextType: HorseCardContext = "default";

  /**
   * Presentational only — the card never reaches for a repository itself, so
   * it stays reusable and its owning view decides which horse to show.
   */
  @property({ attribute: false }) horse: Horse | null = null;

  static componentStyles = css`
    .horse-card {
      display: block;
      position: relative;
      border-radius: var(--radius-12);
      overflow: hidden;
      text-decoration: none;
      color: var(--color-white);
      aspect-ratio: 1.75;
    }

    :host([context-type="horse-view"]) .horse-card {
      border-radius: var(--radius-12) 0 0 var(--radius-12);
    }

    .horse-card__image {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .horse-card__info {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      padding: var(--spacing-12);
      background: linear-gradient(
        180deg,
        rgba(0, 0, 0, 0) 0%,
        rgba(0, 0, 0, 0.5) 100%
      );
    }

    .horse-card__info-left {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }

    .horse-card__info-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: var(--spacing-4);
    }

    :host([context-type="horse-view"]) .horse-card__info {
      background: linear-gradient(
        180deg,
        rgba(0, 0, 0, 0) 0%,
        var(--color-page) 100%
      );
      padding-bottom: var(--spacing-24);
    }

    .horse-card__info-title {
      font-size: var(--font-size-base);
      line-height: 1.25rem;
      letter-spacing: -1%;
      font-weight: 700;
    }
    .horse-card__info-meta {
      display: flex;
      gap: var(--spacing-4);
    }

    .horse-card__text-small {
      font-size: 0.625rem;
      line-height: 0.688rem;
      font-weight: 500;
      color: var(--color-white);
    }
  `;

  render() {
    const horse = this.horse;
    if (!horse) return nothing;

    const detailed = this.contextType === "horse-view";
    // Falls back to the bundled photo until a cover image has been uploaded.
    const imageUrl = horseImageUrl;

    // fetchpriority="high" because this is the dashboard's LCP element: it is
    // discovered inside a shadow root by the renderer rather than by the
    // preload scanner, so without the hint it queues behind the route
    // chunks. The intrinsic 1536x2304 is the file's own size — it changes no
    // layout here (the card's aspect-ratio and object-fit already decide that)
    // but it keeps the box reserved if this ever renders somewhere that does
    // not size it.
    const content = html`
      <img
        class="horse-card__image"
        src="${imageUrl}"
        alt="${horse.name}"
        width="1536"
        height="2304"
        fetchpriority="high"
      />
      <div class="horse-card__info">
        <div class="horse-card__info-left">
          <h2 class="horse-card__info-title">${horse.name}</h2>
          <div class="horse-card__info-meta horse-card__text-small">
            <span class="horse-card__text-small"
              >${HORSE_SEX_LABEL[horse.sex]}</span
            >•
            <span class="horse-card__text-small"
              >${formatAge(ageInYears(horse.birthDate))}</span
            >
            ${horse.breed ? html`•<span class="horse-card__text-small">${horse.breed}</span>` : nothing}
          </div>
          ${
            detailed && horse.sireNumber
              ? html`
                  <div class="horse-card__text-small">
                    N° SIRE : ${horse.sireNumber}
                  </div>
                `
              : nothing
          }
        </div>
        ${
          detailed
            ? html`
                <div class="horse-card__info-right">
                  ${horse.coat ? html`<div class="horse-card__text-small">${horse.coat}</div>` : nothing}
                  ${horse.sireName ? html`<div class="horse-card__text-small">Père : ${horse.sireName}</div>` : nothing}
                  ${horse.damName ? html`<div class="horse-card__text-small">Mère : ${horse.damName}</div>` : nothing}
                </div>
              `
            : nothing
        }
      </div>
    `;

    // A plain `div` once already on the horse's own page — there's nowhere
    // left for the card to link to, and an `<a href>` back to itself is what
    // was re-triggering the identity/origin entrance animation on every tap.
    return html`
      <section>
        ${
          detailed
            ? html`<div class="horse-card">${content}</div>`
            : html`<a
                href="${appHref(horsePath(horse.id))}"
                class="horse-card pressable"
                >${content}</a
              >`
        }
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "horse-card": HorseCard;
  }
}
