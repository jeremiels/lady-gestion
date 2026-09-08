import type { HorseSex, RationUnit } from "../data/types.ts";

/**
 * French labels for the horse enums stored in `src/data/types.ts`.
 *
 * Storage keys stay short and stable (`'jument'`, `'kg'`); the wording shown
 * to the user lives here — the same split event types made before schema v6
 * turned them from a closed union into data (`EventTypeDef` in
 * `data/types.ts`), where the label lives on the row itself instead.
 */

export const HORSE_SEX_LABEL: Record<HorseSex, string> = {
  jument: "Jument",
  hongre: "Hongre",
  etalon: "Étalon",
};

export const RATION_UNIT_LABEL: Record<RationUnit, string> = {
  kg: "kg",
  g: "g",
  L: "L",
  mL: "mL",
  dose: "dose(s)",
  mesure: "mesure(s)",
};

/** `1.5` -> `1,5`. The French decimal comma, without a unit glued to it. */
export const formatRationAmount = (quantity: number): string =>
  quantity.toLocaleString("fr-FR");
