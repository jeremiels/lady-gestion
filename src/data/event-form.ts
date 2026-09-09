import {
  bool,
  cents,
  decimal,
  isoDate,
  oneOf,
  text,
  type FormSchema,
} from "./forms.ts";
import type { CustomFieldDef } from "./types.ts";

/**
 * Turning a type's own `fields` into a form, and its answers back into the
 * scalars a record holds.
 *
 * In `src/data/` for the reason `forms.ts` gives for being here: this is the
 * last step before a value reaches a repository, which puts it under the
 * data-layer test rule rather than only reachable by driving a real form in a
 * real browser. `event-sheet.ts` renders the controls these describe; nothing
 * here touches the DOM.
 *
 * Everything below reads `control` and the modifiers beside it, never a field
 * id or a semantic kind. That is the whole point: a type can declare an input
 * this module has never been told about, and it is parsed, folded and stored
 * like any other.
 */

/** The unit control's name, derived so no caller spells it. */
export const unitNameOf = (field: CustomFieldDef): string => `${field.id}-unit`;

/**
 * Every control one field draws, outermost first.
 *
 * A field is usually one control. Two modifiers add a second: `units` puts a
 * unit picker beside the value, and `reveals` hangs further fields off a
 * checkbox. Both still store a single scalar under the parent's own id.
 */
export const controlsOf = (field: CustomFieldDef): string[] => [
  field.id,
  ...(field.units ? [unitNameOf(field)] : []),
  ...(field.reveals ?? []).flatMap(controlsOf),
];

/** The parser for one control, from its `control` and `required`. */
const parserOf = (field: CustomFieldDef) => {
  switch (field.control) {
    case "checkbox":
      return bool();
    case "money":
      return field.required ? cents({ required: true }) : cents();
    case "number":
      // Never `required` on its own: a value and its unit are required
      // *together*, which only the pair can decide (`pairErrorsOf` below).
      return field.units
        ? decimal({ min: 0 })
        : field.required
          ? decimal({ required: true, min: 0 })
          : decimal({ min: 0 });
    case "date":
      return field.required ? isoDate({ required: true }) : isoDate();
    case "select":
      return field.required
        ? oneOf(
            (field.options ?? []).map((option) => option.value),
            { required: true },
          )
        : oneOf((field.options ?? []).map((option) => option.value));
    case "combobox":
    case "text":
      // `combobox` parses as free text, not against its options: it exists so
      // the user can name something the catalogue has never seen, and a
      // closed-list parser would refuse the very entry it is there to allow.
      return field.required
        ? text({ required: true, maxLength: 120 })
        : text({ maxLength: 120 });
  }
};

/**
 * How one of a type's fields is parsed — the per-type half of the schema.
 *
 * A revealed field is only in the DOM while its checkbox is ticked, so it is
 * declared here as optional whatever it says about itself; the checkbox is
 * what decides whether its answer counts, and `valueOf` reads it that way.
 */
export const fieldSchema = (field: CustomFieldDef): FormSchema => ({
  [field.id]: parserOf(field),
  ...(field.units
    ? { [unitNameOf(field)]: oneOf([...field.units]) }
    : undefined),
  ...Object.assign(
    {},
    ...(field.reveals ?? []).map((child) =>
      fieldSchema({ ...child, required: false }),
    ),
  ),
});

/**
 * One field's parsed controls, folded into the single scalar the record holds.
 *
 * `customFields` values have to survive a JSON round trip through a backup
 * file, so the two compound shapes collapse rather than nest: a `units` field
 * stores `"40 mL"`, and a `reveals` checkbox stores what it revealed — or
 * `null` when it was left unticked.
 */
export const valueOf = (
  field: CustomFieldDef,
  values: Record<string, unknown>,
): string | number | boolean | null => {
  const raw = values[field.id];

  if (field.reveals?.length) {
    if (raw !== true) return null;
    for (const child of field.reveals) {
      const value = valueOf(child, values);
      if (value !== null && value !== "") return value;
    }
    return null;
  }

  if (field.units) {
    const unit = values[unitNameOf(field)];
    return typeof raw === "number" && typeof unit === "string"
      ? `${raw.toLocaleString("fr-FR")} ${unit}`
      : null;
  }

  // A field with a closed list only ever stores one of its own options — an
  // unrecognised value is `null` rather than a guess. This is what the
  // follow-up's bespoke `parseFollowUpValue` round trip used to guarantee for
  // that one field; stated over `options`, it holds for every field that has
  // them, including one restored from a backup written by another build.
  if (field.options && typeof raw === "string") {
    return field.options.some((option) => option.value === raw) ? raw : null;
  }

  return raw === undefined || raw === ""
    ? null
    : (raw as string | number | boolean);
};

/**
 * A `units` field's two controls are required together — one without the other
 * is the error, and neither alone is. Keyed by control name so the caller does
 * not spell either.
 */
export const pairErrorsOf = (
  field: CustomFieldDef,
  values: Record<string, unknown>,
): Record<string, string> => {
  if (!field.units) return {};

  const amount = values[field.id];
  const unit = values[unitNameOf(field)];
  const hasAmount = typeof amount === "number";
  const hasUnit = typeof unit === "string" && unit !== "";

  if (hasAmount === hasUnit) return {};
  return hasAmount
    ? { [unitNameOf(field)]: "Choisissez une unité." }
    : { [field.id]: "Indiquez une quantité." };
};

/** Splits a stored `units` scalar back into its amount and unit for prefill. */
export const splitUnitValue = (
  stored: unknown,
): { amount: string; unit: string } => {
  if (typeof stored !== "string") return { amount: "", unit: "" };
  const match = /^(.+)\s(\S+)$/.exec(stored);
  return match
    ? { amount: match[1]!.replace(",", "."), unit: match[2]! }
    : { amount: "", unit: "" };
};
