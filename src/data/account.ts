import type { UserProfile } from "./types.ts";

export type DisplayProfile = {
  firstName: string;
  lastName: string;
  email: string;
};

/**
 * What the UI shows: the saved profile, or a blank identity when there is none
 * yet (including the tick before the query's first emission). The one place
 * that decides the fallback, so `ProfileView`, `HomeView` and the edit form
 * agree.
 *
 * A pure function, not a repository, so importing it never pulls in `db.ts`
 * or the rest of the data layer.
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
    : { firstName: "", lastName: "", email: "" };
