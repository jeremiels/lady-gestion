import { css, html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { BaseElement } from '../../commons/base-element.ts';
import {
  activeHorseQuery,
  activitiesRepo,
  activityChoices,
  eventsService,
  formatDayShortMonth,
  formatWorkActivity,
  horsesRepo,
  matchActivity,
  readForm,
  text,
  todayISO,
  type IsoDate,
  type WorkActivity,
  type WorkSession,
} from '../../data/index.ts';
import type { ActivityItem } from '../../data/types.ts';

import '../app-bottom-sheet/app-bottom-sheet.ts';
import '../app-chip/app-chip.ts';
import '../app-icon/app-icon.ts';
import '../app-input/app-input.ts';

/** Long enough for "Balade à pied", short enough to stay on one chip. */
const MAX_LABEL = 40;

const LABEL_SCHEMA = { label: text({ required: true, maxLength: MAX_LABEL }) };

/**
 * What the horse did on one day — the sheet behind the dashboard's week strip.
 *
 * A tap, not a form. The strip's whole job is answering "what did we do this
 * week", and the fastest way to fill a gap in that answer is to name the
 * activity and be done: one tap on a chip writes the session and closes. The
 * full event sheet is still there for a session that needs a price, a note or a
 * date the strip does not show.
 *
 * The list of chips is the six built-in activities plus whatever the user has
 * added, and the input at the bottom is how they add one. A new activity is
 * saved to the catalogue (`activitiesRepo`) *and* applied to the day in one
 * submit — typing it is already the act of choosing it.
 *
 * Reads the day's existing session from `existing` rather than querying for it:
 * the strip holds the whole week and has already resolved which row each day
 * shows, and a second lookup here could disagree with what the user tapped.
 *
 * @fires sheet-close - No detail. Fired on dismissal and after a save; the
 * owner clears `open` in response.
 */
@customElement('activity-sheet')
export class ActivitySheet extends BaseElement {
  @property({ type: Boolean, reflect: true }) open = false;

  /** The day the sheet is about, `YYYY-MM-DD`. */
  @property({ type: String }) date: IsoDate = todayISO();

  /** The day's session, or `null` for a day with none. */
  @property({ attribute: false }) existing: WorkSession | null = null;

  @state() private error = '';

  @query('form') private formEl?: HTMLFormElement;

  #activities = activeHorseQuery<ActivityItem[]>(
    this,
    (horseId) => activitiesRepo.listByHorse(horseId),
    [],
  );

  static componentStyles = css`
    :host {
      display: contents;
    }

    /* Wrapping rather than scrolling: the whole point is seeing every activity
       at once, and a hidden chip is one the user will add a second time. */
    .activity-sheet__chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-8);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .activity-sheet__add {
      display: flex;
      align-items: center;
      gap: var(--spacing-8);
      margin-block-start: var(--spacing-20);
      --app-input-background: var(--color-white);
    }

    .activity-sheet__field {
      flex: 1;
      min-width: 0;
    }

    .activity-sheet__submit {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.75rem;
      height: 2.75rem;
      border: none;
      border-radius: var(--radius-8);
      background: var(--color-brown-dark);
      color: var(--color-white);
      cursor: pointer;
    }

    .activity-sheet__submit:focus-visible {
      outline: 2px solid var(--color-brown-dark);
      outline-offset: 2px;
    }

    /* Assertive and always mounted — a live region has to be in the
       accessibility tree before its contents change, so it can never be
       toggled with the hidden attribute. The same shape event-sheet uses.
       No backticks in here: this is a css template literal and one would
       close it, with the error pointing at whatever line the parser gave up
       on rather than at the comment. */
    .activity-sheet__error-region {
      display: contents;
    }

    .activity-sheet__error {
      margin-block-start: var(--spacing-8);
      font-size: 0.75rem;
      color: var(--app-field-error-color, var(--color-error));
    }
  `;

  /** The chips to offer: the built-ins, then the horse's own. */
  get #choices(): WorkActivity[] {
    return activityChoices((this.#activities.value ?? []).map((item) => item.label));
  }

  /**
   * Closes once, however the close was asked for.
   *
   * The guard is load-bearing, not defensive. This handler is bound to the
   * bottom sheet's own `sheet-close`, and clearing `open` below is what makes
   * that sheet close and emit one — so an unguarded version re-enters itself
   * and the owner sees a single tap as three closes. Reading `open` is enough
   * to tell the two apart: the first pass through is the only one that finds it
   * still set.
   */
  #close = () => {
    if (!this.open) return;

    this.error = '';
    this.formEl?.reset();
    this.open = false;
    this.dispatchEvent(new CustomEvent('sheet-close', { bubbles: true, composed: true }));
  };

  /**
   * Writes the day's activity — and, when `add` is set, the catalogue row that
   * activity is new to — then closes.
   *
   * `existing` decides create-or-replace inside the service; all this knows is
   * that a day has one activity and the user just picked it.
   *
   * The horse is resolved here rather than held in a `LiveQuery`, and that is
   * the fix for a real bug rather than a preference. Nothing in this sheet
   * renders the horse, so a subscription existed only to be read inside these
   * handlers — while the chips, which come from a list that needs no query at
   * all, were on screen and tappable from the first frame. Every tap before that
   * first value arrived answered "Aucun cheval sélectionné." on a dashboard
   * plainly showing one. Asking at write time also answers the question at the
   * moment it is asked, so a horse switched while the sheet is open cannot
   * record the session against the one before it.
   *
   * The two writes are not one transaction. If the session fails after the
   * catalogue row landed, the chip is offered and the day is unchanged — an
   * activity nobody has used yet, which is what the catalogue is for anyway.
   */
  #apply = async (activity: WorkActivity, add: string | null = null) => {
    const horse = await horsesRepo.getActive();
    if (!horse) {
      this.error = 'Aucun cheval sélectionné.';
      return;
    }

    try {
      if (add !== null) await activitiesRepo.add({ horseId: horse.id, label: add });

      await eventsService.setDayActivity({
        horseId: horse.id,
        date: this.date,
        activity,
        existing: this.existing,
      });
    } catch (error: unknown) {
      this.error = error instanceof Error ? error.message : 'Enregistrement impossible.';
      return;
    }

    this.#close();
  };

  /**
   * Adds a typed activity to the catalogue, then applies it to the day.
   *
   * A label that already reads like a chip on screen selects that chip instead
   * of writing a second row — `matchActivity` compares what each choice
   * *reads* as, ignoring case and accents, so "carriere" finds "Carrière" and
   * "Trotting" finds the built-in `trotting`. Without it the sheet would grow a
   * duplicate every time someone typed rather than tapped.
   */
  #onSubmit = async (submitEvent: SubmitEvent) => {
    submitEvent.preventDefault();

    const result = readForm(submitEvent.target as HTMLFormElement, LABEL_SCHEMA);
    if (!result.ok) {
      this.error = result.errors.label ?? '';
      return;
    }

    const label = result.value.label;
    const known = matchActivity(label, this.#choices);

    await this.#apply(known ?? label, known ? null : label);
  };

  render() {
    const selected = this.existing?.activity ?? null;

    return html`
      <app-bottom-sheet
        heading=${formatDayShortMonth(this.date)}
        description="Activité du jour"
        .open=${this.open}
        @sheet-close=${this.#close}
      >
        <ul class="activity-sheet__chips">
          ${this.#choices.map(
            (activity) => html`
              <li>
                <app-chip
                  label=${formatWorkActivity(activity)}
                  ?selected=${activity === selected}
                  @click=${() => void this.#apply(activity)}
                ></app-chip>
              </li>
            `,
          )}
        </ul>

        <form class="activity-sheet__add" novalidate @submit=${this.#onSubmit}>
          <app-input
            class="activity-sheet__field"
            hide-label
            label="Nouvelle activité"
            name="label"
            maxlength=${MAX_LABEL}
            placeholder="Autre activité…"
          ></app-input>
          <button class="activity-sheet__submit pressable pressable--small" type="submit">
            <app-icon icon="check" aria-label="Ajouter l’activité"></app-icon>
          </button>
        </form>

        <div class="activity-sheet__error-region" role="alert" aria-live="assertive">
          ${this.error ? html`<p class="activity-sheet__error">${this.error}</p>` : nothing}
        </div>
      </app-bottom-sheet>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'activity-sheet': ActivitySheet;
  }
}
