import { isIsoDate, type IsoDate } from './dates.ts';
import { toCents } from './money.ts';

/**
 * Turning form input into valid record fields.
 *
 * This lives in `src/data/` rather than next to the components because that is
 * what it is: the last step before a value reaches a repository, and the place
 * every "how does a string become a stored field" decision belongs. Keeping it
 * here also puts it under the data-layer test rule, so the parsing is covered
 * without starting a component suite.
 *
 * The problem it solves is drift. The ration sheet used to hardcode five
 * product names in its markup and read four different keys out of `FormData`;
 * nothing connected the two, so saving wrote one unlabeled row and silently
 * dropped the rest. A schema makes the field list a single value that both the
 * reader and (via its keys) the caller work from.
 *
 *     const result = readForm(form, {
 *       title: text({ required: true }),
 *       date: isoDate({ required: true }),
 *       amountCents: cents(),
 *       seasonal: bool(),
 *     });
 *     if (!result.ok) return showErrors(result.errors);
 *     await eventsRepo.create({ ...result.value });
 *
 * Native constraint validation still runs first and covers every normal path —
 * these parsers exist for the paths that skip it, where a `NaN` written to
 * IndexedDB is permanent and renders as "NaN g" for the life of the record.
 */

/** Why a field was rejected. French, because it is shown to the user. */
export type FieldError = string;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: FieldError };

/**
 * Parses one raw `FormData` entry.
 *
 * A missing, unchecked or file-valued entry arrives as `null` — `FormData.get`
 * returns `null` for an absent name, and unchecked checkboxes never submit.
 */
export type FieldParser<T> = (raw: FormDataEntryValue | null) => ParseResult<T>;

const ok = <T>(value: T): ParseResult<T> => ({ ok: true, value });
const fail = (error: FieldError): ParseResult<never> => ({ ok: false, error });

/** `FormData` hands back `string | File`; every field here wants the string. */
const asString = (raw: FormDataEntryValue | null): string | null =>
  typeof raw === 'string' ? raw : null;

/**
 * Every parser below is overloaded on `required`.
 *
 * `required: true` narrows the result from `T | null` to `T`, so a caller that
 * marked a field required doesn't then have to null-check it — the promise the
 * option makes is one the type system keeps.
 */

export type TextOptions = { required?: boolean; maxLength?: number };

/** Trimmed text. `null` when blank and not required — never an empty string. */
export function text(options: TextOptions & { required: true }): FieldParser<string>;
export function text(options?: TextOptions): FieldParser<string | null>;
export function text(options: TextOptions = {}): FieldParser<string | null> {
  return (raw) => {
    const value = asString(raw)?.trim() ?? '';

    if (value === '') return options.required ? fail('Ce champ est requis.') : ok(null);
    if (options.maxLength !== undefined && value.length > options.maxLength) {
      return fail(`Ce champ ne peut pas dépasser ${options.maxLength} caractères.`);
    }
    return ok(value);
  };
}

export type NumberOptions = { required?: boolean; min?: number; max?: number };

/**
 * A decimal, accepting either separator.
 *
 * French keyboards produce `1,5` and French users type it. A `type="number"`
 * input would have rejected that before it ever got here — which is why numeric
 * fields in this app are `type="text"` + `inputmode="decimal"` + `pattern`, and
 * why normalising the comma is this function's job rather than the browser's.
 */
export function decimal(options: NumberOptions & { required: true }): FieldParser<number>;
export function decimal(options?: NumberOptions): FieldParser<number | null>;
export function decimal(options: NumberOptions = {}): FieldParser<number | null> {
  return (raw) => {
    const value = asString(raw)?.trim() ?? '';
    if (value === '') return options.required ? fail('Ce champ est requis.') : ok(null);

    const parsed = Number(value.replace(',', '.'));
    if (!Number.isFinite(parsed)) return fail('Saisissez un nombre valide.');
    if (options.min !== undefined && parsed < options.min) {
      return fail(`La valeur doit être supérieure ou égale à ${options.min}.`);
    }
    if (options.max !== undefined && parsed > options.max) {
      return fail(`La valeur doit être inférieure ou égale à ${options.max}.`);
    }
    return ok(parsed);
  };
}

