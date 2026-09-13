import type { UserProfile } from "./types.ts";

/**
 * The identity shown until the user saves one of their own on the
 * Personnaliser mon interface page (the `profiles` table, schema v12). Kept
 * so a device that upgraded from v11 looks exactly as it did before, and so
 * the day Google sign-in lands there is still one place to swap.
 *
 * A pure constant, not a repository, so importing it never pulls in `db.ts`
 * or the rest of the data layer.
 */
export const ACCOUNT = {
  firstName: "Léa",
  lastName: "Garnier",
  email: "lea.garnier44@gmail.com",
} as const;

export type DisplayProfile = {
  firstName: string;
  lastName: string;
  email: string;
};

/**
 * What the UI shows: the saved profile, or `ACCOUNT` when there is none yet
 * (including the tick before the query's first emission). The one place that
 * decides the fallback, so `ProfileView`, `HomeView` and the edit form agree.
 */
export const displayProfile = (
  profile: UserProfile | undefined,
): DisplayProfile =>
  profile
    ? {
        firstName: profile.firstName,
        lastName: profile.lastName ?? "",
        email: profile.email,
      }
    : { ...ACCOUNT };
