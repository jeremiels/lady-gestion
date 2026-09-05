import { css, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { BaseElement } from '../../commons/base-element.ts';
import {
  DEFAULT_FOLLOW_UP,
  FOLLOW_UP_INTERVALS,
  type FieldParser,
  LiveQuery,
  type WorkActivity,
  WORK_ACTIVITIES,
  bool,
  cents,
  eventsService,
  followUpValue,
  formatFollowUpInterval,
  formatWorkActivity,
  fromCents,
  horsesRepo,
  isoDate,
  oneOf,
  readForm,
  text,
  todayISO,
} from '../../data/index.ts';
import type { HorseEvent } from '../../data/types.ts';
import {
  EVENT_TYPES,
  EVENT_TYPES_BY_LABEL,
  type CounterpartyField,
  type EventFormSpec,
  eventFormSpec,
  eventType,
  type EventTypeKey,
} from '../../types/event.types.ts';
import type { AppSelectOption } from '../app-select/app-select.ts';

import '../app-bottom-sheet/app-bottom-sheet.ts';
import '../app-input/app-input.ts';
import '../app-select/app-select.ts';
import '../app-checkbox/app-checkbox.ts';

const TYPE_OPTIONS: AppSelectOption[] = EVENT_TYPES_BY_LABEL.map((type) => ({
  value: type,
  label: eventType.label(type),
}));

const FOLLOW_UP_OPTIONS: AppSelectOption[] = FOLLOW_UP_INTERVALS.map((interval) => ({
  value: followUpValue(interval),
  label: formatFollowUpInterval(interval),
}));

/**
 * The Activité parser, required only on the layout that draws the field.
 *
 * A function rather than two schema entries, or a check after `readForm`: the
 * "Ce champ est requis." wording belongs to `forms.ts` and copying it here is
 * exactly the drift a schema exists to stop. The declared return type is the
 * looser of the two overloads so the schema's shape — and with it
 * `EventFieldName` — stays the same whichever layout is showing.
 *
 * It takes the activities rather than reading a module-scope list, because the
 * list is no longer fixed: the week strip lets the user add their own, and a
 * parser that only accepted the six built-ins would reject the session that
 * opened this sheet. Same array as the select's options, deliberately — two
 * lists here would mean an option the form refuses to submit.
 */
const activityParser = (
  choices: readonly WorkActivity[],
  required: boolean,
): FieldParser<WorkActivity | null> =>
  required ? oneOf(choices, { required: true }) : oneOf(choices);

/**
 * Every field the form can submit, and how each is parsed.
 *
 * At module scope rather than built inside the submit handler, for the type as
 * much as the allocation: `keyof typeof EVENT_SCHEMA` is what gives `errors`
 * below a real key union instead of a bare `string`, so a mistyped
 * `this.errors.titel` is a compile error rather than a message that silently
 * never appears.
 *
 * One schema for all four layouts, deliberately. The variant decides which
 * fields are *rendered* and which column each value is *written* to (see
 * `#onSubmit`); it does not change how a submitted field is read, and a field
 * the current layout does not show simply arrives absent — which every parser
 * here already treats as blank.
 *
 * `activity` is the one exception, and a narrow one: it is required on the
 * layout that draws it and absent everywhere else, so `#onSubmit` swaps in the
 * required parser for that layout alone. The *shape* is unchanged either way.
 */
const EVENT_SCHEMA = {
  type: oneOf(EVENT_TYPES, { required: true }),
  title: text({ required: true, maxLength: 120 }),
  date: isoDate({ required: true }),
  amountCents: cents(),
  notes: text({ maxLength: 500 }),
  counterparty: text({ maxLength: 120 }),
  activity: activityParser([], false),
  planFollowUp: bool(),
  followUpInterval: text(),
};

type EventFieldName = keyof typeof EVENT_SCHEMA;

/**
 * Creating and editing an event.
 *
 * One sheet, four field layouts chosen by the type select at the top: a care
 * appointment (vet, farrier, dentist, osteopath) has a practitioner and can
 * record a repeat interval; a purchase has a merchant; a schooling session has
 * the kind of work that was done; lessons and boarding need none of it. The
 * variant mapping lives in `event.types.ts` so the taxonomy and its form stay
 * together.
 *
 * Setting `event` switches it to edit: same layouts, same reader, prefilled
 * from the record and saved with `update` instead of `create`. A second form
 * would have been a second place for the variant rules to drift.
 *
 * @fires sheet-close - No detail. Fired on dismissal and after a successful
 * save; the owner clears `open` in response.
 */
@customElement('event-sheet')
export class EventSheet extends BaseElement {
  @property({ type: Boolean, reflect: true }) open = false;

  /** The record being edited, or `null` to create a new one. */
  @property({ attribute: false }) event: HorseEvent | null = null;

  /** `''` until a type is picked; the select is `required`, so submit is blocked. */
  @state() private type: EventTypeKey | '' = '';
  @state() private planFollowUp = false;
  /**
   * Keyed by schema field name; absent means that field is fine.
   *
   * `Partial` because that is what `readForm` returns and what every read site
   * below assumes — but keyed by `EventFieldName`, not `string`, so the keys and
   * the schema cannot drift.
   */
  @state() private errors: Partial<Record<EventFieldName, string>> = {};
  @state() private saveError = '';

  @query('form') private formEl?: HTMLFormElement;

  #horse = new LiveQuery(this, () => horsesRepo.getActive());

  /**
   * The activities the select may offer — the built-ins, and the one on the
   * record being edited.
   *
   * Deliberately not the horse's custom catalogue: that list belongs to the
   * week strip's quick day sheet (see `activities.repo.ts`), and a label typed
   * there should not start appearing as a full-form choice. The fallback below
   * is the one case that still bites: an activity whose catalogue row has
   * since been retired, or was never in the catalogue at all, is still on the
   * event, and without it here the select would open blank on a session that
   * plainly has one, then refuse to save.
   */
  get #activityChoices(): WorkActivity[] {
    const choices: WorkActivity[] = WORK_ACTIVITIES;
    const current = this.event?.activity ?? null;
    return current !== null && !choices.includes(current) ? [...choices, current] : choices;
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

  /** The layout the picked type calls for, or `null` before one is picked. */
  get #spec(): EventFormSpec | null {
    return this.type ? eventFormSpec(this.type) : null;
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
    if (changed.has('event')) this.#seedFromEvent();
  }

  /**
   * The state-backed controls, back to what `event` says — blank when creating.
   *
   * Shared by `willUpdate` and `#reset` because they want exactly the same
   * thing, and had the same four assignments each. The plain inputs are
   * prefilled from `event` in the template and need nothing here.
   */
  #seedFromEvent() {
    this.type = this.event?.type ?? '';
    this.planFollowUp = this.event?.followUpInterval != null;
    this.errors = {};
    this.saveError = '';
  }

  /**
   * Practitioner or merchant, read from whichever column the *record's* own
   * layout stores it in — not the layout currently picked in the select, so
   * switching type mid-edit still shows what was captured.
   */
  get #counterparty(): string {
    const event = this.event;
    if (!event) return '';
    const column = eventFormSpec(event.type).counterparty?.column;
    return (column ? event[column] : null) ?? '';
  }

  // `select-change` / `checkbox-change`, not the native `change`: that one is
  // `composed: false` and never leaves the field's shadow root.
  #onTypeChange = (event: CustomEvent<{ value: string }>) => {
    this.type = event.detail.value as EventTypeKey | '';
    // Leaving a layout that offers a follow-up takes it with it, so a hidden
    // checkbox can't smuggle an interval onto a purchase.
    if (!this.#spec?.followUp) this.planFollowUp = false;
  };

  #onFollowUpToggle = (event: CustomEvent<{ checked: boolean }>) => {
    this.planFollowUp = event.detail.checked;
  };

  #close = () => {
    this.open = false;
    this.dispatchEvent(new CustomEvent('sheet-close', { bubbles: true, composed: true }));
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
   * The reading is variant-independent — `EVENT_SCHEMA` covers every field any
   * layout can render, and one the current layout omits arrives absent, which
   * each parser already reads as blank. `spec` is consulted for one thing here,
   * and only because it cannot be deferred: Activité is required on the layout
   * that draws it, so the parser has to be chosen before the type is read back.
   *
   * Everything the variant decides on the way *out* — which column a
   * counterparty lands in, whether a follow-up or an activity may be written at
   * all, what an edit carries over — is the service's, and it re-derives the
   * layout from the type actually being saved. This component composed the
   * record itself until then, which put ~50 lines of what an event *is* inside
   * a dialog and left them reachable only from a browser suite.
   */
  #onSubmit = async (submitEvent: SubmitEvent) => {
    submitEvent.preventDefault();

    const horse = this.#horse.value;
    if (!horse) {
      this.saveError = 'Aucun cheval sélectionné.';
      return;
    }

    const spec = this.#spec;
    const result = readForm(submitEvent.target as HTMLFormElement, {
      ...EVENT_SCHEMA,
      activity: activityParser(this.#activityChoices, spec?.activity ?? false),
    });

    if (!result.ok) {
      this.errors = result.errors;
      void this.#focusFirstError();
      return;
    }

    try {
      await eventsService.saveEvent({
        horseId: horse.id,
        existing: this.event,
        input: result.value,
      });
    } catch (error: unknown) {
      this.saveError = error instanceof Error ? error.message : 'Enregistrement impossible.';
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
    // the layout — `counterparty` is declared after `amountCents` but rendered
    // above it in the care variant. `querySelector` answers with the first
    // match in tree order, so the DOM settles the question for free and the two
    // orders can never drift again. `delegatesFocus` lands on the native
    // control inside the field's shadow root.
    const selector = Object.keys(this.errors)
      .map((name) => `[name="${name}"]`)
      .join(',');
    if (selector) this.formEl?.querySelector<HTMLElement>(selector)?.focus();
  }

  render() {
    const counterparty = this.#spec?.counterparty ?? null;
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
        heading=${event ? 'Modifier l’évènement' : 'Nouvel évènement'}
        description=${event
          ? 'Mettre à jour les informations'
          : 'Ajouter un soin, une séance ou un achat'}
        .open=${this.open}
        @sheet-close=${this.#close}
      >
        <form id="event-form" class="event-form" novalidate @submit=${this.#onSubmit}>
          <app-select
            label="Type"
            name="type"
            placeholder="Choisir un type"
            .options=${TYPE_OPTIONS}
            .value=${this.type}
            .error=${this.errors.type ?? ''}
            required
            @select-change=${this.#onTypeChange}
          ></app-select>

          ${this.#spec?.activity ? this.#renderActivity() : nothing}

          <app-input
            flat
            label="Nom"
            name="title"
            .value=${event?.title ?? ''}
            .error=${this.errors.title ?? ''}
            required
          ></app-input>

          <app-input
            flat
            label="Date"
            name="date"
            type="date"
            .value=${event?.date ?? todayISO()}
            .error=${this.errors.date ?? ''}
            required
          ></app-input>

          ${counterparty?.position === 'before-amount'
            ? this.#renderCounterparty(counterparty)
            : nothing}

          <app-input
            flat
            label="Budget"
            name="amountCents"
            type="text"
            inputmode="decimal"
            pattern="[0-9]+([.,][0-9]{1,2})?"
            suffix="€"
            .value=${event?.amountCents == null ? '' : String(fromCents(event.amountCents))}
            .error=${this.errors.amountCents ?? ''}
          ></app-input>

          ${counterparty?.position === 'after-amount'
            ? this.#renderCounterparty(counterparty)
            : nothing}
          ${this.#spec?.followUp ? this.#renderFollowUp() : nothing}

          <app-input
            flat
            label="Note"
            name="notes"
            .value=${event?.notes ?? ''}
            .error=${this.errors.notes ?? ''}
          ></app-input>

          <div class="event-form__error-region" role="alert">
            ${this.saveError
              ? html`<p class="event-form__error">${this.saveError}</p>`
              : nothing}
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
   * Practitioner or merchant — the same column-per-layout field, relabelled.
   * One control, so the value can never be carried across a layout change.
   */
  #renderCounterparty(field: CounterpartyField) {
    return html`
      <app-input
        flat
        label=${field.label}
        name="counterparty"
        .value=${this.#counterparty}
        .error=${this.errors.counterparty ?? ''}
      ></app-input>
    `;
  }

  /**
   * What was done in the session. Its own control rather than a relabelled
   * shared one — unlike the practitioner/merchant field, no other layout has
   * anything to relabel it to.
   */
  #renderActivity() {
    const options: AppSelectOption[] = this.#activityChoices.map((activity) => ({
      value: activity,
      label: formatWorkActivity(activity),
    }));

    return html`
      <app-select
        label="Activité"
        name="activity"
        placeholder="Choisir une activité"
        .options=${options}
        .value=${this.event?.activity ?? ''}
        .error=${this.errors.activity ?? ''}
        required
      ></app-select>
    `;
  }

  #renderFollowUp() {
    return html`
      <div class="event-form__follow-up">
        <app-checkbox
          label="Planifier un rendez-vous"
          name="planFollowUp"
          ?checked=${this.planFollowUp}
          @checkbox-change=${this.#onFollowUpToggle}
        ></app-checkbox>

        ${this.planFollowUp
          ? html`
              <app-select
                label="Prochain rendez-vous à planifier"
                name="followUpInterval"
                .options=${FOLLOW_UP_OPTIONS}
                .value=${followUpValue(this.event?.followUpInterval ?? DEFAULT_FOLLOW_UP)}
                required
              ></app-select>
            `
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'event-sheet': EventSheet;
  }
}
