/**
 * There is no account model: no server, no sign-in, and nothing writes these.
 * They sit here as the one place to swap for real values the day Google
 * sign-in lands, rather than being spread through the templates that read
 * them — `ProfileView` for the full identity, `HomeView` for the avatar link
 * up to it. A pure constant, not a repository, so importing it never pulls in
 * `db.ts` or the rest of the data layer.
 */
export const ACCOUNT = {
  firstName: 'Léa',
  lastName: 'Garnier',
  email: 'lea.garnier44@gmail.com',
} as const;
