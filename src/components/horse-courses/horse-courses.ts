import { css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { BaseElement } from "../../commons/base-element.ts";
import { findCategory, type ResolvedCategory } from "../../data/categories.ts";
import { todayISO, type IsoDate } from "../../data/dates.ts";
import { isCourseOngoing } from "../../data/posts.ts";
import type { Post } from "../../data/types.ts";

import "../course-card/course-card.ts";

/**
 * The horse page's Cures or Traitements tab: the courses still running, then
 * the ones that have ended under "Historique".
 *
 * Presentational — `HorseView` runs the query and hands down one category's
 * posts, newest first; this only splits them.
 */
@customElement("horse-courses")
export class HorseCourses extends BaseElement {
  @property({ attribute: false }) posts: Post[] = [];
  @property({ attribute: false }) categories: ResolvedCategory[] = [];

  /** The section heading's noun: "Cures" gives "Cures en cours". */
  @property({ type: String }) label = "";

  /** Shown when there is nothing at all to list. */
  @property({ type: String }) empty = "";

  /** Threaded through so the split and every card's day count agree. */
  @property({ type: String }) today: IsoDate = todayISO();

  static componentStyles = css`
    :host {
      display: grid;
      gap: var(--spacing-24);
    }

    .section {
      display: grid;
      gap: var(--spacing-16);
    }

    /* Restated rather than inherited: the section-title class lives in the
       document's components layer, which a shadow root does not see. Kept in
       step with styles/components/section.css by hand, as horse-ration does. */
    .title {
      margin: 0;
      font-family: var(--font-family-heading);
      font-size: 1.125rem;
      line-height: 1.25rem;
      font-weight: 700;
    }

    .list {
      display: grid;
      gap: var(--spacing-12);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .empty {
      margin: 0;
      font-size: 0.875rem;
      color: var(--color-brown-middle);
    }
  `;

  render() {
    if (this.posts.length === 0) {
      return html`<p class="empty">${this.empty}</p>`;
    }

    const ongoing = this.posts.filter((post) =>
      isCourseOngoing(post, this.today),
    );
    const ended = this.posts.filter(
      (post) => !isCourseOngoing(post, this.today),
    );

    return html`
      ${this.#renderSection(`${this.label} en cours`, ongoing)}
      ${this.#renderSection("Historique", ended)}
    `;
  }

  #renderSection(title: string, posts: Post[]) {
    if (posts.length === 0) return nothing;

    return html`
      <section class="section">
        <h2 class="title">${title}</h2>
        <ul class="list">
          ${repeat(
            posts,
            (post) => post.id,
            (post) => html`
              <li>
                <course-card
                  layout="history"
                  .post=${post}
                  .category=${
                    findCategory(this.categories, post.categoryKey) ?? null
                  }
                  .today=${this.today}
                ></course-card>
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
    "horse-courses": HorseCourses;
  }
}
