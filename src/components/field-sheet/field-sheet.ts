import { css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { repeat } from "lit/directives/repeat.js";
import { BaseElement } from "../../commons/base-element.ts";
import {
  LINKS,
  applyFieldEdit,
  defaultAsText,
  isProtectedField,
  isRequiredLocked,
  kindLabel,
  kindOf,
  kindSpecOf,
  linkableRole,
  savedOptions,
} from "../../data/category-editor.ts";
import { postsRepo, splitUnitValue, unitNameOf } from "../../data/index.ts";
import type { Category, CustomFieldDef } from "../../data/types.ts";

import "../app-bottom-sheet/app-bottom-sheet.ts";
import "../app-icon/app-icon.ts";
import "../app-input/app-input.ts";
import "../app-select/app-select.ts";
import "../app-switch/app-switch.ts";
import "../app-unit-select/app-unit-select.ts";

export type FieldChangeDetail = { fields: CustomFieldDef[] };
export type FieldRemoveDetail = { id: string };

/** A choice as the sheet edits it: `value` is `null` until it is first saved. */
type DraftOption = { key: number; value: string | null; label: string };

/**
 * Edits one field of a category's form: its name, whether it must be filled
 * in, its choices, the value a new entry opens on, and its link to the rest
 * of the app. Nothing is saved here — the owner's draft takes the result, and
 * the category's own Enregistrer writes it.
 *
 * @fires field-change - `{ fields }`, the whole form with this field as
 * edited: switching a link on takes it from the field that had it.
 * @fires field-remove - `{ id }`, once the removal is confirmed.
 * @fires sheet-close - From the inner `app-bottom-sheet`, on dismissal.
 */
@customElement("field-sheet")
export class FieldSheet extends BaseElement {
  @property({ type: Boolean }) open = false;
  /** The field being edited, as the draft holds it. */
  @property({ attribute: false }) field: CustomFieldDef | null = null;
  /** The whole form, which a link and the protection rules look across. */
  @property({ attribute: false }) fields: readonly CustomFieldDef[] = [];
  /** The category's slug and flag, `key` empty for one not saved yet. */
  @property({ attribute: false }) category: Pick<
    Category,
    "key" | "tracksWork"
  > = { key: "", tracksWork: false };

  @state() private options: DraftOption[] = [];
  @state() private errors: Record<string, string> = {};
  /** `null` while editing; the confirmation's message once removal is asked. */
  @state() private removal: string | null = null;

  @query("form") private formEl?: HTMLFormElement;

  #openCount = 0;
  #optionKey = 0;

  static componentStyles = css`
    :host {
      display: contents;
    }

    form {
      display: grid;
      gap: var(--spacing-12);
      padding-bottom: var(--spacing-16);
    }

    .card {
      display: grid;
      gap: var(--spacing-12);
      padding: var(--spacing-12);
      border-radius: var(--radius-12);
      background: var(--color-white);
    }

    .card__title {
      margin: 0;
      font-size: var(--font-size-xs);
      font-weight: bold;
      color: var(--color-brown-middle);
    }

    .hint {
      margin: calc(-1 * var(--spacing-8)) 0 0;
      font-size: var(--font-size-xs);
      line-height: 1rem;
      color: var(--color-brown-middle);
    }

    .options {
      display: grid;
      gap: var(--spacing-8);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .option {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
      gap: var(--spacing-8);
    }

    .icon-button {
      appearance: none;
      display: grid;
      place-items: center;
      width: 2.75rem;
      height: 2.75rem;
      padding: 0;
      border: none;
      border-radius: var(--radius-8);
      background: none;
      color: var(--color-brown-dark);
      cursor: pointer;
    }

    .icon-button app-icon {
      --icon-size: 1rem;

      padding: 0;
    }

    .quantity {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
      gap: var(--spacing-8);
    }

    .link-button,
    .remove {
      appearance: none;
      justify-self: start;
      padding: var(--spacing-8) 0;
      border: none;
      background: none;
      font: inherit;
      font-weight: 600;
      color: var(--color-brown-dark);
      cursor: pointer;
    }

    .remove {
      justify-self: center;
      color: var(--color-danger);
    }

    .error {
      margin: 0;
      font-size: var(--font-size-xs);
      font-weight: 600;
      color: var(--color-danger);
    }

    .footer {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--spacing-12);
    }

    .footer--single {
      grid-template-columns: 1fr;
    }

    .button {
      appearance: none;
      width: 100%;
      padding: var(--spacing-12) var(--spacing-16);
      border: none;
      border-radius: var(--radius-8);
      background: var(--color-brown-dark);
      color: var(--color-white);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }

    .button--quiet {
      background: var(--color-brown-light-bg);
      color: var(--color-brown-dark);
    }

    .button--danger {
      background: var(--color-danger);
    }

    .removal {
      margin: 0 0 var(--spacing-16);
      line-height: 1.4;
    }
  `;

  protected willUpdate(changed: PropertyValues<this>) {
    if ((changed.has("open") || changed.has("field")) && this.open) {
      if (changed.has("open")) this.#openCount += 1;
      this.errors = {};
      this.removal = null;
      this.options = (this.field?.options ?? []).map((option) => ({
        key: ++this.#optionKey,
        value: option.value,
        label: option.label,
      }));
    }
  }

  #emit<T>(type: string, detail: T) {
    this.dispatchEvent(
      new CustomEvent<T>(type, { detail, bubbles: true, composed: true }),
    );
  }

  #onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    const field = this.field;
    const form = this.formEl;
    if (!field || !form) return;

    const data = new FormData(form);
    const defaults: Record<string, string> = {};
    for (const name of [field.id, unitNameOf(field)]) {
      const value = data.get(name);
      if (typeof value === "string") defaults[name] = value;
    }
    const result = applyFieldEdit(this.fields, field, {
      label: String(data.get("label") ?? ""),
      required: data.get("required") !== null,
      options: this.options,
      defaults,
      linked: data.get("linked") !== null,
    });

    this.errors = result.ok ? {} : result.errors;
    if (result.ok) {
      this.#emit<FieldChangeDetail>("field-change", { fields: result.fields });
    }
  };

  #askRemoval = async () => {
    const field = this.field;
    if (!field) return;
    const count = this.category.key
      ? await postsRepo.countWithValue(this.category.key, field.id)
      : 0;
    this.removal =
      count === 0
        ? `« ${field.label} » sera retiré du formulaire.`
        : `${count} évènement${count > 1 ? "s ont" : " a"} une valeur pour « ${field.label} ». Elle reste enregistrée, mais ne s’affichera plus.`;
  };

  #confirmRemoval = () => {
    if (this.field) {
      this.#emit<FieldRemoveDetail>("field-remove", { id: this.field.id });
    }
  };

  render() {
    const field = this.field;
    return html`
      <app-bottom-sheet
        heading=${this.removal === null ? "Modifier le champ" : "Retirer le champ ?"}
        description=${field ? kindLabel(field) : ""}
        .open=${this.open}
      >
        ${
          field
            ? this.removal === null
              ? keyed(`${field.id}-${this.#openCount}`, this.#renderForm(field))
              : html`<p class="removal">${this.removal}</p>`
            : nothing
        }
        ${this.#renderFooter()}
      </app-bottom-sheet>
    `;
  }

  #renderFooter() {
    if (this.removal !== null) {
      return html`<div slot="footer" class="footer">
        <button
          class="button button--quiet pressable"
          type="button"
          @click=${() => {
            this.removal = null;
          }}
        >
          Annuler
        </button>
        <button
          class="button button--danger pressable"
          type="button"
          @click=${this.#confirmRemoval}
        >
          Retirer
        </button>
      </div>`;
    }
    return html`<div slot="footer" class="footer footer--single">
      <button
        class="button pressable"
        type="button"
        @click=${() => this.formEl?.requestSubmit()}
      >
        Valider
      </button>
    </div>`;
  }

  #renderForm(field: CustomFieldDef) {
    const spec = kindSpecOf(field);
    const role = linkableRole(field);
    const holder =
      role === undefined
        ? undefined
        : this.fields.find((one) => one.role === role && one.id !== field.id);
    const removable = !isProtectedField(
      { ...this.category, fields: this.fields },
      field,
    );

    return html`
      <form novalidate @submit=${this.#onSubmit}>
        <div class="card">
          <app-input
            flat
            label="Nom du champ"
            name="label"
            maxlength="60"
            .value=${field.label}
            .error=${this.errors.label ?? ""}
            required
          ></app-input>
          ${
            spec?.requirable
              ? html`<app-switch
                  label="Obligatoire"
                  name="required"
                  ?checked=${field.required}
                  ?disabled=${isRequiredLocked(field)}
                ></app-switch>`
              : nothing
          }
        </div>

        ${
          field.control === "select" || field.control === "combobox"
            ? this.#renderOptions()
            : nothing
        }
        ${spec?.defaultable ? this.#renderDefault(field) : nothing}
        ${
          role !== undefined
            ? html`<div class="card">
                <app-switch
                  label=${LINKS[role].label}
                  name="linked"
                  ?checked=${field.role === role}
                ></app-switch>
                <p class="hint">
                  ${LINKS[role].hint}
                  ${holder ? ` Remplace « ${holder.label} ».` : ""}
                </p>
              </div>`
            : nothing
        }
        ${
          removable
            ? html`<button
                class="remove pressable"
                type="button"
                @click=${this.#askRemoval}
              >
                Retirer ce champ du formulaire
              </button>`
            : nothing
        }
      </form>
    `;
  }

  #renderOptions() {
    return html`<div class="card">
      <h3 class="card__title">Choix proposés</h3>
      <ul class="options">
        ${repeat(
          this.options,
          (option) => option.key,
          (option, index) => html`<li class="option">
            <app-input
              flat
              label=${`Choix ${index + 1}`}
              maxlength="60"
              .value=${option.label}
              @input=${(event: Event) => {
                const label = (event.currentTarget as HTMLInputElement).value;
                this.options = this.options.map((one) =>
                  one.key === option.key ? { ...one, label } : one,
                );
              }}
            ></app-input>
            <button
              class="icon-button pressable pressable--small"
              type="button"
              aria-label=${`Retirer le choix ${index + 1}`}
              @click=${() => {
                this.options = this.options.filter(
                  (one) => one.key !== option.key,
                );
              }}
            >
              <app-icon icon="close"></app-icon>
            </button>
          </li>`,
        )}
      </ul>
      <button
        class="link-button pressable"
        type="button"
        @click=${() => {
          this.options = [
            ...this.options,
            { key: ++this.#optionKey, value: null, label: "" },
          ];
        }}
      >
        + Ajouter un choix
      </button>
      ${this.errors.options ? html`<p class="error">${this.errors.options}</p>` : nothing}
    </div>`;
  }

  #renderDefault(field: CustomFieldDef) {
    const error = this.errors[field.id] ?? "";
    let control;
    switch (kindOf(field)) {
      case "checkbox":
        control = html`<app-switch
          label="Cochée par défaut"
          name=${field.id}
          ?checked=${field.defaultValue === true}
        ></app-switch>`;
        break;
      case "select":
        control = html`<app-select
          label="Valeur par défaut"
          name=${field.id}
          placeholder="Aucune"
          .options=${savedOptions(this.options)}
          .value=${typeof field.defaultValue === "string" ? field.defaultValue : ""}
          .error=${error}
        ></app-select>`;
        break;
      case "quantity": {
        const split = splitUnitValue(field.defaultValue);
        control = html`<div class="quantity">
          <app-input
            flat
            label="Valeur par défaut"
            name=${field.id}
            inputmode="decimal"
            .value=${split.amount.replace(".", ",")}
            .error=${error}
          ></app-input>
          <app-unit-select
            label="Unité"
            name=${unitNameOf(field)}
            .options=${(field.units ?? []).map((unit) => ({ value: unit, label: unit }))}
            .value=${split.unit}
            .error=${this.errors[unitNameOf(field)] ?? ""}
          ></app-unit-select>
        </div>`;
        break;
      }
      default: {
        const numeric = field.control === "money" || field.control === "number";
        control = html`<app-input
          flat
          label="Valeur par défaut"
          name=${field.id}
          inputmode=${numeric ? "decimal" : nothing}
          suffix=${field.suffix ?? nothing}
          .value=${defaultAsText(field)}
          .error=${error}
        ></app-input>`;
      }
    }

    return html`<div class="card">
      ${control}
      <p class="hint">Préremplie dans chaque nouvel évènement, modifiable.</p>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "field-sheet": FieldSheet;
  }
}
