import { isoDate, oneOf, readForm, text, type FieldError } from "../forms.ts";
import { todayISO } from "../dates.ts";
import * as horsesRepo from "../repositories/horses.repo.ts";
import type { Horse, HorseSex, RecordPatch } from "../types.ts";

/**
 * Reading the horse's record card back — Personnaliser mon interface › Cheval —
 * and writing what actually changed.
 *
 * See `events.service.ts` for what a service is here and the rules one follows.
 */

/** The form's field names, read by `customize-horse`'s markup and the schema. */
export const HORSE_FIELDS = {
  sex: "sex",
  birthDate: "birthDate",
  breed: "breed",
  sireNumber: "sireNumber",
  coat: "coat",
  damName: "damName",
  sireName: "sireName",
} as const;

export type HorseField = keyof typeof HORSE_FIELDS;

export const HORSE_SEXES: readonly HorseSex[] = ["jument", "hongre", "etalon"];

/** Long enough for "Vaza de Roc O Cerf" and its longer cousins. */
export const HORSE_TEXT_MAX = 80;

const SCHEMA = {
  [HORSE_FIELDS.sex]: oneOf(HORSE_SEXES, { required: true }),
  [HORSE_FIELDS.birthDate]: isoDate(),
  [HORSE_FIELDS.breed]: text({ maxLength: HORSE_TEXT_MAX }),
  [HORSE_FIELDS.sireNumber]: text({ maxLength: 20 }),
  [HORSE_FIELDS.coat]: text({ maxLength: HORSE_TEXT_MAX }),
  [HORSE_FIELDS.damName]: text({ maxLength: HORSE_TEXT_MAX }),
  [HORSE_FIELDS.sireName]: text({ maxLength: HORSE_TEXT_MAX }),
};

export type HorseProfileResult =
  /** `saved` is false when nothing moved, and nothing was written. */
  | { ok: true; saved: boolean }
  | { ok: false; errors: Partial<Record<HorseField, FieldError>> };

/**
 * Parses the card against the horse that rendered it and writes the fields that
 * moved, in one patch.
 *
 * **An unchanged submit writes nothing**, for the same reason
 * `saveRationSheet` skips untouched lines: `touch()` restamps `updatedAt`, and
 * `clearUntouchedSeedData` recognises the demo horse by
 * `createdAt === updatedAt`. Pressing Enregistrer on an untouched card would
 * otherwise keep the demo Ladympala alive through the next backup restore.
 *
 * Blank text reads as `null` — "unknown", which the horse page shows as "—" —
 * never as an empty string.
 */
export const saveHorseProfile = async (
  horse: Horse,
  source: HTMLFormElement | FormData,
): Promise<HorseProfileResult> => {
  const result = readForm(source, SCHEMA);
  const errors: Partial<Record<HorseField, FieldError>> = result.ok
    ? {}
    : { ...result.errors };

  // Lexicographic comparison is exact on `YYYY-MM-DD`.
  if (
    result.ok &&
    result.value.birthDate &&
    result.value.birthDate > todayISO()
  ) {
    errors.birthDate = "La date de naissance ne peut pas être dans le futur.";
  }

  if (!result.ok || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const patch: RecordPatch<Horse> = {};
  for (const key of Object.keys(HORSE_FIELDS) as HorseField[]) {
    const value = result.value[key];
    if (value !== horse[key]) Object.assign(patch, { [key]: value });
  }

  if (Object.keys(patch).length === 0) return { ok: true, saved: false };

  await horsesRepo.update(horse.id, patch);
  return { ok: true, saved: true };
};