/**
 * A money amount, stored as integer cents.
 *
 * Routes through `toCents` (`money.ts`) rather than parsing money a second way,
 * so there is one place that decides how `12,50` becomes `1250`.
 */
export function cents(options: { required: true }): FieldParser<number>;
export function cents(options?: { required?: boolean }): FieldParser<number | null>;
export function cents(options: { required?: boolean } = {}): FieldParser<number | null> {
  return (raw) => {
    const value = asString(raw)?.trim() ?? '';
    if (value === '') return options.required ? fail('Ce champ est requis.') : ok(null);

    const parsed = toCents(value);
    if (parsed === null) return fail('Saisissez un montant valide.');
    return ok(parsed);
  };
}

/**
 * A checkbox. Present means checked — an unchecked box submits nothing at all,
 * which is why this can never fail and never needs a `required`.
 */
export const bool = (): FieldParser<boolean> => (raw) => ok(raw !== null);

/** One of a fixed set — an `EventTypeKey`, a `RationUnit`, a status. */
export function oneOf<T extends string>(
  values: readonly T[],
  options: { required: true },
): FieldParser<T>;
export function oneOf<T extends string>(
  values: readonly T[],
  options?: { required?: boolean },
): FieldParser<T | null>;
export function oneOf<T extends string>(
  values: readonly T[],
  options: { required?: boolean } = {},
): FieldParser<T | null> {
  return (raw) => {
    const value = asString(raw)?.trim() ?? '';
    if (value === '') return options.required ? fail('Ce champ est requis.') : ok(null);

    return (values as readonly string[]).includes(value)
      ? ok(value as T)
      : fail('Sélectionnez une valeur dans la liste.');
  };
}

/** A calendar date, `YYYY-MM-DD` — the format `<input type="date">` submits. */
export function isoDate(options: { required: true }): FieldParser<IsoDate>;
export function isoDate(options?: { required?: boolean }): FieldParser<IsoDate | null>;
export function isoDate(options: { required?: boolean } = {}): FieldParser<IsoDate | null> {
  return (raw) => {
    const value = asString(raw)?.trim() ?? '';
    if (value === '') return options.required ? fail('Ce champ est requis.') : ok(null);

    return isIsoDate(value) ? ok(value) : fail('Saisissez une date valide.');
  };
}

export type FormSchema = Record<string, FieldParser<unknown>>;

/** The parsed shape a schema produces. */
export type FormValues<S extends FormSchema> = {
  [K in keyof S]: S[K] extends FieldParser<infer T> ? T : never;
};

export type FormResult<S extends FormSchema> =
  | { ok: true; value: FormValues<S> }
  | { ok: false; errors: Partial<Record<keyof S, FieldError>> };

/**
 * Reads a whole form against a schema.
 *
 * Every field is parsed even after one fails, so the user sees all the problems
 * at once rather than one per submit.
 *
 * `source` accepts a `FormData` directly — for a form whose field *names* are
 * generated (`quantity-<id>`), build the schema and the `FormData` from the
 * same list and there is no way for the two to disagree. See
 * `HorseView.#onRationSubmit`.
 */
export const readForm = <S extends FormSchema>(
  source: HTMLFormElement | FormData,
  schema: S,
): FormResult<S> => {
  const data = source instanceof FormData ? source : new FormData(source);

  const value = {} as Record<string, unknown>;
  const errors: Record<string, FieldError> = {};

  for (const [name, parse] of Object.entries(schema)) {
    const result = parse(data.get(name));
    if (result.ok) value[name] = result.value;
    else errors[name] = result.error;
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors: errors as Partial<Record<keyof S, FieldError>> }
    : { ok: true, value: value as FormValues<S> };
};
