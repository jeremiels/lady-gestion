import { css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { styleMap } from "lit/directives/style-map.js";
import { BaseElement } from "../../commons/base-element.ts";
import { customizeFormStyles } from "../../commons/customize-form.styles.ts";
import {
  addField,
  moveField,
  removeField,
  reparent,
  type CategoryDraft,
} from "../../data/category-editor.ts";
import {
  byLabel,
  canBeParentOf,
  childrenOf,
  resolveCatalogue,
  rootsOf,
} from "../../data/categories.ts";
import type { Category, CustomFieldDef } from "../../data/types.ts";
import { THEME_KEYS, THEME_META } from "../../theme/theme.ts";
import type { ThemeKey } from "../../theme/theme.types.ts";
import { iconStyle } from "../app-icon/app-icon.ts";
import type { AppSelectOption } from "../app-select/app-select.ts";
import type {
  FieldOpenDetail,
  FieldsReorderDetail,
} from "../category-fields/category-fields.ts";
import type {
  FieldChangeDetail,
  FieldRemoveDetail,
} from "../field-sheet/field-sheet.ts";
import type { KindPickDetail } from "../field-kind-sheet/field-kind-sheet.ts";
import type { IconPickDetail } from "../icon-picker-sheet/icon-picker-sheet.ts";

import "../app-icon/app-icon.ts";
import "../app-input/app-input.ts";
import "../app-select/app-select.ts";
import "../app-switch/app-switch.ts";
import "../category-fields/category-fields.ts";
import "../field-kind-sheet/field-kind-sheet.ts";
import "../field-sheet/field-sheet.ts";
import "../icon-picker-sheet/icon-picker-sheet.ts";

export type DraftChangeDetail = { draft: CategoryDraft };

/** What the colour swatches call each theme, for a screen reader. */
const THEME_NAMES: Record<ThemeKey, string> = {
  pink: "Rose",
  green: "Vert",
  purple: "Violet",
  orange: "Orange",
  brown: "Marron",
  yellow: "Jaune",
  taupe: "Taupe",
  turquoise: "Turquoise",
  fuchsia: "Fuchsia",
  mint: "Menthe",
  coral: "Corail",
  peach: "Pêche",
  grey: "Gris",
  gold: "Or",
};

/**
 * The form builder's page body: how a category looks, what it is linked to in
 * the app, and the fields its form asks for — each field edited in its own
 * sheet, reordered by dragging its handle.
 *
 * Presentational: every edit is handed up as a whole new draft, and the owning
 * view holds it, saves it and guards leaving with it unsaved.
 *
 * @fires draft-change - `{ draft }`, after any edit.
 */
@customElement("category-editor")
export class CategoryEditor extends BaseElement {
  @property({ attribute: false }) draft: CategoryDraft | null = null;
  /** Every live category, raw — only the raw row says "inherited". */
  @property({ attribute: false }) catalogue: Category[] = [];
  /** The category being edited, `null` for a new one. */
  @property({ attribute: false }) category: Category | null = null;
  /** From `validateCategory`. */
  @property({ attribute: false }) errors: Record<string, string> = {};

  @state() private openFieldId: string | null = null;
  @state() private kindsOpen = false;
  @state() private iconsOpen = false;

  static componentStyles = [
    customizeFormStyles,
    css`
      :host {
        display: grid;
        gap: 1.5rem;
      }

      .list {
        gap: var(--spacing-12);
      }

      .row {
        display: grid;
        gap: var(--spacing-8);
      }

      .row:not(:last-child) {
        border-bottom: 1px solid var(--color-divider);
        padding-bottom: var(--spacing-12);
      }

      .row__label {
        font-weight: bold;
        font-size: var(--font-size-xs);
        line-height: 1rem;
        color: var(--color-brown-middle);
      }

      .icon-row {
        appearance: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--spacing-12);
        min-height: 2.75rem;
        padding: 0;
        border: none;
        background: none;
        font: inherit;
        cursor: pointer;
      }

      .icon-row__value {
        display: flex;
        align-items: center;
        gap: var(--spacing-8);
        font-size: var(--font-size-xs);
        color: var(--color-brown-middle);
      }

      .icon-row:focus-visible {
        outline: var(--focus-ring);
        outline-offset: var(--focus-ring-offset);
        border-radius: var(--radius-8);
      }

      .swatches {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-8);
        margin: 0;
        padding: 0;
        border: none;
      }

      .swatch {
        position: relative;
        display: grid;
        place-items: center;
        width: 2.25rem;
        height: 2.25rem;
        border-radius: 50%;
        cursor: pointer;
      }

      .swatch input {
        position: absolute;
        inset: 0;
        margin: 0;
        opacity: 0;
        cursor: pointer;
      }

      .swatch__dot {
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 50%;
        background: var(--swatch);
        box-shadow: 0 0 0 2px var(--color-white);
      }

      .swatch:has(input:checked) {
        box-shadow: 0 0 0 2px var(--color-brown-dark);
      }

      .swatch:has(input:focus-visible) {
        outline: var(--focus-ring);
        outline-offset: 2px;
      }

      .note {
        margin: 0;
        font-size: var(--font-size-xs);
        line-height: 1rem;
        color: var(--color-brown-middle);
      }

      .error {
        margin: 0;
        font-size: var(--font-size-xs);
        font-weight: 600;
        color: var(--color-danger);
      }

      .add {
        appearance: none;
        width: 100%;
        min-height: 2.75rem;
        padding: var(--spacing-12) var(--spacing-16);
        border: 1px dashed var(--color-brown-light);
        border-radius: var(--radius-12);
        background: none;
        font: inherit;
        font-weight: 600;
        color: var(--color-brown-dark);
        cursor: pointer;
      }
    `,
  ];

  #change(patch: Partial<CategoryDraft>) {
    if (!this.draft) return;
    this.dispatchEvent(
      new CustomEvent<DraftChangeDetail>("draft-change", {
        detail: { draft: { ...this.draft, ...patch } },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #setFields(fields: CustomFieldDef[]) {
    this.#change({ fields });
  }

  /** The parent as resolved — what a child draws when it inherits. */
  get #parent() {
    const id = this.draft?.parentId;
    if (!id) return undefined;
    return resolveCatalogue(this.catalogue).find((type) => type.id === id);
  }

  #parentOptions(): AppSelectOption[] {
    const selfId = this.category?.id ?? null;
    const roots = byLabel(rootsOf(this.catalogue)).filter((root) =>
      canBeParentOf(this.catalogue, selfId, root.id),
    );
    return [
      { value: "", label: "Aucune" },
      ...roots.map((root) => ({ value: root.id, label: root.label })),
    ];
  }

  #onParentChange = (event: CustomEvent<{ value: string }>) => {
    if (!this.draft) return;
    this.#change(
      reparent(
        this.draft,
        event.detail.value || null,
        resolveCatalogue(this.catalogue),
      ),
    );
  };

  #onKindPick = (event: CustomEvent<KindPickDetail>) => {
    if (!this.draft) return;
    const { fields, added } = addField(this.draft.fields, event.detail.kind);
    this.kindsOpen = false;
    this.#setFields(fields);
    // Straight into the new field, so it gets its name.
    this.openFieldId = added.id;
  };

  render() {
    const draft = this.draft;
    if (!draft) return nothing;
    const openField =
      draft.fields.find((field) => field.id === this.openFieldId) ?? null;

    return html`
      ${this.#renderLook(draft)} ${this.#renderLinks(draft)}

      <section class="section">
        <h2 class="title">Champs du formulaire</h2>
        <category-fields
          .fields=${draft.fields}
          .errors=${this.errors}
          @field-open=${(event: CustomEvent<FieldOpenDetail>) => {
            this.openFieldId = event.detail.id;
          }}
          @fields-reorder=${(event: CustomEvent<FieldsReorderDetail>) =>
            this.#setFields(
              moveField(draft.fields, event.detail.from, event.detail.to),
            )}
        ></category-fields>
        <button
          class="add pressable"
          type="button"
          @click=${() => {
            this.kindsOpen = true;
          }}
        >
          + Ajouter un champ
        </button>
      </section>

      <field-kind-sheet
        .open=${this.kindsOpen}
        .fields=${draft.fields}
        @kind-pick=${this.#onKindPick}
        @sheet-close=${() => {
          this.kindsOpen = false;
        }}
      ></field-kind-sheet>
      <field-sheet
        .open=${openField !== null}
        .field=${openField}
        .fields=${draft.fields}
        .category=${{
          key: this.category?.key ?? "",
          tracksWork: draft.tracksWork,
        }}
        @field-change=${(event: CustomEvent<FieldChangeDetail>) => {
          this.openFieldId = null;
          this.#setFields(event.detail.fields);
        }}
        @field-remove=${(event: CustomEvent<FieldRemoveDetail>) => {
          this.openFieldId = null;
          this.#setFields(removeField(draft.fields, event.detail.id));
        }}
        @sheet-close=${() => {
          this.openFieldId = null;
        }}
      ></field-sheet>
      <icon-picker-sheet
        .open=${this.iconsOpen}
        .value=${draft.icon}
        .theme=${draft.theme ?? this.#parent?.theme ?? "taupe"}
        .inherited=${draft.parentId === null ? null : (this.#parent?.icon ?? null)}
        @icon-pick=${(event: CustomEvent<IconPickDetail>) => {
          this.iconsOpen = false;
          this.#change({ icon: event.detail.icon });
        }}
        @sheet-close=${() => {
          this.iconsOpen = false;
        }}
      ></icon-picker-sheet>
    `;
  }

  #renderLook(draft: CategoryDraft) {
    const parent = this.#parent;
    const theme = draft.theme ?? parent?.theme ?? null;
    const icon = draft.icon ?? parent?.icon ?? null;
    const hasChildren =
      this.category !== null &&
      childrenOf(this.catalogue, this.category.id).length > 0;

    return html`
      <section class="section">
        <h2 class="title">Apparence</h2>
        <div class="list">
          <div class="row">
            <app-input
              flat
              label="Nom"
              maxlength="40"
              .value=${draft.label}
              .error=${this.errors.label ?? ""}
              @input=${(event: Event) =>
                this.#change({
                  label: (event.currentTarget as HTMLInputElement).value,
                })}
            ></app-input>
          </div>
          ${
            hasChildren
              ? nothing
              : html`<div class="row">
                  <app-select
                    label="Catégorie parente"
                    .options=${this.#parentOptions()}
                    .value=${draft.parentId ?? ""}
                    .error=${this.errors.parentId ?? ""}
                    @select-change=${this.#onParentChange}
                  ></app-select>
                </div>`
          }
          <div class="row">
            <button
              class="icon-row"
              type="button"
              @click=${() => {
                this.iconsOpen = true;
              }}
            >
              <span class="row__label">Icône</span>
              <span class="icon-row__value">
                ${draft.icon === null && parent ? "Celle de la catégorie parente" : ""}
                ${
                  icon
                    ? html`<app-icon
                        .icon=${icon}
                        style=${styleMap(theme ? iconStyle(THEME_META[theme]) : {})}
                      ></app-icon>`
                    : "Choisir"
                }
              </span>
            </button>
            ${this.errors.icon ? html`<p class="error">${this.errors.icon}</p>` : nothing}
          </div>
          <div class="row">
            ${
              draft.parentId === null
                ? html`<fieldset class="swatches">
                    <legend class="row__label">Couleur</legend>
                    ${THEME_KEYS.map(
                      (key) => html`<label
                        class="swatch"
                        style=${styleMap({ "--swatch": THEME_META[key].color })}
                      >
                        <input
                          type="radio"
                          name="theme"
                          value=${key}
                          aria-label=${THEME_NAMES[key]}
                          .checked=${live(draft.theme === key)}
                          @change=${() => this.#change({ theme: key })}
                        />
                        <span class="swatch__dot"></span>
                      </label>`,
                    )}
                  </fieldset>`
                : html`<span class="row__label">Couleur</span>
                    <p class="note">
                      Celle de « ${parent?.label ?? ""} » : une sous-catégorie
                      prend toujours la couleur de sa catégorie parente.
                    </p>`
            }
            ${this.errors.theme ? html`<p class="error">${this.errors.theme}</p>` : nothing}
          </div>
        </div>
      </section>
    `;
  }

  #renderLinks(draft: CategoryDraft) {
    return html`
      <section class="section">
        <h2 class="title">Dans l’application</h2>
        <div class="list">
          <div class="row">
            <app-switch
              label="Rendez-vous à venir"
              .checked=${live(draft.isAppointment)}
              @switch-change=${(event: CustomEvent<{ checked: boolean }>) =>
                this.#change({ isAppointment: event.detail.checked })}
            ></app-switch>
            <p class="note">
              Ses évènements à venir s’affichent sur l’Accueil.
            </p>
          </div>
          <div class="row">
            <app-switch
              label="Joindre des fichiers"
              .checked=${live(draft.acceptsAttachments)}
              @switch-change=${(event: CustomEvent<{ checked: boolean }>) =>
                this.#change({ acceptsAttachments: event.detail.checked })}
            ></app-switch>
            <p class="note">
              « Ajouter un fichier » en bas du formulaire, rangé dans votre
              Google Drive.
            </p>
          </div>
        </div>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "category-editor": CategoryEditor;
  }
}
