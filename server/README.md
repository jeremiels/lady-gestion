# lady-gestion-push

lady-gestion's server, a Cloudflare Worker with two jobs:

- **Push reminders** behind "Créer une notification" on Cures and
  Traitements: `PUT /reminders` replaces a device's reminder list, and a cron
  every minute sends what has fallen due over Web Push. It stores only what
  each notification shows (title, one line, time, post id) until it is sent;
  IndexedDB on the phone stays the source of truth.
- **Google Drive sign-in** (`src/drive-auth.ts`, `docs/drive-spec.md` §7.2):
  it holds the refresh token, encrypted, and hands the app one-hour access
  tokens. Files go between the phone and Drive directly, never through here.

Free plan limits cover it by a wide margin: one cron a minute is 1,440
invocations a day against 100,000, and one D1 row per device.

## One-time setup

From this folder, logged in to a Cloudflare account (`npx wrangler login`):

1. `npm install`
2. `npx wrangler d1 create lady-gestion-push` — copy the printed
   `database_id` into `wrangler.toml`.
3. `npm run vapid` — prints a key pair.
   - `npx wrangler secret put VAPID_PRIVATE_KEY`, and paste the JSON line.
   - Put the public key in `VAPID_PUBLIC_KEY`, `src/pwa/push-config.ts`.
4. `npm run deploy` — applies `migrations/` and deploys. Put the printed
   `https://lady-gestion-push.<account>.workers.dev` URL in `PUSH_API_URL`,
   `src/pwa/push-config.ts`.
5. For deploys from GitHub (the `deploy-push` job in `.github/workflows/ci.yml`),
   add two repository secrets: `CLOUDFLARE_API_TOKEN` (a token from the
   "Edit Cloudflare Workers" template, plus D1 edit) and
   `CLOUDFLARE_ACCOUNT_ID`.

### Google Drive sign-in

On <https://console.cloud.google.com>, in the project that holds the
consent screen (already set up for the lot 0 spike):

1. **Google Auth Platform → Clients → Créer un client**, type **Application
   Web**, redirect URI
   `https://lady-gestion-push.<account>.workers.dev/auth/google/callback`.
2. Put the client ID in `GOOGLE_CLIENT_ID`, `wrangler.toml`.
3. `npx wrangler secret put GOOGLE_CLIENT_SECRET`, and paste the secret.
4. `openssl rand -base64 32 | npx wrangler secret put DRIVE_SECRET`. Changing
   it later signs every device out of Drive, nothing more.
5. `npm run deploy` applies `migrations/0002_drive.sql`.

The consent screen has to be **published** (in production, not in test):
in test, Google expires refresh tokens after seven days.

Never regenerate the VAPID pair casually: every existing subscription is tied
to it, and the phone only resubscribes the next time the app is opened.

## Commands

|                     |                                                               |
| ------------------- | ------------------------------------------------------------- |
| `npm test`          | Encryption (RFC 8291 vector), request parsing, Drive crypto   |
| `npm run typecheck` | `tsc` against the Workers types                               |
| `npm run dev`       | Local Worker; `curl localhost:8787/__scheduled` runs the cron |
| `npm run deploy`    | Migrations, then deploy                                       |
