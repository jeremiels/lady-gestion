import { css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";
import { appHref } from "../../commons/base-path.ts";
import { ageInYears, formatAge } from "../../data/dates.ts";
import { HORSE_SEX_LABEL } from "../../types/horse.types.ts";
import type { Horse } from "../../data/types.ts";

/**
 * WebP, not the original PNG: that was 393 KB of effectively uncompressed RGBA
 * for a 393×561 photo — 69% of the entire precache, downloaded by every
 * install of an app whose whole point is working offline. The `.png` is kept
 * in `src/assets/` as the source of truth but is no longer imported, so it
 * never reaches the bundle. Regenerate with:
 *   npm i -D sharp && node -e "require('sharp')('<png>').webp({quality:82}).toFile('<webp>')" && npm un sharp
 */
const horseImageUrl = new URL(
  "../../assets/lea-ladympala-trop-mignonnes.webp",
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
      border-radius: 0;
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
      font-size: 1rem;
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
    // chunks. The intrinsic 393x561 is the source WebP's own size — it
    // changes no layout here (the card's aspect-ratio and object-fit already
    // decide that) but it keeps the box reserved if this ever renders
    // somewhere that does not size it.
    const content = html`
      <img
        class="horse-card__image"
        src="${imageUrl}"
        alt="${horse.name}"
        width="393"
        height="561"
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
                href="${appHref(`/horse/${horse.id}`)}"
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
