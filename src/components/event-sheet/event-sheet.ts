import { css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { BaseElement } from "../../commons/base-element.ts";
import {
  type CustomFieldDef,
  fieldSchema,
  valueOf,
  pairErrorsOf,
  splitUnitValue,
  unitNameOf,
  type FormSchema,
  LiveQuery,
  type WorkActivity,
  activeHorseQuery,
  activitiesRepo,
  activityChoices,
  byLabel,
  childrenOf,
  eventsService,
  eventTypesRepo,
  fieldWithRole,
  findEventType,
  formatWorkActivity,
  todayISO,
  fromCents,
  horsesRepo,
  matchActivity,
  oneOf,
  readForm,
  rootsOf,
  type ResolvedEventType,
} from "../../data/index.ts";
import type { ActivityItem, HorseEvent } from "../../data/types.ts";
import type { AppSelectOption } from "../app-select/app-select.ts";

import "../app-bottom-sheet/app-bottom-sheet.ts";
import "../app-combobox/app-combobox.ts";
import "../app-input/app-input.ts";
import "../app-select/app-select.ts";
import "../app-checkbox/app-checkbox.ts";
import "../app-unit-select/app-unit-select.ts";

/**
 * Creating and editing an event.
 *
 * One sheet, whose fields come from the picked type's own `fields` list — a
 * care appointment (vet, farrier, dentist, osteopath) has a practitioner and
 * can record a repeat interval; a purchase has a merchant; a `workActivity`
 * type has the kind of work that was done; a type with none of those needs
 * none of it. Schema v6 moved this from a compile-time table in
 * `event.types.ts` to the `EventTypeDef` rows `#eventTypes` reads live, so a
 * type's shape and its label/icon/theme stay one row rather than two tables
 * that could drift.
 *
 * Setting `event` switches it to edit: same fields, same reader, prefilled
 * from the record and saved with `update` instead of `create`. A second form
 * would have been a second place for the per-type rules to drift.
 *
 * @fires sheet-close - No detail. Fired on dismissal and after a successful
 * save; the owner clears `open` in response.
 */
@customElement("event-sheet")
export class EventSheet extends BaseElement {
  @property({ type: Boolean, reflect: true }) open = false;

  /** The record being edited, or `null` to create a new one. */
  @property({ attribute: false }) event: HorseEvent | null = null;

  /** `''` until a type is picked; the select is `required`, so submit is blocked. */
  @state() private type: string = "";
  /** Which `reveals` checkboxes are ticked, by field id. */
  @state() private revealed: Record<string, boolean> = {};
  /**
   * Keyed by control name; absent means that field is fine.
   *
   * A bare `string` key rather than a union of the schema's names, because the
   * schema is now built from the picked type's `fields` and has no compile-time
   * shape. What a union bought — a mistyped `this.errors.titel` failing to
   * compile — is bought instead by `fieldControls`, which is the only thing
   * that names a type's controls, for both the markup and the reader.
   */
  @state() private errors: Record<string, string> = {};
  @state() private saveError = "";

  @query("form") private formEl?: HTMLFormElement;

  #horse = new LiveQuery(this, () => horsesRepo.getActive());

  /** The event-type catalogue — the type picker and every field's presence,
   * label and requiredness now come from here rather than a compile-time
   * table. */
  #eventTypes = new LiveQuery<ResolvedEventType[]>(this, () =>
    eventTypesRepo.listResolved(),
  );

  /**
   * The horse's own activities — same catalogue the week strip's quick day
   * sheet reads and writes (`activity-sheet.ts`), so a label typed in either
   * place shows up as a suggestion in the other.
   */
  #customActivities = activeHorseQuery<ActivityItem[]>(
    this,
    (horseId) => activitiesRepo.listByHorse(horseId),
    [],
  );

  /**
   * The `customFields` key the *record's own* type uses for its activity —
   * not the currently selected type, so switching type mid-edit does not
   * change which value `#activityChoices`/`#renderActivity` reads back.
   * Falls back to `"activity"`, the id every seeded `tracksWork` type uses,
   * on the tick before the catalogue's `LiveQuery` settles.
   */
  get #recordActivityFieldId(): string {
    const recordType =
      this.event &&
      findEventType(this.#eventTypes.value ?? [], this.event.type);
    return (
      (recordType && fieldWithRole(recordType, "workActivity")?.id) ??
      "activity"
    );
  }

  /**
   * The activities the combobox suggests — the six built-ins, the horse's
   * catalogue, and the one on the record being edited.
   *
   * The last is the one case that still bites: an activity whose catalogue
   * row has since been retired, or was never in the catalogue at all, is
   * still on the event, and without it here the field would open blank on a
   * session that plainly has one.
   */
  get #activityChoices(): WorkActivity[] {
    const custom = (this.#customActivities.value ?? []).map(
      (item) => item.label,
    );
    const choices = activityChoices(custom);
    const stored = this.event?.customFields[this.#recordActivityFieldId];
    const current = typeof stored === "string" ? stored : null;
    return current !== null && !choices.includes(current)
      ? [...choices, current]
      : choices;
  }

  static componentStyles = css`
    :host {
      display: contents;
    }

    /* Fields sit straight on the sheet background rather than each getting its
       own card — the ration sheet is the one that wants cards. Inputs are
       tinted a shade darker than the surface so they still read as recessed. */
    .event-form {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-16);
      --app-input-background: var(--color-brown-light-bg);
      --app-select-background: var(--color-brown-light-bg);
      --app-select-border-color: transparent;
      --app-combobox-background: var(--color-brown-light-bg);
    }

    /* Height, deliberately, and it is the one place in this codebase that
       animates a layout property. There is no transform that substitutes: the
       sheet is bottom-anchored (\`inset: auto 0 0 0\`), so revealing this field
       moves the sheet's top edge and everything above it, and that motion IS
       the thing being explained. It is one wrapper with two children, run once
       per checkbox tap. \`interpolate-size: allow-keywords\` — set on \`:root\` in
       \`layers/reset.css\` and inherited in here through the host — is what lets
       \`auto\` interpolate; where it is unsupported the declaration is dropped
       and the field appears instantly, exactly as it does today. */
    .event-form__follow-up {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-16);
      height: auto;
      /* So the select does not spill out of the wrapper mid-open. The clip
         margin leaves room for \`app-select\`'s focus ring, which sits at
         \`outline-offset: 2px\`. */
      overflow: clip;
      overflow-clip-margin: var(--spacing-4);
      transition: height var(--duration-medium) var(--easing-out);
    }

    /* Arrives with the space, not into it: without this the gap opens on an
       empty box and the field lands a beat later. */
    .event-form__follow-up app-select {
      transition: opacity var(--duration-medium) var(--easing-out);
    }

    @starting-style {
      .event-form__follow-up app-select {
        opacity: 0;
      }
    }

    /* The amount grows, the unit stays exactly as wide as "mL"/"kg"/"L" need —
       matching how the two read together in the mockup. */
    .event-form__quantity {
      display: flex;
      align-items: flex-end;
      gap: var(--spacing-16);
    }

    .event-form__quantity app-input {
      flex: 1;
      min-width: 0;
    }

    /* The live region itself, always in the DOM and never hidden — see the note
       on render(). display:contents is what lets it be permanent without
       costing anything: an empty box here would still draw one of
       .event-form's gaps under the last field. */
    .event-form__error-region {
      display: contents;
    }

    .event-form__error {
      margin: 0;
      font-size: var(--font-size-sm);
      font-weight: 500;
      color: var(--color-danger);
    }

    .event-form__submit {
      appearance: none;
      width: 100%;
      background: var(--color-brown-dark);
      color: var(--color-white);
      border: none;
      border-radius: var(--radius-8);
      padding: var(--spacing-12) var(--spacing-16);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }

    .event-form__submit:disabled {
      background: var(--color-brown-disabled);
      cursor: not-allowed;
    }
  `;

  /** The picked type, resolved from the live catalogue — `null` before one is
   * picked, or for the tick before the catalogue's `LiveQuery` settles. */
  get #type(): ResolvedEventType | null {
    return this.type
      ? (findEventType(this.#eventTypes.value ?? [], this.type) ?? null)
      : null;
  }

  /**
   * Seeds the state-backed controls from the record.
   *
   * In `willUpdate` rather than `render`, because `type` and `planFollowUp`
   * decide *which fields exist* — assigning them during render would be a
   * write inside the render pass. The plain inputs below are prefilled from
   * `event` directly and need nothing here.
   */
  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has("event")) this.#seedFromEvent();
  }

  /**
   * The state-backed controls, back to what `event` says — blank when creating.
   *
   * Shared by `willUpdate` and `#reset` because they want exactly the same
   * thing, and had the same four assignments each. The plain inputs are
   * prefilled from `event` in the template and need nothing here.
   */
  #seedFromEvent() {
    this.type = this.event?.type ?? "";

    const recordType =
      this.event &&
      findEventType(this.#eventTypes.value ?? [], this.event.type);
    // A checkbox opens ticked when the record stored something under it.
    this.revealed = Object.fromEntries(
      (recordType?.fields ?? [])
        .filter((field) => field.reveals?.length)
        .map((field) => [field.id, this.event?.customFields[field.id] != null]),
    );
    this.errors = {};
    this.saveError = "";
  }

  /**
   * One of the picked type's fields, drawn where its `fields` array puts it.
   *
   * The four blocks below used to be four lines in `render()`, in one sequence
   * every type shared — so a type could list Budget before its counterparty and
   * the form would still draw the counterparty first. A type's field list is
   * meant to be the single statement of what its form shows; this makes it the
   * statement of the order too, which was the half still written in the
   * template.
   *
   * `workActivity` is the one kind not drawn here: it doubles as the record's
   * title, so `render()` places it at the top of the form where `#renderTitle`
   * would otherwise be, rather than among the optional fields.
   */
  #renderField(field: CustomFieldDef): unknown {
    // No `default:` on purpose: every branch names a `FieldControl`, so adding
    // a control is a compile error here rather than a field that silently
    // renders as something else.
    switch (field.control) {
      case "checkbox":
        return this.#renderCheckbox(field);
      case "combobox":
        return this.#renderCombobox(field);
      case "select":
        return this.#renderSelect(field);
      case "money":
      case "number":
      case "date":
      case "text":
        return this.#renderInput(field);
    }
  }

  // `select-change` / `checkbox-change`, not the native `change`: that one is
  // `composed: false` and never leaves the field's shadow root.
  #onTypeChange = (event: CustomEvent<{ value: string }>) => {
    this.type = event.detail.value;
    // Leaving a type that offers a follow-up takes it with it, so a hidden
    // checkbox can't smuggle an interval onto another type.
    // Leaving a type takes its revealed state with it, so a hidden checkbox
    // cannot smuggle a value onto another type.
    const ids = new Set((this.#type?.fields ?? []).map((field) => field.id));
    this.revealed = Object.fromEntries(
      Object.entries(this.revealed).filter(([id]) => ids.has(id)),
    );
  };

  #close = () => {
    this.open = false;
    this.dispatchEvent(
      new CustomEvent("sheet-close", { bubbles: true, composed: true }),
    );
  };

  /**
   * Back to the starting point — blank when creating, the stored record when
   * editing. `form.reset()` restores each field's *default* value, which is
   * the value rendered from `event`, so the two halves agree.
   */
  #reset() {
    this.formEl?.reset();
    this.#seedFromEvent();
  }

  /**
   * Reads the form and hands the answers to `eventsService.saveEvent`.
   *
   * The reading is type-independent — `EVENT_SCHEMA` covers every field any
   * type's fields can call for, and one the current type omits arrives absent,
   * which each parser already reads as blank. The picked type is consulted for
   * two things here, and only because they cannot be deferred: `type`'s
   * whitelist depends on the live catalogue, which does not exist at module
   * scope, and on a `workActivity` type the activity is required and Nom is
   * not — the one case where that pair is reversed — so both parsers have to
   * be chosen before the type is read back.
   *
   * Everything the type decides on the way *out* — which field a counterparty
   * lands in, whether a follow-up or an activity may be written at all, what
   * an edit carries over — is the service's, and it re-derives the fields from
   * the type actually being saved. This component composed the record itself
   * until then, which put ~50 lines of what an event *is* inside a dialog and
   * left them reachable only from a browser suite.
   */
  #onSubmit = async (submitEvent: SubmitEvent) => {
    submitEvent.preventDefault();

    const horse = this.#horse.value;
    if (!horse) {
      this.saveError = "Aucun cheval sélectionné.";
      return;
    }

    const types = this.#eventTypes.value ?? [];
    const type = this.#type;
    const activityField = type
      ? fieldWithRole(type, "workActivity")
      : undefined;
    const priorChoices = this.#activityChoices;

    // The whole schema, built from the picked type's own field list. Only the
    // type select is stated here: it is how a type is chosen, so it cannot be
    // one of that type's own rows. Everything else — Nom, Date and Note
    // included — comes from `fields`, which is why a type that lists no Nom
    // (`travail`, whose combobox doubles as one) is not asked for one.
    const result = readForm(
      submitEvent.target as HTMLFormElement,
      {
        type: oneOf(
          types.map((candidate) => candidate.key),
          { required: true },
        ),
        ...Object.assign({}, ...(type?.fields ?? []).map(fieldSchema)),
      } as FormSchema,
    );

    if (!result.ok) {
      this.errors = result.errors as Record<string, string>;
      void this.#focusFirstError();
      return;
    }

    const values = result.value as Record<string, unknown>;
    // `oneOf` above already guarantees this names a live type.
    const resolvedType = findEventType(types, values.type as string)!;

    // Amount and unit are parsed independently — a type with no quantity field
    // submits both blank — so "both or neither" is enforced here, against the
    // type actually being saved rather than whichever the form last showed.
    for (const field of resolvedType.fields) {
      const pairErrors = pairErrorsOf(field, values);
      if (Object.keys(pairErrors).length > 0) {
        this.errors = { ...this.errors, ...pairErrors };
        void this.#focusFirstError();
        return;
      }
    }

    // Folded here rather than in the service: which controls a field draws,
    // and how they encode into one scalar, is this component's knowledge.
    const answers: Record<string, string | number | boolean | null> = {};
    for (const field of resolvedType.fields) {
      answers[field.id] = valueOf(field, values);
    }

    try {
      await eventsService.saveEvent({
        horseId: horse.id,
        existing: this.event,
        type: resolvedType,
        input: { type: values.type as string, values: answers },
      });

      // A freshly typed activity — one `priorChoices` didn't already know —
      // joins the horse's catalogue, so it shows up as a suggestion next time
      // here and as a chip on the week strip, exactly as if it had been added
      // from there instead.
      const activity = activityField ? answers[activityField.id] : null;
      if (
        typeof activity === "string" &&
        activity !== "" &&
        !matchActivity(activity, priorChoices)
      ) {
        await activitiesRepo.add({ horseId: horse.id, label: activity });
      }
    } catch (error: unknown) {
      this.saveError =
        error instanceof Error ? error.message : "Enregistrement impossible.";
      return;
    }

    this.#reset();
    this.#close();
  };

  /**
   * Moves to the first field the form reader rejected.
   *
   * Showing the messages is not this method's job and no longer needs to be:
   * setting `errors` sets each field's `error`, and `FormControl.setExternalError`
   * treats an app-supplied message as something to display at once rather than
   * something waiting on the user's turn. This form is `novalidate` — it has to
   * be, the reader in `forms.ts` owns the rules — so nothing else was ever going
   * to reveal them, and for a while nothing did: the submit button appeared to
   * do nothing at all.
   *
   * Focus is what remains, and it is what replaces the per-field `role="alert"`
   * this used to rely on. An assertive region on every field announces on every
   * blur; focusing the offending field announces its label, its state and its
   * message, in that order, and only when it matters.
   *
   * The `await` is for the fields' `error` to have reached them — they are
   * rendered from this element's own update, so it has to land first.
   */
  async #focusFirstError() {
    await this.updateComplete;

    // Document order, which is the only order that means anything here: the
    // keys of `errors` come out in schema order, and the schema does not match
    // the layout — `counterparty` is declared after `amountCents` but always
    // rendered above it. `querySelector` answers with the first
    // match in tree order, so the DOM settles the question for free and the two
    // orders can never drift again. `delegatesFocus` lands on the native
    // control inside the field's shadow root.
    const selector = Object.keys(this.errors)
      .map((name) => `[name="${name}"]`)
      .join(",");
    if (selector) this.formEl?.querySelector<HTMLElement>(selector)?.focus();
  }

  /**
   * The type picker's options: roots alphabetically, each one that has
   * children followed by them inside a native `<optgroup>`.
   *
   * The parent appears as the first option *inside its own group*, because a
   * parent is a selectable type like any other — an event can be filed under
   * `Santé` without picking which kind. Putting it above the group instead
   * would read as a separate entry that happens to share a name with the
   * heading below it.
   *
   * A catalogue with no children yields no `group` at all, so this is the same
   * flat list `byLabel` produced before types could nest.
   */
  #typeOptions(): AppSelectOption[] {
    const catalogue = this.#eventTypes.value ?? [];

    return byLabel(rootsOf(catalogue)).flatMap((root) => {
      const children = byLabel(childrenOf(catalogue, root.id));
      if (children.length === 0) {
        return [{ value: root.key, label: root.label }];
      }

      return [root, ...children].map((type) => ({
        value: type.key,
        label: type.label,
        group: root.label,
      }));
    });
  }

  render() {
    const type = this.#type;
    const options = this.#typeOptions();
    const event = this.event;

    // `.event-form__error-region` is mounted with the form and never hidden —
    // only its contents change. A live region has to be in the accessibility
    // tree *before* what is inside it changes, and `hidden` (like `display:
    // none`) takes it back out, so toggling one is indistinguishable from
    // inserting a fully-formed `role="alert"` element: typically announced as
    // nothing at all. Same shape as `app-update-toast`'s `.toast-region`.
    //
    // This is the one assertive region in the sheet. The fields themselves
    // carry no live-region role: their message reaches the user through
    // `aria-describedby`, read on focus, and `#focusFirstError` below puts them
    // on the field that has one.
    return html`
      <app-bottom-sheet
        heading=${event ? "Modifier l’évènement" : "Nouvel évènement"}
        description=${
          event
            ? "Mettre à jour les informations"
            : "Ajouter un soin, une séance ou un achat"
        }
        .open=${this.open}
        @sheet-close=${this.#close}
      >
        <form
          id="event-form"
          class="event-form"
          novalidate
          @submit=${this.#onSubmit}
        >
          <app-select
            label="Type"
            name="type"
            placeholder="Choisir un type"
            .options=${options}
            .value=${this.type}
            .error=${this.errors.type ?? ""}
            required
            @select-change=${this.#onTypeChange}
          ></app-select>

          ${
            /* The whole form, in the order the type's own `fields` array lists
               it. Nothing else is drawn: Nom, Date and Note are rows in that
               array like any other, which is what lets a type state its entire
               form in one place. */
            type
              ? type.fields.map((field) => this.#renderField(field))
              : nothing
          }

          <div class="event-form__error-region" role="alert">
            ${this.saveError ? html`<p class="event-form__error">${this.saveError}</p>` : nothing}
          </div>
        </form>

        <button
          slot="footer"
          class="event-form__submit pressable"
          type="submit"
          form="event-form"
          ?disabled=${this.#horse.value === undefined}
        >
          Enregistrer
        </button>
      </app-bottom-sheet>
    `;
  }

  /**


  /**
   * Whatever the record stored for this field, as text.
   *
   * The three base rows read their `HorseEvent` column rather than the bag —
   * they are fields in the type's array like any other, but they are not
   * `customFields` entries. A new event's date opens on today: every other
   * control opens blank, but a date picker with nothing in it is a field the
   * user has to fill in to say "now".
   */
  #stored(field: CustomFieldDef): string {
    const event = this.event;
    if (field.id === "title") return event?.title ?? "";
    if (field.id === "notes") return event?.notes ?? "";
    if (field.id === "date") return event?.date ?? todayISO();

    const value = event?.customFields[field.id];
    return value === null || value === undefined ? "" : String(value);
  }

  /**
   * `text`, `number`, `money` and `date` — one `app-input`, configured from the
   * field rather than from its id.
   *
   * A `units` field draws a second control beside it: the amount and the unit
   * are one value, stored concatenated, so they are one field here too.
   */
  #renderInput(field: CustomFieldDef) {
    const numeric = field.control === "money" || field.control === "number";
    const split = field.units
      ? splitUnitValue(this.event?.customFields[field.id])
      : null;

    const input = html`
      <app-input
        flat
        label=${field.label}
        name=${field.id}
        type=${field.control === "date" ? "date" : "text"}
        inputmode=${numeric ? "decimal" : nothing}
        ${
          /* An empty `pattern` attribute is a pattern that matches only the
              empty string, so it must be absent rather than blank on a text
              field — with it, anything the user types is invalid. */ ""
        }
        pattern=${numeric ? "[0-9]+([.,][0-9]+)?" : nothing}
        suffix=${field.suffix ?? nothing}
        .value=${
          split
            ? split.amount
            : field.control === "money"
              ? this.#storedAmount(field)
              : this.#stored(field)
        }
        .error=${this.errors[field.id] ?? ""}
        ?required=${field.required}
      ></app-input>
    `;

    if (!field.units) return input;

    return html`
      <div class="event-form__quantity">
        ${input}
        <app-unit-select
          label="Unités"
          name=${unitNameOf(field)}
          .options=${field.units.map((unit) => ({ value: unit, label: unit }))}
          .value=${split?.unit ?? ""}
          .error=${this.errors[unitNameOf(field)] ?? ""}
        ></app-unit-select>
      </div>
    `;
  }

  /** Cents are stored as an integer and shown as a decimal. */
  #storedAmount(field: CustomFieldDef): string {
    const value = this.event?.customFields[field.id];
    return typeof value === "number" ? String(fromCents(value)) : "";
  }

  /**
   * A checkbox, plus whatever it reveals while ticked.
   *
   * The revealed fields are the same `#renderField` as any other, so a
   * checkbox can hang a select, an input or another checkbox off itself
   * without this method knowing which.
   */
  #renderCheckbox(field: CustomFieldDef) {
    const on = this.revealed[field.id] ?? this.#stored(field) !== "";

    return html`
      <div class="event-form__follow-up">
        <app-checkbox
          label=${field.label}
          name=${field.id}
          ?checked=${on}
          @checkbox-change=${(event: CustomEvent<{ checked: boolean }>) => {
            this.revealed = {
              ...this.revealed,
              [field.id]: event.detail.checked,
            };
          }}
        ></app-checkbox>
        ${on ? (field.reveals ?? []).map((child) => this.#renderField(child)) : nothing}
      </div>
    `;
  }

  /** A closed list. */
  #renderSelect(field: CustomFieldDef) {
    return html`
      <app-select
        label=${field.label}
        name=${field.id}
        .options=${field.options ?? []}
        .value=${this.#selectValue(field)}
        .error=${this.errors[field.id] ?? ""}
        ?required=${field.required}
      ></app-select>
    `;
  }

  /**
   * The value a revealed select opens on — what the record stored if it is one
   * of the options, else the first, so the control is never blank while its
   * checkbox is ticked.
   */
  #selectValue(field: CustomFieldDef): string {
    const options = field.options ?? [];
    const parent = this.#type?.fields.find((one) =>
      one.reveals?.some((child) => child.id === field.id),
    );
    const stored = parent ? this.#stored(parent) : this.#stored(field);
    return options.some((option) => option.value === stored)
      ? stored
      : (options[0]?.value ?? "");
  }

  /**
   * An open list — the options plus, when the field asks for them, suggestions
   * from a live catalogue. Typing something in neither has to work: that is
   * what separates this from `select`.
   */
  #renderCombobox(field: CustomFieldDef) {
    const options =
      field.suggestions === "activities"
        ? this.#activityChoices.map((activity) => ({
            value: activity,
            label: formatWorkActivity(activity),
          }))
        : (field.options ?? []);

    return html`
      <app-combobox
        flat
        label=${field.label}
        name=${field.id}
        placeholder="Choisir ou ajouter"
        .options=${options}
        .value=${this.#stored(field)}
        .error=${this.errors[field.id] ?? ""}
        ?required=${field.required}
      ></app-combobox>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "event-sheet": EventSheet;
  }
}
