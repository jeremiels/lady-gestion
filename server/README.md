# lady-gestion-push

The push scheduler behind "Créer une notification" on Cures and Traitements.
A Cloudflare Worker: `PUT /reminders` replaces a device's reminder list, and a
cron every minute sends what has fallen due over Web Push. It stores only what
each notification shows (title, one line, time, post id) until it is sent;
IndexedDB on the phone stays the source of truth.

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

Never regenerate the VAPID pair casually: every existing subscription is tied
to it, and the phone only resubscribes the next time the app is opened.

## Commands

|                     |                                                               |
| ------------------- | ------------------------------------------------------------- |
| `npm test`          | Encryption (RFC 8291 vector) and request parsing              |
| `npm run typecheck` | `tsc` against the Workers types                               |
| `npm run dev`       | Local Worker; `curl localhost:8787/__scheduled` runs the cron |
| `npm run deploy`    | Migrations, then deploy                                       |
