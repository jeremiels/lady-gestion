import { css, html, nothing } from "lit";
import { customElement, property, queryAll, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { BaseElement } from "../../commons/base-element.ts";
import { DragReorder } from "../../commons/controllers/drag-reorder.ts";
import { LINKS, kindLabel, linkableRole } from "../../data/category-editor.ts";
import { formatCents } from "../../data/money.ts";
import type { CustomFieldDef } from "../../data/types.ts";

import "../app-icon/app-icon.ts";

export type FieldOpenDetail = { id: string };
export type FieldsReorderDetail = { from: number; to: number };

/**
 * What a row says under the field's name: its kind — unless the name already
 * says it, as Nom or Note do — and what is set on it.
 */
const summaryOf = (field: CustomFieldDef): string => {
  const kind = kindLabel(field);
  const parts = kind === field.label ? [] : [kind];
  if (field.required) parts.push("Obligatoire");
  const link = linkableRole(field);
  if (link !== undefined && field.role === link) parts.push(LINKS[link].tag);
  const value = field.defaultValue;
  if (value === true) parts.push("Coché par défaut");
  else if (typeof value === "number" && field.control === "money") {
    parts.push(`Défaut : ${formatCents(value, "EUR")}`);
  } else if (value !== undefined && value !== false) {
    const label =
      field.options?.find((option) => option.value === value)?.label ?? value;
    parts.push(`Défaut : ${String(label)}`);
  }
  return parts.join(" · ");
};

/**
 * The form builder's list of a category's fields, in form order: a handle to
 * drag a field elsewhere, and the field itself — its name and a one-line
 * summary — to tap and edit.
 *
 * Presentational: the owner holds the fields and applies a move.
 *
 * @fires field-open - `{ id }`, a row was tapped.
 * @fires fields-reorder - `{ from, to }`, a field was dragged, or moved with
 * ↑/↓ on its handle.
 */
@customElement("category-fields")
export class CategoryFields extends BaseElement {
  @property({ attribute: false }) fields: readonly CustomFieldDef[] = [];
  /** Keyed `field:<id>`, as `validateCategory` reports them. */
  @property({ attribute: false }) errors: Record<string, string> = {};

  /** What the last keyboard move did, for the live region. */
  @state() private announcement = "";

  @queryAll(".row") private rowEls!: NodeListOf<HTMLElement>;

  #drag = new DragReorder(this, {
    rows: () => [...this.rowEls],
    onMove: (from, to) => this.#reorder(from, to),
  });

  static componentStyles = css`
    :host {
      display: block;
    }

    .list {
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: var(--spacing-4) var(--spacing-12);
      list-style: none;
      border-radius: var(--radius-12);
      background-color: var(--color-white);
    }

    .row {
      position: relative;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      background-color: var(--color-white);
    }

    .row:not(:last-child) {
      border-bottom: 1px solid var(--color-divider);
    }

    /* The rows a dragged one passes slide out of its way. */
    .row[data-drag-shifting] {
      transition: transform var(--duration-fast) var(--easing-standard);
    }

    /* The dragged row follows the finger exactly: no transition, lifted. */
    .row[data-dragging] {
      z-index: 1;
      transition: none;
      scale: 1.02;
      border-radius: var(--radius-8);
      box-shadow: 0 6px 20px rgb(0 0 0 / 14%);
    }

    /* Then glides into its slot once let go. */
    .row[data-settling] {
      transition:
        transform var(--duration-medium) var(--easing-standard),
        scale var(--duration-medium) var(--easing-standard);
    }

    .handle {
      appearance: none;
      display: grid;
      place-items: center;
      width: 2.75rem;
      height: 2.75rem;
      margin-inline-start: calc(-1 * var(--spacing-8));
      padding: 0;
      border: none;
      border-radius: var(--radius-8);
      background: none;
      color: var(--color-brown-light);
      cursor: grab;
      /* The handle alone takes the finger from the page: the rest of the row,
         and the list around it, still scroll. */
      touch-action: none;
    }

    .row[data-dragging] .handle {
      cursor: grabbing;
      color: var(--color-brown-dark);
    }

    .handle:focus-visible,
    .open:focus-visible {
      outline: var(--focus-ring);
      outline-offset: -2px;
    }

    .handle app-icon {
      --icon-size: 1.25rem;

      padding: 0;
    }

    .open {
      appearance: none;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      column-gap: var(--spacing-8);
      min-height: 3.5rem;
      padding: var(--spacing-8) 0;
      border: none;
      border-radius: var(--radius-8);
      background: none;
      font: inherit;
      text-align: start;
      color: var(--font-color);
      cursor: pointer;
    }

    .open__text {
      display: grid;
      gap: 0.125rem;
      min-width: 0;
    }

    .open__label {
      font-weight: bold;
      font-size: var(--font-size-sm);
      line-height: 1.125rem;
      overflow-wrap: anywhere;
    }

    .open__summary {
      font-size: var(--font-size-xs);
      line-height: 1rem;
      color: var(--color-brown-middle);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .open app-icon {
      --icon-size: 1rem;

      padding: 0;
      color: var(--color-brown-light);
    }

    .error {
      grid-column: 1 / -1;
      margin: 0 0 var(--spacing-8);
      font-size: var(--font-size-xs);
      font-weight: 600;
      color: var(--color-danger);
    }

    .announcement {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `;

  #reorder(from: number, to: number) {
    this.dispatchEvent(
      new CustomEvent<FieldsReorderDetail>("fields-reorder", {
        detail: { from, to },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #open(id: string) {
    this.dispatchEvent(
      new CustomEvent<FieldOpenDetail>("field-open", {
        detail: { id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** ↑/↓ on a handle moves its field one place, keeping focus on it. */
  async #onHandleKey(event: KeyboardEvent, index: number) {
    const to =
      event.key === "ArrowUp"
        ? index - 1
        : event.key === "ArrowDown"
          ? index + 1
          : null;
    if (to === null) return;
    event.preventDefault();
    const field = this.fields[index];
    if (!field || to < 0 || to >= this.fields.length) return;

    this.#reorder(index, to);
    this.announcement = `« ${field.label} » déplacé en position ${to + 1} sur ${this.fields.length}.`;
    // The new order comes back down from the owner within the next frame.
    // Moving a node in the DOM drops its focus, so it is given back.
    await new Promise(requestAnimationFrame);
    this.renderRoot
      .querySelector<HTMLElement>(
        `.row[data-id="${CSS.escape(field.id)}"] .handle`,
      )
      ?.focus();
  }

  render() {
    return html`
      <ul class="list">
        ${repeat(
          this.fields,
          (field) => field.id,
          (field, index) => html`
            <li class="row" data-id=${field.id}>
              <button
                class="handle"
                type="button"
                aria-label=${`Déplacer « ${field.label} »`}
                aria-keyshortcuts="ArrowUp ArrowDown"
                @pointerdown=${(event: PointerEvent) =>
                  this.#drag.start(event, index)}
                @keydown=${(event: KeyboardEvent) =>
                  this.#onHandleKey(event, index)}
              >
                <app-icon icon="gripVertical"></app-icon>
              </button>
              <button
                class="open"
                type="button"
                @click=${() => this.#open(field.id)}
              >
                <span class="open__text">
                  <span class="open__label">${field.label}</span>
                  ${
                    summaryOf(field)
                      ? html`<span class="open__summary"
                          >${summaryOf(field)}</span
                        >`
                      : nothing
                  }
                </span>
                <app-icon icon="chevronRight"></app-icon>
              </button>
              ${
                this.errors[`field:${field.id}`]
                  ? html`<p class="error">
                      ${this.errors[`field:${field.id}`]}
                    </p>`
                  : nothing
              }
            </li>
          `,
        )}
      </ul>
      <p class="announcement" role="status">${this.announcement}</p>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "category-fields": CategoryFields;
  }
}
