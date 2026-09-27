import type { Horse } from "./types.ts";

/**
 * The horse's name as the app shows it in full — prénom, then nom when there
 * is one. Places short on room (the dashboard's "Suivi de …") use
 * `firstName` alone.
 */
export const horseFullName = (
  horse: Pick<Horse, "firstName" | "lastName">,
): string => [horse.firstName, horse.lastName].filter(Boolean).join(" ");
