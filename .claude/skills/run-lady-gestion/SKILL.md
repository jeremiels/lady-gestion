---
name: run-lady-gestion
description: Build, run, and drive lady-gestion — the horse-management PWA. Use when asked to start the app, screenshot a view, click through the UI, verify a component actually renders, seed test data, run the tests, or check the offline/service-worker behaviour.
---

A mobile-first, offline-first PWA: **Lit 3 web components + Vite**, no backend,
all data in **IndexedDB** behind `src/data/`. French UI throughout.

Drive it with `.claude/skills/run-lady-gestion/driver.mjs` — a stdin REPL over
headless Chromium that starts the dev server itself. It exists because two
things make ad-hoc Playwright scripts painful here: nearly every component
renders into **shadow DOM**, and the only way to change app state is to write
to IndexedDB through the repositories.

All paths below are relative to the repo root.

## Prerequisites

Node ≥ 20.12 (`package.json` `engines`); this container has v24.8.0. **No
`apt-get` needed** — the Playwright browser binaries are already in
`~/.cache/ms-playwright/`.

The driver installs the `playwright` npm package on first run into
`~/.cache/lady-gestion-run/`, deliberately **outside** the repo: this project
keeps its devDependencies thin (see the `sharp` note in `AGENTS.md`) and a
200 KB app should not carry a browser automation dep. Nothing to do by hand.

```bash
npm install
```

## Run (agent path)

Pipe commands in. The driver starts `npm run dev` if nothing is on the port,
and kills it on `quit`.

```bash
node .claude/skills/run-lady-gestion/driver.mjs <<'EOF'
nav /events
wait app-calendar .calendar__day
$ app-calendar .calendar__day--today
ss today
errors
quit
EOF
```

Screenshots land in `/tmp/lady-shots/` (override with `SHOTS=`), numbered in
order: `01-today.png`. Point the driver at another port with `PORT=4173`.

| command | what it does |
|---|---|
| `nav <path>` | Takes an **app path**, the one `app-root.ts` matches: `/`, `/events`, `/budget`, `/horse`, `/horse/<id>`, `/event/<id>`, `/documents`, `/profile`. The driver puts Vite's `base` back on the front — see the gotcha below |
| `wait <selector>` | `waitForSelector`, 15s cap. Selectors pierce shadow DOM |
| `click <selector>` | Click first match, then wait for transitions |
| `fill <selector> \| <value>` | Type into a field. The `\|` is required — selectors here contain spaces |
| `press <key> [n]` | Keyboard press, optionally repeated — `press ArrowLeft 20` |
| `focus <selector>` | Focus an element (works inside shadow roots) |
| `viewport <w> <h>` | Resize — default is 393×852 |
| `ss [name]` | Screenshot to `/tmp/lady-shots/NN-name.png` |
| `$ <selector>` | **Describe every match**: tag, text, class, `aria-label`, computed bg/color. The main inspection tool — works inside shadow DOM |
| `eval <js>` | Raw page JS, result as JSON. Does *not* pierce shadow DOM |
| `seed <js>` | Run JS with the app's data layer in scope as `data` — see below |
| `errors` | Console errors + page exceptions collected so far |
| `route` | Current URL |
| `quit` | Close browser, stop the dev server it started |

### Seeding state

`seed` imports `/src/data/index.ts` **inside the page** and awaits
`initData()`, so writes go through the real repositories and every `LiveQuery`
re-renders exactly as it would in the app — no reload needed. This is the only
sane way to get the app into a specific state.

```bash
node .claude/skills/run-lady-gestion/driver.mjs <<'EOF'
nav /events
wait app-calendar .calendar__day
seed const h = await data.horsesRepo.getActive(); await data.eventsRepo.create({ horseId: h.id, type: 'veto', title: 'Contrôle œil', date: data.todayISO(), time: null, status: 'planned', amountCents: 10000, currency: 'EUR', providerName: null, location: null, notes: 'Une note', recurrenceId: null }); return 'created';
wait event-card
$ event-card .event-card__title
ss seeded
quit
EOF
```

Only works against `npm run dev` — the production build has no `/src/**` to
import.

### Interactive (tmux)

For step-by-step debugging. Poll for `driver ready` rather than sleeping —
first launch also installs Playwright.

```bash
tmux new-session -d -s lady -x 200 -y 50 -c /home/skzc/code/lady-gestion
tmux send-keys -t lady 'node .claude/skills/run-lady-gestion/driver.mjs' Enter
timeout 90 bash -c 'until tmux capture-pane -t lady -p | grep -q "driver ready"; do sleep 0.3; done'
tmux send-keys -t lady 'nav /events' Enter
tmux send-keys -t lady 'wait app-calendar .calendar__day' Enter
tmux capture-pane -t lady -p | tail -20
```

Stop with `tmux kill-session -t lady`, then free the port (see Troubleshooting).

## Run (human path)

```bash
npm run dev    # → http://localhost:5173, Ctrl-C to stop
```

## Test

```bash
npm test              # both projects: 43 files, 618 tests, ~11s
npm run test:data     # 20 files, 379 tests, ~2s
npm run test:components   # 23 files, 239 tests, ~11s
npm run typecheck
npm run build         # typecheck + lint + vite build
```

