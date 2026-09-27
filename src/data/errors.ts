/**
 * An error whose message is written for the user, in French, and shown as is.
 *
 * Everything else — a Dexie or `DOMException` message, a `TypeError` — is a
 * developer's sentence in English, and `errorMessage` replaces it.
 */
export class UserFacingError extends Error {
  override name = "UserFacingError";
}

const STORAGE_FULL =
  "Le stockage de l’appareil est plein. Libérez de l’espace puis réessayez.";

/**
 * The message to show for a failed action: a `UserFacingError`'s own, a full
 * storage named as such, and `fallback` for anything else.
 *
 * Dexie reports a full storage as its own `QuotaExceededError`, or wraps the
 * browser's `DOMException` as `inner`, so both names are looked at.
 */
export const errorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof UserFacingError) return error.message;
  const failure = error as
    | { name?: unknown; inner?: { name?: unknown } }
    | null
    | undefined;
  if (
    failure?.name === "QuotaExceededError" ||
    failure?.inner?.name === "QuotaExceededError"
  ) {
    return STORAGE_FULL;
  }
  return fallback;
};
