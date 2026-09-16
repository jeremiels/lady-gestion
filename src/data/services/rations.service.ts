import { decimal, oneOf, readForm, text, type FieldError } from "../forms.ts";
import * as rationsRepo from "../repositories/rations.repo.ts";
import {
  MONTH_NUMBERS,
  type MonthNumber,
  type RationSeason,
} from "../seasons.ts";
import type { RationItem, RationUnit } from "../types.ts";

/**
 * Reading the ration form back and writing it.
 *
 * One form (`ration-form`) serves both "Ajouter un produit" and the sheet that
 * edits a single line, so both writes parse through `parseRationForm` and
 * cannot disagree on what a valid line is.
 *
 * See `posts.service.ts` for what a service is here and the rules one follows.
 */

/**
 * The units the "Ajouter un produit" form offers.
 *
 * A subset of `RationUnit`, not a replacement: `dose` and `mesure` stay valid in
 * storage and keep rendering on the lines that already use them — they are just
 * not offered for a new one. No migration either way.
 */
export const RATION_FORM_UNITS: readonly RationUnit[] = ["mL", "g", "kg", "L"];

/** `ration-form`'s field names, read by its markup and by `parseRationForm`. */
export const RATION_ADD_FIELDS = {
  label: "label",
  quantity: "quantity",
  unit: "unit",
  seasonFrom: "seasonFrom",
  seasonTo: "seasonTo",
} as const;

export type RationAddField = keyof typeof RATION_ADD_FIELDS;

/** Long enough for "CMV Minéral Oligovit Bio", short enough for one row. */
export const RATION_LABEL_MAX = 80;

const MONTH_VALUES = MONTH_NUMBERS.map(String);

const rationSchema = (units: readonly RationUnit[]) => ({
  [RATION_ADD_FIELDS.label]: text({
    required: true,
    maxLength: RATION_LABEL_MAX,
  }),
  [RATION_ADD_FIELDS.quantity]: decimal({ required: true, min: 0 }),
  [RATION_ADD_FIELDS.unit]: oneOf(units, { required: true }),
  [RATION_ADD_FIELDS.seasonFrom]: oneOf(MONTH_VALUES),
  [RATION_ADD_FIELDS.seasonTo]: oneOf(MONTH_VALUES),
});

type RationFields = Pick<RationItem, "label" | "quantity" | "unit" | "season">;

type RationErrors = Partial<Record<RationAddField, FieldError>>;

/**
 * The period is two optional months: both blank is a line fed all year
 * (`season: null`), both set is the window. One without the other is an error
 * on the blank one rather than a guess — defaulting the missing end would store
 * a window the user never picked.
 */
const parseRationForm = (
  source: HTMLFormElement | FormData,
  units: readonly RationUnit[],
): { ok: true; value: RationFields } | { ok: false; errors: RationErrors } => {
  const data = source instanceof FormData ? source : new FormData(source);
  const result = readForm(data, rationSchema(units));
  const errors: RationErrors = result.ok ? {} : { ...result.errors };

  // Checked on the raw values, not the parsed ones, so the pairing error shows
  // alongside every other problem rather than on the next submit.
  const blank = (name: string) => String(data.get(name) ?? "").trim() === "";
  const fromBlank = blank(RATION_ADD_FIELDS.seasonFrom);
  if (fromBlank !== blank(RATION_ADD_FIELDS.seasonTo)) {
    errors[fromBlank ? "seasonFrom" : "seasonTo"] ??= "Indiquez les deux mois.";
  }

  if (!result.ok || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  // Both are "1".."12" or both null by now — `oneOf(MONTH_VALUES)` and the
  // pairing check above let nothing else through.
  const { label, quantity, unit, seasonFrom, seasonTo } = result.value;
  const season: RationSeason | null =
    seasonFrom !== null && seasonTo !== null
      ? {
          from: Number(seasonFrom) as MonthNumber,
          to: Number(seasonTo) as MonthNumber,
        }
      : null;

  return { ok: true, value: { label, quantity, unit, season } };
};

export type RationAddResult =
  | { ok: true; item: RationItem }
  | { ok: false; errors: RationErrors };

/** Parses the "Ajouter un produit" form and appends the line to the horse's plan. */
export const addRation = async (
  horseId: string,
  source: HTMLFormElement | FormData,
): Promise<RationAddResult> => {
  const result = parseRationForm(source, RATION_FORM_UNITS);
  if (!result.ok) return result;

  const item = await rationsRepo.add({ horseId, ...result.value });
  return { ok: true, item };
};

export type RationUpdateResult =
  /** `saved` is false when nothing moved and nothing was written. */
  { ok: true; saved: boolean } | { ok: false; errors: RationErrors };

/**
 * Parses the edit sheet against the line that rendered it and writes it if
 * anything moved.
 *
 * The line's own unit is accepted even when the form no longer offers it for a
 * new product (`dose`, `mesure`), so editing an old line does not force a unit
 * change.
 *
 * **An unchanged submit writes nothing**, and that is not an optimisation.
 * `touch()` restamps `updatedAt`, and `clearUntouchedSeedData` (`seed.ts`)
 * tells a demo row from a real one by `createdAt === updatedAt` — re-saving an
 * untouched seeded line would make it look hand-entered and survive the next
 * backup restore, leaving the user with two feed plans.
 */
export const updateRation = async (
  ration: RationItem,
  source: HTMLFormElement | FormData,
): Promise<RationUpdateResult> => {
  const units = RATION_FORM_UNITS.includes(ration.unit)
    ? RATION_FORM_UNITS
    : [...RATION_FORM_UNITS, ration.unit];
  const result = parseRationForm(source, units);
  if (!result.ok) return result;

  const { label, quantity, unit, season } = result.value;
  const unchanged =
    label === ration.label &&
    quantity === ration.quantity &&
    unit === ration.unit &&
    season?.from === ration.season?.from &&
    season?.to === ration.season?.to;
  if (unchanged) return { ok: true, saved: false };

  await rationsRepo.update(ration.id, { label, quantity, unit, season });
  return { ok: true, saved: true };
};