Two Vitest projects, declared in `vitest.config.ts`:

- **`data`** — `src/data/**/*.test.ts` in node, Dexie on `fake-indexeddb`.
- **`components`** — `src/components/**`, `src/views/**` and `src/commons/**`
  in a real headless Chromium via Playwright. The components are built on
  `ElementInternals`, `<dialog>.showModal()`, the top layer and CSS the engine
  has to actually resolve, so there is no jsdom option here.

`TZ` is pinned to `Europe/Paris` for both. The driver is *not* a substitute for
the component suite any more — reach for it to see a rendered page, to
screenshot one, or to drive a flow across views, and write a test for anything
a `components` test can assert.

## Production / PWA

There is **no service worker under `npm run dev`** (the Vite plugin is
`apply: 'build'`, plus an `import.meta.env.PROD` guard). To exercise offline
behaviour:

```bash
npm run build
npm run preview &
timeout 30 bash -c 'until curl -sf http://localhost:4173/lady-gestion/ >/dev/null; do sleep 0.5; done'
PORT=4173 node .claude/skills/run-lady-gestion/driver.mjs <<'EOF'
nav /events
eval navigator.serviceWorker.getRegistrations().then(r => r.length)
eval caches.keys()
quit
EOF
lsof -ti:4173 -sTCP:LISTEN | xargs -r kill
```

Verified output: `1` registration, one cache named `lady-gestion-<hash>`.

## Gotchas

- **Shadow DOM cuts both ways.** Playwright's CSS engine pierces open shadow
  roots, so `wait`/`click`/`$` take plain descendant selectors
  (`app-calendar .calendar__day`). `eval` runs raw `document` JS and does
  **not** — there you must walk it yourself:
  `document.querySelector('app-calendar').shadowRoot.querySelector(...)`.
  Prefer `$`.
- **`hasText` with a regex silently never matches.** Lit leaves newlines and
  indentation in `textContent`, and Playwright doesn't whitespace-normalize
  for regex matching, so `hasText: /^18$/` times out on a cell rendering
  `18`. Select on `aria-label` instead — every calendar day has a full one
  (`.calendar__day[aria-label^="18 août 2026"]`).
- **Screenshots catch CSS transitions mid-flight.** `.calendar__day` animates
  background and color over 0.15s; a screenshot taken right after a click
  shows a muddy taupe circle instead of the dark brown one, and
  `getComputedStyle` returns the interpolated value. The driver's `settle()`
  handles it — replicate it if you write a one-off script.
- **The dev server serves under Vite's `base`** (`/lady-gestion/`, because the
  app is a GitHub Pages project site), while the app's route table matches
  paths *without* it. `nav` and `seed` add the prefix for you — reading it out
  of `vite.config.ts`, so it cannot go stale — but a hand-rolled Playwright
  script has to add it itself. Getting it wrong is silent: Vite answers a
  path outside the base with its "did you mean to visit ...?" page, so the
  `goto` succeeds and only the first `waitForSelector` fails, 15s later.
  (Both servers do redirect a bare `/`, so a readiness probe on the origin
  still works.)
- **Seed data is relative to today.** `src/data/seed.ts` places its five
  events at today ±6, +19, −11, −34, −52 days, so which month has dots
  changes daily. Never hardcode a date in an assertion — use
  `data.todayISO()` inside `seed`, or select on `aria-label`.
- **Every driver run starts from a fresh IndexedDB.** A new browser context
  gets its own storage and re-seeds, so state does not carry between
  invocations. Anything a test needs must be created in the same run.
- **Locale and timezone are load-bearing**, and the driver pins both to
  `fr-FR` / `Europe/Paris`. The UI asserts French `Intl` output
  (`Août 2026`), and `src/data/dates.ts` builds calendar dates from *local*
  midnight — a UTC container shifts them by a day near midnight.
- **`playwright` must not become a project dependency.** The driver resolves
  it from `~/.cache/lady-gestion-run/`. Don't "fix" this by adding it to
  `package.json`.

## Troubleshooting

- **`TypeError: Cannot read properties of undefined (reading 'launch')`**:
  `playwright` is CommonJS, so `await import()` puts its exports on
  `.default`. The driver unwraps this; a hand-rolled script must too.
- **`sudo: a terminal is required to read the password` / `Failed to install
  browsers`**: from `npx playwright install --with-deps chromium`. Drop
  `--with-deps` — it needs root and the shared libraries are already present.
  Plain `npx playwright install chromium` works.
- **`locator.evaluateAll` returns `undefined`**: it was passed a stringified
  function. Pass a real function — Playwright serializes it — and it will not
  error, just silently yield nothing.
- **Dev server won't start / port busy**: a previous run leaked it. `npm run
  dev` is spawned via npm, which doesn't forward SIGTERM, so kill the
  listener:
  ```bash
  lsof -ti:5173 -sTCP:LISTEN | xargs -r kill
  ```
- **`unknown command: <x>`**: the driver prints the full command list next to
  the error.
