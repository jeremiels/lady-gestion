import { taxonomy, type TaxonomyMeta } from './taxonomy.ts';

// The event *record* lives in `src/data/types.ts` as `HorseEvent` (not
// `Event` — that name shadows the DOM global). This file owns only the
// category taxonomy and its presentation.

/**
 * Short, stable keys for event types. Use these in code and storage.
 */
export type EventTypeKey =
  | 'veto'
  | 'marechal'
  | 'dentiste'
  | 'osteo'
  | 'cours'
  | 'alimentation'
  | 'achat'
  | 'pension';

export const EVENT_TYPE_META: Record<EventTypeKey, TaxonomyMeta> = {
  veto: {
    label: 'Vétérinaire',
    icon: 'firstAidKit',
    theme: 'pink',
  },
  marechal: {
    label: 'Maréchal',
    icon: 'footprints',
    theme: 'green',
  },
  dentiste: {
    label: 'Dentiste',
    icon: 'tooth',
    theme: 'purple',
  },
  osteo: {
    label: 'Ostéopathe',
    icon: 'pawPrint',
    theme: 'orange',
  },
  cours: {
    label: 'Cours',
    icon: 'cowboyHat',
    theme: 'brown',
  },
  alimentation: {
    label: 'Alimentation',
    icon: 'carrot',
    theme: 'yellow',
  },
  achat: {
    label: 'Achats',
    icon: 'shoppingCart',
    theme: 'taupe',
  },
  pension: {
    label: 'Pension',
    icon: 'farm',
    theme: 'turquoise',
  },
};

/** `keys`, `label`, `icon` and `theme` for the table above — see `taxonomy.ts`. */
export const eventType = taxonomy(EVENT_TYPE_META);

export const EVENT_TYPES = eventType.keys;

/** Alphabetical by label — the order a filter list should offer them in. */
export const EVENT_TYPES_BY_LABEL = [...EVENT_TYPES].sort((a, b) =>
  eventType.label(a).localeCompare(eventType.label(b), 'fr'),
);

/**
 * Which set of fields the entry form shows for a given type.
 *
 * The three layouts differ by what the event *is*, not by category: a care
 * appointment has a practitioner and may repeat, a purchase has a merchant, and
 * lessons and boarding need neither.
 */
export type EventFormVariant = 'care' | 'activity' | 'purchase';

/**
 * The practitioner/merchant field: what to call it, which column of the record
 * holds it, and where the entry form draws it.
 *
 * `null` on a layout that has no such field at all, rather than an empty label
 * standing in for "absent" — otherwise every reader tests a string where it
 * means to test a concept.
 */
export type CounterpartyField = {
  label: string;
  column: 'providerName' | 'vendor';
  /** Care asks for the practitioner above the budget, a purchase for the merchant below it. */
  position: 'before-amount' | 'after-amount';
};

export type EventFormSpec = {
  counterparty: CounterpartyField | null;
  /** Whether this layout offers the repeat-appointment checkbox. */
  followUp: boolean;
};

/**
 * Everything that varies with the layout, in one table.
 *
 * Two files read it — `event-sheet.ts` to decide what to render and which column
 * to write, `EventDetailView.ts` to decide which row to show and what to call
 * it — so the label and the column are stated once and cannot disagree between
 * the form that captures a value and the card that displays it. Adding a fourth
 * layout is a row here rather than a hunt through both.
 */
export const EVENT_FORM_SPEC: Record<EventFormVariant, EventFormSpec> = {
  care: {
    counterparty: { label: 'Practicien', column: 'providerName', position: 'before-amount' },
    followUp: true,
  },
  activity: {
    counterparty: null,
    followUp: false,
  },
  purchase: {
    counterparty: { label: 'Site', column: 'vendor', position: 'after-amount' },
    followUp: false,
  },
};

/** Not exported: `eventFormSpec` below is the only way anything needs to read it. */
const EVENT_FORM_VARIANT: Record<EventTypeKey, EventFormVariant> = {
  veto: 'care',
  marechal: 'care',
  dentiste: 'care',
  osteo: 'care',
  cours: 'activity',
  pension: 'activity',
  alimentation: 'purchase',
  achat: 'purchase',
};

/**
 * The form layout a given event type uses.
 *
 * A function because it joins two tables — type to layout, layout to spec — the
 * same thing that makes `taxonomy.theme()` worth having and `taxonomy.label()`
 * barely so. A one-table lookup should just be indexed.
 */
export const eventFormSpec = (type: EventTypeKey): EventFormSpec =>
  EVENT_FORM_SPEC[EVENT_FORM_VARIANT[type]];
