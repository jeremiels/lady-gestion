/**
 * Where push reminders are scheduled, and the key that proves they came from
 * there. Both are public by design — the private half of the VAPID pair is a
 * secret of the Worker in `server/`, never of this bundle — so they are
 * committed rather than read from an ignored `.env`.
 *
 * `server/README.md` says how to generate the key pair and where the URL
 * comes from. While either is empty, ticking "Créer une notification"
 * reports push as unavailable and nothing is sent.
 */
export const PUSH_API_URL: string =
  "https://lady-gestion-push.jeremie-ls.workers.dev";

/** The VAPID public key, base64url — `npm run vapid` in `server/` prints it. */
export const VAPID_PUBLIC_KEY: string =
  "BGJEbXB9x3gmJnbs0OtTu1whMEK7K-hMSLxxo_B3dYKjyjPQzSawwrhezGcnuxPRMX14g4qzkU1J1QwM06efUB4";
