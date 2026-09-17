import { css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { BaseElement } from "../../commons/base-element.ts";
import { appHref } from "../../commons/base-path.ts";
import { formatDate, todayISO, type IsoDate } from "../../data/dates.ts";
import {
  activeDays,
  courseEndDate,
  formatDosePerDay,
  isCourseOngoing,
} from "../../data/posts.ts";
import type { ResolvedCategory } from "../../data/categories.ts";
import type { Post } from "../../data/types.ts";
import { THEME_META } from "../../theme/theme.ts";

/**
 * How the card says when the course runs.
 *
 * - `history` — the dates themselves: "01/01/2026 à aujourd'hui" while it has
 *   no end date, "01/01/2026 au 12/01/2026" once it has one. The horse page's
 *   Cures and Traitements tabs, where the list is the record.
 * - `compact` — only whether it is running. The dashboard, a glance at what
 *   is being given right now.
 */
export type CourseCardLayout = "history" | "compact";

/**
 * One cure or traitement: a bar in its category's colour, the name, when it
 * runs and the daily dose, and how many days it has been active.
 *
 * Presentational — the owning view holds the queries and passes the post and
 * its resolved category down, the same split as `post-card`.
 */
@customElement("course-card")
export class CourseCard extends BaseElement {
  @property({ attribute: false }) post: Post | null = null;

  /** `null` for the tick before the catalogue query settles. */
  @property({ attribute: false }) category: ResolvedCategory | null = null;

  /**
   * Resolved once by the caller: every card in a list, and the list's own
   * split into running and ended, must agree about what today is.
   */
  @property({ type: String }) today: IsoDate = todayISO();

  /** Reflected so the styles below can key off it. */
  @property({ type: String, reflect: true }) layout: CourseCardLayout =
    "history";

  static componentStyles = css`
    :host {
      display: block;
    }

    /* The whole card is the target, as in post-card. */
    .course-card__link {
      display: block;
      color: inherit;
      text-decoration: none;
      border-radius: var(--radius-12);
    }

    .course-card__link:focus-visible {
      outline: 2px solid var(--color-brown-dark);
      outline-offset: 2px;
    }

    .course-card {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: stretch;
      column-gap: var(--spacing-8);
      padding: var(--spacing-12) var(--spacing-16);
      border-radius: var(--radius-12);
      background-color: var(--color-white);
    }

    /* Stretched to the text beside it rather than given a height, so it stays
       as tall as the two lines whatever the font size. Neutral until the
       category resolves. */
    .course-card__bar {
      width: 0.375rem;
      border-radius: var(--radius-pill);
      background: var(--color-brown-light);
    }

    .course-card__text {
      display: grid;
      align-content: center;
      gap: var(--spacing-2);
      min-width: 0;
    }

    .course-card__title {
      margin: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.875rem;
      line-height: 1.25rem;
      font-weight: 600;
      color: var(--color-dark);
    }

    .course-card__meta {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      margin: 0;
      font-size: 0.625rem;
      line-height: 0.875rem;
      color: var(--color-text-muted);
    }

    .course-card__meta span {
      white-space: nowrap;
    }

    .course-card__meta span + span::before {
      content: "•";
      margin: 0 var(--spacing-4);
    }

    .course-card__days {
      display: grid;
      margin: 0;
      align-content: center;
      justify-items: end;
      text-align: end;
    }

    .course-card__count {
      font-family: var(--font-family-heading);
      font-size: 1.125rem;
      line-height: 1.125rem;
      font-weight: 800;
      color: var(--color-dark);
    }

    .course-card__unit {
      font-size: 0.625rem;
      line-height: 0.845rem;
      white-space: nowrap;
      color: var(--color-text-muted);
    }
  `;

  render() {
    const post = this.post;
    if (!post) return nothing;

    const theme = this.category ? THEME_META[this.category.theme] : null;
    const dose = formatDosePerDay(post.customFields.dosage);
    const days = activeDays(post, this.today);

    return html`
      <a
        class="course-card__link pressable"
        href="${appHref(`/posts/${post.id}`)}"
      >
        <article class="course-card">
          <span
            class="course-card__bar"
            aria-hidden="true"
            style=${styleMap(theme ? { background: theme.color } : {})}
          ></span>
          <div class="course-card__text">
            <h3 class="course-card__title">${post.title}</h3>
            <p class="course-card__meta">
              <span>${this.#when(post)}</span>
              ${dose ? html`<span>${dose}</span>` : nothing}
            </p>
          </div>
          <p class="course-card__days">
            <span class="course-card__count">${days}</span>
            <span class="course-card__unit"
              >${days > 1 ? "jours actifs" : "jour actif"}</span
            >
          </p>
        </article>
      </a>
    `;
  }

  #when(post: Post): string {
    const ongoing = isCourseOngoing(post, this.today);
    if (this.layout === "compact") return ongoing ? "En cours" : "Terminé";

    // "à aujourd'hui" only for a course with no end yet: one whose end date is
    // still ahead says when it stops, the same day its calendar bar does.
    const end = courseEndDate(post);
    return end === null
      ? `${formatDate(post.date)} à aujourd'hui`
      : `${formatDate(post.date)} au ${formatDate(end)}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "course-card": CourseCard;
  }
}
