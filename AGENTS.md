Be concise

# lady-gestion

A mobile-first web app for managing a horse (care, events, documents,
budget). French UI copy throughout (e.g. "Ration quotidienne",
"Identité", "Accueil").

## Browser floor

**Safari 18.2 / Chrome 134 / Firefox 137**, and everything here may assume it.

Write this down before reaching for a new platform feature: it is the only
thing that makes "can we use X?" a lookup rather than an argument. The floor is
not arbitrary — it covers everything that already ships unguarded:
`ElementInternals` and `:state()`, form-associated custom elements,
`@starting-style`, `transition-behavior: allow-discrete`, `subgrid`,
`content-visibility`, the Popover API and `@container`. The binding one is
`content-visibility`, at Safari 18.0; 18.2 is a deliberate margin over that,
not a computed minimum.

Three consequences worth stating out loud:

- **Feature-detect whatever the floor does not guarantee**, and say why in a
  comment. Four things are guarded today, and they are not all the same case.
  `document.startViewTransition` and view-transition **types** sit at or below
  the floor, and are guarded only because the two halves shipped separately.
  The Navigation API sits **above** it, on two engines out of three: Safari did
  not ship it until **26.2**, Firefox until **147**. (18.2 is
  `:active-view-transition-type()` — a different feature, and the source of a
  long-standing mix-up here.) Only Chrome has it at the floor, so
  `'navigation' in window` is a live seam rather than a legacy one: every iPhone
  below iOS 26.2 takes the fallback today, which means real page loads, no route
  view transitions at all, and no persisted view state. **CSS anchor
  positioning** is above the floor on the same two engines — Chrome 125, but
  Safari **26** and Firefox **147** — so the sliding background behind the
  selected segment of `app-segmented` sits entirely inside
  `@supports (anchor-name: --sliding-selection)` in
  `commons/sliding-selection.styles.ts`. What a browser without it loses is the
  travel, not the state: the plain background swap that control has always had
  is exactly the unguarded rule. Guarding what the floor already guarantees is
  still dead code.
- **Some tempting APIs are still above the floor.** Checked, and deliberately
  not used: `<dialog closedby>` (no Safari support at all — it would drop
  light-dismiss on the primary platform, and `ModalDialog` handles backdrop and
  Esc itself), `Temporal` (Safari stable has not shipped it; `data/dates.ts` is
  written as the seam for the day it does), and `URLPattern` (Baseline, but it
  needs Safari 26 — adopting it in the route table would turn today's graceful
  degradation into a white screen on exactly the browsers `goBack` still
  supports).
- **`overlay` is used unguarded and no Safari supports it.** The
  `transition: overlay … allow-discrete` in `app-modal` and `app-bottom-sheet`
  is Chromium-only, still absent in Safari 26.x. Entry animations are fine —
  they ride `@starting-style` — but the _exit_ never plays on iOS, because the
  dialog leaves the top layer the instant `close()` runs. Accepted for now;
  fixing it means holding `open` until `transitionend` and closing from there.

## Stack

- **Lit 3** (web components) + **TypeScript** + **Vite**. No React, Vue,
  Svelte, Angular, or Stencil.
- **Vendor chunks are pinned in `vite.config.ts` (`output.codeSplitting`).** Not
  a size optimisation — it is what makes the service worker's per-file
  `revision` manifest pay off. Left to itself, the bundler hoists shared modules
  into the most-depended-on app chunk and had picked `app-icon`, so Lit and
  Dexie shared one content hash (49.6 kB gzip) with the icon set and editing a
  single glyph re-downloaded both libraries on every installed device. Splitting
  by package means a chunk's hash only moves when that package does. The icons
  have since left the bundle entirely (see the sprite below), which removes the
  other half of that problem. Add a `{ name, test }`
  entry to `vendorChunks` for a new runtime dependency big enough to matter. The
  option is `output.codeSplitting`: Vite 8 bundles with Rolldown, where both
  `manualChunks` and `advancedChunks` survive only as deprecated shims that warn
  on every build.
- **Three runtime dependencies: `lit`, `dexie`, `d3-shape`.** The last is the
  submodule, deliberately, not `d3`: `pie()` and `arc()` are the whole of what
  `app-donut-chart` needs, and the full bundle is ~90 kB gzip of scales, axes,
  geo, force and dsv going into an offline precache to draw eight wedges. Reach
  for another `d3-*` submodule before reaching for `d3`.
- No router library — `app-root.ts` intercepts navigation itself via the
  Navigation API (`navigation.addEventListener('navigate', ...)`) and
  swaps views with `document.startViewTransition`. Routes live in a `ROUTES`
  table whose `render(path)` receives the matched pathname — that is how
  `/events/:id` gets its id to `EventDetailView`, and nothing else parses the
  URL. A parameterised route **must** wrap its view in `keyed(path, ...)`:
  `LiveQuery` subscribes once in `hostConnected` and re-runs only on a Dexie
  write, so without it, going from one event's page to another reuses the
  element and leaves the previous record on screen.
- **To go back, call `goBack(fallback)` from `commons/navigation.ts`** — never
  hand-roll it. It asks the Navigation API, not `history.length`:
  `navigation.currentEntry.index > 0` means there is a previous _same-origin_
  entry, whereas `history.length` counts entries from before the app loaded and
  reads 2 on a genuinely cold start, so a bare `history.back()` walks off the
  app. Measured, not theoretical: the service worker answers any path with the
  cached shell, so a shared link to one event opens with no app history behind
  it, and `/budget` loaded cold reports `index: 0, history.length: 2`. That
  module also owns `navigateTo(path)`, which falls back to `location.href`
  where the Navigation API is missing.
- **A view's UI state lives on the history entry, via `ViewState`
  (`commons/controllers/view-state.ts`).** `app-root` renders a different
  template per route, so lit-html discards a view's element on the way out and
  builds a fresh one on the way back — which is why the calendar/list mode, the
  type chip, the selected day and the budget period used to reset on Retour,
  and why `goBack`'s promise ("returning from the list lands on the list") was
  only half true. `navigation.updateCurrentEntry({ state })` is per-entry, so a
  nav-bar tap pushes a new entry and correctly opens at the defaults, and it
  survives a reload for free. **Never persist it with `history.replaceState()`**:
  where the Navigation API exists that fires a `navigate` event, which `Router`
  intercepts — a chip tap would run a whole view transition.
- **`/budget` is a drill-down, not a section**: it has no nav item, is reached
  by tapping the dashboard's `budget-card`, and Accueil stays lit while it is
  open (the `SECTIONS` table's `matches` predicates in `app-root`, which
  `isHorsePath` feeds), the same way Calendrier stays lit on an
  event's own page.
- No state management library and no store. Reactivity comes from
  `LiveQuery` (`src/data/live.ts`), a Lit `ReactiveController` wrapping
  Dexie's `liveQuery` — see "Data layer" below.
- **Dexie / IndexedDB** is the persistence layer (`src/data/`). No
  localStorage, no fetch/API calls, no backend. `HorseView`, `EventsView`,
  every view now reads real data. The one **deliberate** exception is
  `ProfileView`'s account block (`ACCOUNT` at the top of the file): there is no
  sign-in and no user record, so the name, email, masked password and the
  "Se déconnecter"/"Supprimer mon compte" buttons are a mock kept until Google
  sign-in lands. Don't "fix" it piecemeal.
- Events are **created** from `event-sheet`, opened by the `+` in the nav bar
  (which is a button, not a link — it opens a sheet, it does not navigate), and
  **edited** through the same sheet: setting its `event` property prefills the
  fields and switches the submit to `update`. One sheet, deliberately — a second
  form would be a second place for the variant rules to drift.
  Deleting is `EventDetailView` → `app-modal` → the soft delete.
- **Documents still have no upload path.** `seed.ts` writes exactly one — a PDF
  it generates itself, attached to the seeded "Contrôle œil" event — so the
  detail page's attachment block, viewer and share action have something real to
  act on. It is generated rather than shipped under `src/assets/` because a
  binary would be bundled into every production build for demo data the first
  restore deletes. Its xref offsets are computed, and that only works because
  the content is pure ASCII: **keep accents out of the PDF text**.
- **`Télécharger` on the event detail page is a deliberate mock**, like
  `ProfileView`'s account block: it means "download from the Drive", and Drive
  sync does not exist. The bytes _are_ local, so if it should instead save the
  file from IndexedDB, `downloadBackup` in `backup/snapshot.ts` is the existing
  anchor-plus-`download` pattern to copy.
- **Every form goes through `readForm()` (`src/data/forms.ts`).** It takes a
  schema of field parsers (`text`, `decimal`, `cents`, `bool`, `oneOf`,
  `isoDate`) and returns `{ ok, value } | { ok: false, errors }`, with
  every field parsed so the user sees all the problems at once. It lives in
  `src/data/` because it is the last step before a value reaches a repository —
  which also puts the parsing under the data-layer test rule.
- **Build the schema and the field names from the same array.** For a form over
  a list of records, name fields from record ids (`quantity-<id>`) and generate
  the schema from that same list; then the markup and its reader cannot drift.
  `rationsService` is the reference: `rationFieldNames(id)` is called by the
  markup that renders each control _and_ by the schema that parses it back, so
  neither half spells a name. The version before any of it hardcoded five
  product names and read four different keys, and saving wrote one unlabeled row
  and dropped the rest.
- **Skip unchanged rows rather than re-saving them.** `touch()` restamps
  `updatedAt`, and `clearUntouchedSeedData` tells demo rows from real ones by
  `createdAt === updatedAt` — a blanket save makes the whole seed look
  hand-entered and survive the next restore.
- **A new record table goes in `RECORD_TABLES` (`db.ts`) and nowhere else.**
  The backup export, the restore merge, the snapshot validator, the
  `BackupSnapshot['tables']` type and `clearUntouchedSeedData` all read that one
  object, so adding a table reaches every whole-database operation at once. They
  used to be five hand-written copies of the same four names, where the one you
  missed failed silently — a table absent from the export is data that quietly
  does not survive a restore. `documentBlobs` and `meta` stay out of the list on
  purpose (blobs travel separately, `meta` is device-local); `documents` still
  drops its matching `documentBlobs` row in the same transaction — the pairing
  `documentsRepo.remove` keeps — or the bytes are stranded with nothing
  pointing at them and no way to reclaim the space.
- **Numeric fields are `type="text"` + `inputmode="decimal"` + `pattern`, not
  `type="number"`.** A number input holds a locale-independent value, so a
  French user typing `1,5` hands back an empty string and their edit vanishes
  with no message. `decimal()` and `cents()` accept either separator.
- Every parser is **overloaded on `required`**: `text({ required: true })`
  returns `FieldParser<string>`, not `FieldParser<string | null>`, so a caller
  that marked a field required doesn't then have to null-check it.
- **`event-sheet` shows one of four field layouts**, chosen from the type
  select at the top via `eventFormSpec(type)` (`event.types.ts`): `care`
  (véto/maréchal/dentiste/ostéo) adds Practicien and the follow-up interval;
  `purchase` (alimentation/achat) adds Site; `work` (travail) adds the Activité
  select; `plain` (cours/pension) adds none of it. **Everything that varies with
  the layout lives in `EVENT_FORM_SPEC`, one table** — the counterparty's label,
  the record column it is stored in, where the form draws it, whether a
  follow-up is offered and whether an activity is asked for. Read it; never
  re-test the layout with `=== 'care'` at a call site. The column matters as
  much as the label: a field the current layout doesn't show must never reach
  the record, so `providerName`, `vendor` and `activity` are written from the
  spec rather than from whatever the DOM still holds. `EventDetailView` reads
  the same table to label its Practicien/Site row, which is what keeps what is
  captured and what is displayed from drifting.

  `activity` is also the one field whose _parser_ varies: it is required on
  `work` and absent everywhere else, so `event-sheet` swaps in the required
  overload of `oneOf` for that layout rather than copying "Ce champ est requis."
  out of `forms.ts`. The schema's shape is the same either way.

- **`HorseEvent.status` is derived, never asked for**: `statusForDate()` in
  `events.ts` — a future date is `planned`, today or past is `done`. None of the
  entry forms has a status control because the date already says which is meant.
- Scripts: `npm run dev` (Vite), `npm run build` (typecheck + lint +
  `vite build` — a lint error fails the build), `npm run typecheck`,
  `npm run lint` (oxlint), `npm test` (Vitest, both projects),
  `npm run test:data` / `npm run test:components` (one project),
  `npm run test:watch`, `npm run preview`, `npm run icons`.
- **TypeScript is strict**, including `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. Two configs: `tsconfig.json` for `src`
  (browser types only) and `tsconfig.node.json` for `vite.config.ts` /
  `vitest.config.ts` (Node types). The split keeps `NodeJS.Timeout` and
  `Buffer` from leaking into app code.

## Structure

```
src/
  app-root.ts          # shell: nav bar + view switch, light DOM
  commons/
    base-element.ts    # BaseElement (shadow DOM) + LightElement (page shells)
    controllers/       # reactive controllers — router, form-control,
                       #   modal-dialog, media-query, view-state
    navigation.ts      # goBack()/navigateTo() — never hand-roll history
    scroll-lock.ts     # the page lock ModalDialog holds while a dialog shows
    reset.styles.ts     # component-reset.css + component-utilities.css as Lit css`` tags
    field-parts.ts      # shared hint/error markup + styles for the form fields
    form-field-element.ts # FormFieldElement — base for app-input/select/checkbox
    dialog-element.ts   # DialogElement — base for app-bottom-sheet/app-modal
  components/           # reusable + domain components, one folder each
  views/                 # top-level routed views (*View.ts)
  styles/
    main.css             # declares @layer order, imports everything
    layers/              # one file per top-level cascade layer, plus
                         #   component-reset.css — the subset of reset.css that
                         #   can match inside a shadow root, and
                         #   component-utilities.css — utility classes, imported
                         #   by main.css into the utilities layer AND adopted
                         #   into every shadow root by reset.styles.ts.
    tokens/               # color.css, spacing.css, radius.css, typography.css
    components/, views/   # per-component / per-view CSS, in matching sub-layers
  theme/                 # ThemeKey -> {color, backgroundColor} (var(--color-theme-*))
  types/                  # e.g. event.types.ts (EventTypeKey -> {label, icon, theme})
  assets/icons/           # raw SVGs; built into /icons.svg by vite/icon-sprite.ts
  data/                   # persistence — see below
  pwa/                    # service worker + registration — see below
vite/                     # build plugins (icon-sprite.ts)
scripts/                  # one-off tooling, not part of the build
vite.config.ts            # plugins: the icon sprite, then the service worker emitter
```

## Data layer

```
src/data/
  index.ts             # public surface: initData(), repos, LiveQuery, backup
  db.ts                # Dexie subclass + SCHEMA_VERSION (4) and its upgrades
  types.ts             # BaseRecord, Horse, HorseEvent, StoredDocument, RationItem
  record.ts owner.ts   # createRecord/touch/softDelete; ownerId resolution
  ids.ts dates.ts money.ts
  files.ts             # file size/kind formatting, PDF & image mime predicates
  budget.ts          # period/breakdown arithmetic for BudgetView — see below
  forms.ts             # readForm() + field parsers — the write path's front door
  events.ts            # event rules that are neither persistence nor iCalendar
  seasons.ts           # RationSeason: recurring annual windows — see below
  icalendar.ts         # RFC 5545 boundary — see below
  live.ts              # LiveQuery ReactiveController
  active-horse.ts      # activeHorseQuery() — the standard view-level query
  ready.ts             # gate opened when initData() settles — see below
  repositories/        # horses|events|documents|rations|meta.repo.ts
  services/            # write-side commands — events|rations.service.ts
  backup/snapshot.ts   # versioned export/import envelope
  seed.ts              # first-run data, only when no horse exists
```

- **`src/data/index.ts` re-exports whole modules, never a hand-picked list.**
  The list version drifted exactly as one does — it ended up with two separate
  `export { … } from './dates.ts'` blocks and three re-export conventions in one
  file. A module is either public surface or it is not; `db.ts`, `ready.ts`,
  `record.ts`, `ids.ts`, `owner.ts` and `seed.ts` are not.
- **A presentational component wanting only a formatter imports the module
  directly**, not the barrel — `event-card` takes `formatDate` from `dates.ts`,
  `app-calendar` takes `monthGrid` from `icalendar.ts`. That is the chunking
  working, not drift: `initData` pulls `db.ts`, which constructs
  `new LadyGestionDb()` at module scope, so going through the barrel for a pure
  function drags Dexie and the seed into that component's chunk. Reach for
  `data/index.ts` when you need a repository, a `LiveQuery` or the backup; reach
  past it for arithmetic.
- **`dexie` is imported by `src/data/db.ts` only.** Views and components go
  through repositories, which take and return plain domain objects. That
  boundary is what makes swapping IndexedDB for a hosted database later a
  change to five repository files instead of a rewrite. Don't call
  `db.*` outside `src/data/`.
- **`services/` holds writes, never reads.** A repository reads and writes one
  table; a service owns a write that spans more than one decision or more than
  one table, as plain functions over plain objects with no state of its own.
  Two today. `eventsService.saveEvent()` decides which column a counterparty
  lands in, whether a follow-up or an activity may be written at all, and what
  an edit carries over from the record it replaces.
  `rationsService.saveRationSheet()` reads the whole feed plan back and writes
  only the lines that moved, and owns the generated field names both halves of
  that round trip depend on. Both lived in a submit handler — one in
  `event-sheet.ts`, one in `HorseView` — which put the definition of a record
  inside a dialog and left every one of those rules reachable only from the
  browser suite; they are record arithmetic and belong under the data-layer test
  rule. Reads do **not** get a service — a `LiveQuery` over a repository is
  already the right shape, and a layer in between is only something for Dexie's
  reactivity to see through. Two rules follow from the no-state one: never hold
  a cached copy of anything (Dexie is the store, per `live.ts`), and never call
  a service from inside a `LiveQuery` callback — a command that runs in a live
  query re-triggers the query that ran it. `backup/snapshot.ts` is the same kind
  of module and predates the folder.
- Call `initData()` once (already done in `app-root.ts`) before anything
  writes — it opens the DB, resolves `ownerId` and seeds first-run data.
  `createRecord` throws if it hasn't run.
- **`LiveQuery` does not subscribe until `initData()` has settled** — the gate is
  `ready.ts`, and `initData` opens it in a `finally` so a failed init releases
  the waiters instead of hanging every view on a loading state. This is not
  belt-and-braces; it fixes a bug that reproduced on 5 of 5 first loads. Views
  used to mount and query while the seed was still writing, and every query here
  starts with "which horse is active?", so on a first run they took the no-horse
  branch and returned early **without ever reading `events`** — and a table a
  query never read is a table Dexie has no reason to re-run it for. The seeded
  rows landed, nothing re-fired, and the view stayed empty until a manual
  reload. A query whose read set depends on data that does not exist yet is the
  general shape of this trap; the gate removes it by making the first run always
  see a finished database. Waiting costs one settled-promise tick after the
  first run, and `hostConnected` subscribes synchronously once the gate is open.
- **A view queries the active horse's data through `activeHorseQuery()`
  (`src/data/active-horse.ts`), not by building a `LiveQuery` by hand.** It
  resolves the active horse, runs the callback with its id when there is one,
  and returns the `empty` value when there is not:

  ```ts
  activeHorseQuery(this, (horseId) => eventsRepo.listByHorse(horseId), []);
  ```

  **Pass `empty` deliberately, and give it the same shape the query returns.**
  A view can mount before the seed has finished, so `getActive()` legitimately
  resolves `undefined`; a mismatched empty value forces a second branch into
  the render. Five views use this — reach for it rather than reopening the
  resolve-then-query dance, which is where the four-line copies used to drift.
  Each call deliberately re-resolves the horse rather than sharing one lookup:
  Dexie re-runs a `liveQuery` only for tables it actually read, so a query that
  never touched `horses` would not notice the active horse changing.

- **`resetDb()` opens that gate too.** It stands in for `initData()` in the
  tests, and standing in for it means standing in for all of it.
- Every record carries `id` (client UUID), `ownerId`, `createdAt`,
  `updatedAt` and a nullable `deletedAt`. **Deletes are soft** — a row that
  is simply gone can't be propagated to a backup or another device. All
  repository reads filter it out via `liveOnly()` in `record.ts`.
- **`deletedAt` and `amountCents` are deliberately not indexed**: IndexedDB
  drops records whose indexed value is `null` out of the index entirely, so
  an index on either would hide every live row. They're filtered in memory.
- **Dates are strings, never `Date`.** Calendar dates are `YYYY-MM-DD`
  (`IsoDate`), timestamps are ISO 8601 UTC (`IsoTimestamp`). Both sort
  lexicographically, which is what the range indexes rely on. Helpers live
  in `dates.ts`; use `todayISO()`, not `new Date().toISOString()`, which
  shifts to UTC.
- **Money is integer cents** (`amountCents`), never a float. Format with
  `formatCents()` from `money.ts`.
- `events` is one unified table: an appointment is a future `date`, an
  budget is a non-null `amountCents`. Don't add a separate budget table.
  `events.type` is the existing `EventTypeKey`.
- **`budget.ts` holds the budget view's arithmetic as pure functions over
  records the caller already fetched** — it is money maths, which is what the
  data-layer test rule exists for. A period there is a **date prefix**
  (`2026-01`, `2026`), not a start/end pair: stored dates are the same
  `YYYY-MM-DD` strings, so a prefix test is exact and cannot drift across a
  timezone. `eventsRepo.totalSpentByType` delegates to its `sumByType`, so the
  repository and the view cannot disagree about what a breakdown is. `sumByType`
  returns slices in fixed `EVENT_TYPES` order and drops zero-spend categories —
  the fixed order is what keeps a category, and therefore its colour and its
  neighbours, in the same place in the donut from one month to the next.
- **`BudgetView` reads every budget and filters in memory**, and that is
  forced, not lazy: `LiveQuery` subscribes once and Dexie re-runs it only on a
  _write_, so a query narrowed by the user-selected period would go stale the
  moment the picker was touched. `EventsView` does the same for the same reason.
  Its two period keys (`monthKey`, `yearKey`) are held separately rather than
  derived from each other, so flipping to Année and back returns to the month
  that was selected — both of them, and `EventsView`'s four, now live in a
  `ViewState` bag rather than in `@state()` fields, so they survive a drill-down
  too.
- **The dashboard's week strip is two pure functions plus a card**: `weekGrid`
  (`icalendar.ts`) returns the seven days of a week as a _tuple_, so a caller
  reading the first and last day for a range query needs no `!` under
  `noUncheckedIndexedAccess` — `monthGrid` builds its rows from the same helper.
  `workActivityByDate` (`events.ts`) buckets `travail` rows into one activity per
  day, skipping cancelled ones and keeping the day's first session (all-day
  before timed), so a cell's height never depends on how much the horse did.
- **`icalendar.ts` is the one place that speaks RFC 5545**, the format
  Google/Apple/Outlook calendars exchange. It maps a `HorseEvent` onto a
  `VEVENT`-shaped `CalendarEvent` (`DTSTART` as a `DATE` when `time` is
  `null`, exclusive `DTEND`, `STATUS`, `WKST`) and owns `monthGrid()` and
  `occurrencesByDate()`. The stored record deliberately stays as it is; put
  `RRULE` expansion or an `.ics` export here rather than in a component.
  A calendar's dots and its day list must read the _same_
  `occurrencesByDate()` result, or the two will disagree about a day.
- **Seasonality is a window, not a flag.** `RationItem.season` is
  `{ from, to } | null` (month numbers, 1 = January, both ends inclusive,
  `null` = fed all year). `to` may be _before_ `from` — the plan's real window
  is October→April, which wraps the year — so never compare `from`/`to`
  directly; go through `isInSeason()` in `seasons.ts`. That module also owns
  `formatSeasonRange()` (`Oct. → Avr.`), `formatSuspensionRange()` and
  `summariseSuspension()`, which builds the "2 produits saisonniers suspendus
  …" footnote. A view that renders both rows and the footnote must resolve
  `todayISO()` once and pass it to both, or the two can disagree across
  midnight.
- `HorseEvent.vendor` is the shop or website behind a purchase, distinct from
  `providerName` (the practitioner) and `location` (a place). `followUpInterval`
  is `{ amount, unit }` — how long until a care event repeats. **Ticking
  "Planifier un rendez-vous" records the interval and creates no second event**;
  nothing derives a date from it yet, which is what reminders will add.
  `activity` is a `WorkActivity` key (`events.ts`) — what was done in a
  `travail` session, from a closed list with French labels, `null` on every
  other type.
- **Bumping `SCHEMA_VERSION` means writing two migrations that agree**: a
  `this.version(n).upgrade()` in `db.ts` for databases already on a device, and
  a step in `migrateSnapshot()` (`backup/snapshot.ts`) for backup files written
  by an older build. `assertSnapshot` accepts any older `schemaVersion`, so
  without the second one an old file imports rows the current build silently
  misreads. `db.test.ts` covers the upgrade against a database really written
  by the previous version — keep its `V1_STORES` frozen.
- Age is derived from `Horse.birthDate` via `ageInYears()` — never stored.
- Components stay presentational and take data as properties
  (`horse-card` takes `.horse`); the owning view holds the `LiveQuery`.
- **A taxonomy's accessors come from `taxonomy()` (`src/types/taxonomy.ts`)**,
  not hand-written. `eventType` and `documentCategory` are each one call over
  their `*_META` table and expose `.keys`, `.label(k)`, `.icon(k)`, `.theme(k)`.
  `EVENT_TYPES` and `DOCUMENT_CATEGORIES` are `.keys`, so a category added to the
  table cannot be missing from the list. There is no `getThemeMeta` — read
  `THEME_META[key]`, which is all it ever was.

No component registry/barrel file. A component is used by importing its
file for the side effect (`import '../components/foo/foo.ts'`), which
runs its `@customElement(...)` decorator.

**Never put a backtick inside an HTML comment in a `html\`...\`` template.**
It closes the template literal, and the errors point at whatever line the
parser gave up on rather than the comment. Write component and file names bare
in those comments. An HTML comment also cannot sit _inside_ an opening tag,
between attributes — put it on the line above the element.

**SVG fragments need Lit's `svg\`\``tag, not`html\`\``.** A nested template is
parsed on its own, in HTML context, so a `<path>`returned from a helper comes
out as an`HTMLUnknownElement`in the wrong namespace. It then has a valid`d`,
resolves its `fill`correctly, reports the right computed style — and draws
nothing, with a zero-size bounding box and no error anywhere.`app-donut-chart`hit exactly this. Only markup written inline inside the same`html`template as
its`<svg>` is safe.

## Backend migration readiness

Persistence is local-only today: Dexie/IndexedDB, offline-first, no network
calls anywhere in the app. The data layer was nonetheless built so that
swapping it for a hosted backend later is a bounded change, not a rewrite.
What's already in place:

- **The repository boundary is real and enforced.** `dexie` is imported only
  inside `src/data/`; views and components go through the `src/data/index.ts`
  barrel and only ever see plain domain objects. Nothing outside `src/data/`
  references `db`, `dexie`, or `Table`.
- **IDs are UUID v4** (`ids.ts`), not Dexie auto-increment integers, so
  foreign keys (`horseId`, `eventId`, …) survive a move to server-assigned
  records.
- **`BaseRecord` already carries `ownerId`, `createdAt`/`updatedAt`, and a
  soft-delete `deletedAt`** (`types.ts`) — put there so adopting a real
  account id later is a data update, not a schema migration.
- **The backup format doubles as a future sync payload.** `BackupSnapshot`
  (`backup/snapshot.ts`) is versioned JSON that merges idempotently,
  last-write-wins by `updatedAt`. A comment there says it's meant to become
  the payload pushed to Google Drive's hidden appDataFolder. `meta`'s
  `googleAccount`/`driveFolderId` and `StoredDocument`'s
  `driveFileId`/`driveSyncedAt` are unused placeholders for that path.
- **Reads and writes already flow through a narrow set of seams**: reads via
  `LiveQuery`/`activeHorseQuery` (`live.ts`, `active-horse.ts`), multi-table
  writes via `*.service.ts` rather than raw repo calls. Presentational leaf
  components (`horse-card`, `event-card`, `day-card`, `budget-card`) never
  touch data at all — it arrives as properties.

Watch these before an actual swap — none are bugs at IndexedDB latency, all
would surface under real network latency:

- **`LiveQuery` leans on Dexie's automatic table-dependency tracking**
  (`live.ts`) — a query re-runs only when a table it read was written. A
  REST-polling or WebSocket backend has no such thing for free and would need
  to reimplement it. The swap is at least contained: no consumer calls
  `liveQuery` directly, only `LiveQuery`.
- **Loading almost always collapses into empty.** Most consumers do
  `.value ?? []`/`?? {}` instead of branching on `LiveQuery.loading` (only
  `EventDetailView` and `HorseView` do). Fine when reads are near-instant;
  would flash false-empty state otherwise.
- **`LiveQuery.error` is never read** past the initial `initData()` failure
  in `app-root.ts`. A read that fails after startup has no UI path today.
- **No pending/disabled state on writes.** `event-sheet.ts` and
  `activity-sheet.ts` await their service call without disabling the submit
  control, so double-submit risk grows with latency.
- **`ProfileView`'s `metaRepo.setNotificationsEnabled` call is `void`**
  fire-and-forget and ignores rejection.
- **`activity-sheet.ts`'s add-activity + apply-to-day is two independent
  writes, not one transaction** (documented at the call site) — would need
  real atomicity or compensation against a networked backend.

## Component conventions

- Extend `BaseElement` (`src/commons/base-element.ts`), and declare
  `static componentStyles = css\`...\``instead of`static styles`—`BaseElement.styles` auto-prepends the shared reset and appends the utilities.

  An intermediate base class for a _family_ of components sets
  `static sharedStyles` instead, which lands between the reset and
  `componentStyles` so a member can still override it. `FormFieldElement` and
  `DialogElement` both do. **Never override `static styles` to add to it**:
  `BaseElement.styles` reads `this.componentStyles`, so calling it with `this`
  bound to `BaseElement` silently drops every subclass's own rules and nothing
  type-checks it.

- **Cross-cutting behaviour goes in a reactive controller**, under
  `src/commons/controllers/` (and `LiveQuery` in `src/data/live.ts`, which
  predates the directory). Existing ones: `FormControl` (ElementInternals and
  the validity mirror), `ModalDialog` (`<dialog>` + `showModal()` machinery),
  `MediaQuery` (a media query as reactive state), `ViewState` (a view's UI
  state, kept on the history entry — see the Stack note above). The rule of thumb is Lit's
  own: a controller for logic that composes and needs the update lifecycle;
  leave it on the component when it is the element's _public API_ or one of the
  browser-called `form*Callback` hooks, neither of which a controller can
  receive. That boundary is why `FormControl` deliberately absorbs only half of
  a form field.
- **Never read a media query inline.** `matchMedia(q).matches` in a method
  samples the answer once and never hears about it again — that is how the
  donut chart came to check `prefers-reduced-motion` only when its data
  happened to change. Hold a `MediaQuery` controller instead.
- **Shadow DOM is the default** and every component uses it. Only the page
  shells render into **light DOM**, and they get it by extending
  **`LightElement` (`commons/base-element.ts`)** rather than repeating a
  `createRenderRoot()` override: `app-root.ts` and every `views/*View.ts`.
  The _only_ reason to opt out is that their CSS lives in `styles/views/*.css`
  and has to sit in the `views` cascade layer, which a shadow root puts out of
  reach. Note `LightElement` extends `LitElement`, not `BaseElement`, and that
  is deliberate — Lit only adopts `static styles` into a shadow root, so
  inheriting the reset and utilities there would promise something untrue.
- A component that needs a colour from `THEME_META` reads it through a **custom
  property**, which pierces shadow boundaries. `app-tag` used to render light
  and depend on global `.tag--<type>` rules, which forced `event-card` light and
  therefore every view too; it now sets `--app-tag-color`/`--app-tag-background`
  from `tagStyle(eventType.theme(key))`, and `styles/components/tag.css` is
  gone. Don't
  reintroduce a global stylesheet for a component's own colours.
- Sizing a shadow component _from_ a light-DOM parent works — a rule on the host
  beats the component's own `:host` declarations. But **size the glyph, not the
  host**, when a component carries its own padding: `.nav-item__icon` set
  `width: 1.25rem` on an `app-icon` whose `:host` has 8px of padding, leaving a
  4px content box and rendering every nav icon as a sliver. Set `--icon-size`.
- Naming: generic reusable components are prefixed `app-` (`app-input`,
  `app-select`, `app-checkbox`, `app-icon`, `app-tag`,
  `app-bottom-sheet`, `app-folder`). Domain-specific components use a
  plain descriptive name (`horse-card`, `budget-card`, `nav-bar`).
- **Form fields extend `FormFieldElement` (`commons/form-field-element.ts`)**,
  which is the whole of a form-associated custom element except the value.
  `static formAssociated`, `delegatesFocus`, the six shared properties, the
  three `@state()` flags, the `checkValidity()`/`reportValidity()`/`validity`/
  `form` quartet, `formDisabledCallback`, `formResetCallback`, the
  `FormControl` instance and the update lifecycle all live there.

  **A new field type implements four members and nothing else**: `control` (the
  native element in its shadow root), `formValue` (what it contributes to
  `FormData` — `null` submits nothing), `captureDefault`/`restoreDefault` (the
  pristine value a reset returns to), and `formStateRestoreCallback`, which is
  the one place the _argument_ has to be read differently. Plus its template and
  its styles. See `app-input.ts`, `app-select.ts`, `app-checkbox.ts` — each is
  now about fifteen lines of class body around a render method.

  **Do not re-add a `changed.has(...)` guard around `setFormValue`/`sync`.** The
  base runs both unconditionally from `updated()`. Both are idempotent and Lit's
  setters no-op on an unchanged value, so the guard bought nothing and cost the
  bug where a new property is added and nobody lists it — which is exactly what
  had happened: `disabled` was in none of the three guards, so `sync()` never ran
  against a disabled control and never hit the `setValidity()` TypeError waiting
  there. `FormControl.sync()` now returns early for a disabled control.

  Ids and message wiring come from the base too: `this.fieldId` is minted once
  from a single shared counter, and `this.messages` gives `{ hintId, errorId,
message }` for `fieldMessages()` and `describedBy()`.

  `commons/controllers/form-control.ts` still owns the `ElementInternals` half —
  `attachInternals()`, the `invalid` listener, `setFormValue()`, `sync()` and
  `setExternalError()`. It is what `FormFieldElement` holds; components do not
  construct one.

  `app-switch` keeps the form association but uses no `FormControl`: a switch is
  always in one of its two valid states, so there is nothing to report and
  nothing to sync.

  Note `checkValidity()` fires a platform `invalid` event on an invalid element,
  which the controller treats as "the user has had their chance" — so it reveals
  the error UI. Use `validity` directly for a genuinely silent read. Pinned by a
  test in `app-input.test.ts`.

- BEM-ish class naming (`field`, `field__label`, `field__input`,
  `dialog__header`, ...), plus `part="..."` attributes on key internal
  elements so consumers can style through the shadow boundary
  (`::part(...)`), matching `app-input`/`app-select`.
- Private class fields use `#`. For label/aria wiring a form field inherits
  `this.fieldId` from `FormFieldElement`; any other component that needs a
  unique id uses a module-level `let nextId = 0` counter (`app-switch` is the
  remaining example).
- End every reusable component file with:
  ```ts
  declare global {
    interface HTMLElementTagNameMap {
      "app-foo": AppFoo;
    }
  }
  ```
- **A form control's native `change` never reaches its consumer; its `input`
  does.** Per UI Events, `change` is `composed: false`, so it stops at the
  component's shadow boundary and a `@change` binding on `<app-select>`
  silently never fires. Every field re-dispatches a composed custom event
  instead — `select-change`, `checkbox-change`, `switch-change`,
  `segment-change` — and that is what to listen for. A new field type must do
  the same or it will look inert.

  **`input` is `composed: true`** and crosses the boundary on its own, which is
  why `EventsView`'s search box binds `@input` straight onto `<app-input>` and
  works, with no re-dispatch anywhere in `app-input`. Don't "fix" that by
  adding an `input-change` event, and don't assume the two events behave alike:
  they don't, and the difference is in the spec, not in this codebase.

- Custom events follow the shape `app-bottom-sheet` introduced with
  `sheet-open`/`sheet-close`: `{ bubbles: true, composed: true }`, a
  lowercase-hyphenated name, and a `detail` object carrying the new value (or a
  `reason` when relevant).
- `app-input` draws a card behind its label by default. `flat` drops it, for a
  surface that already provides one — the ration sheet wants a card per product,
  the event sheet lays its fields straight onto the sheet background.
- **Two dialog primitives, both native `<dialog>` + `showModal()`.**
  `app-bottom-sheet` is for a _task_ (a form to fill in); `app-modal` is for an
  _answer_ that blocks everything else, above all a delete confirm. The shared
  mechanics live in `commons/controllers/modal-dialog.ts`: a
  `#dialog = new ModalDialog(this, () => this.dialogEl, 'sheet')` drives
  `showModal`/`close` off the host's `open` from its own `hostUpdated` (so
  neither component needs an `updated()` for it), holds the page's scroll lock
  for as long as the dialog is showing, and dispatches the composed
  `<name>-open` / `<name>-close` pair. Bind
  `@click=${this.#dialog.onBackdropClick}`, `@cancel=${this.#dialog.onCancel}`
  and `@close=${this.#dialog.onNativeClose}` on the `<dialog>`.

  **Both extend `DialogElement` (`commons/dialog-element.ts`)**, which holds
  that controller plus everything the two used to copy: the `open`/`heading`/
  `description`/`dismissible` properties, `show()`/`close()`, `@query('dialog')`,
  the `::backdrop` transition, and `renderDialog({ part, className, leading })` —
  which draws the header (title, optional description, `dismissible`-gated close
  button), the body slot and the footer slot. `leading` is content before the
  header; only the sheet uses it, for its drag handle.

  The shared markup renders `dialog__header` / `dialog__title` / `dialog__close`
  / `dialog__body` / `dialog__footer`, and each component styles those names from
  its own stylesheet. The BEM prefix was the only thing that had forced two
  copies of identical markup; the `part=` names never differed, so `::part()`
  consumers were unaffected. Timing is parameterised on `--dialog-duration`,
  which a component sets on its own `:host` (the sheet slow, the modal medium).

  A third dialog primitive extends `DialogElement` and supplies its own
  `super(name)`, geometry and entry animation. What stays per-component is the
  `<dialog>`'s own layout and `@starting-style`, and anything genuinely its own —
  the sheet's drag-to-dismiss, `app-modal`'s `full-bleed` (which is how
  `document-viewer` reuses this machinery for media).

- **A component that mints an object URL owns revoking it.**
  `documentsRepo.getObjectUrl` hands the URL over and does not track it, so a
  missed `URL.revokeObjectURL` pins the whole file in memory for the session.
  `document-viewer` releases on close _and_ in `disconnectedCallback`, and
  discards a URL that arrived after the viewer was already closed — see the
  in-flight guard in its `#load`. Any new consumer must do the same.
- **Same rule for a `requestAnimationFrame` loop: cancel it in
  `disconnectedCallback`.** `app-donut-chart` is the one that runs one, and a
  view switch mid-sweep would otherwise leave it ticking against a detached
  tree. It also short-circuits on `prefers-reduced-motion: reduce` by setting
  its progress to 1 and never scheduling a frame — the global reduced-motion
  block in the reset only reaches CSS transitions, not JS animation.
- **`event-card` has three layouts** (`layout="default" | "dashboard" |
"budget"`), reflected so its styles can key off the attribute. `default` is
  everything; `dashboard` (HomeView) drops the notes, because a glance-list of
  three appointments should not carry a vet's paragraph; `budget`
  (BudgetView) moves the price out of the meta line into its own right-aligned
  cell prefixed with U+2212 and drops the notes too. Add a layout here rather
  than forking a second card.
- **`app-segmented`'s `icon` is optional** — a segment with no icon renders its
  `label` as text (`Mois | Année`), and `aria-label` is set only in icon mode,
  since visible text already _is_ the accessible name. `app-select` has a `pill`
  variant that hides the label visually and shrinks the control to the period
  picker's pill; it stays a real `<select>`, so the iPhone gives it the native
  wheel picker for free.
- **`day-card` has two styles and takes `today` as a property**, like
  `app-calendar` does — a card that read the clock itself could not be tested
  against a fixed week, and two of them could disagree across midnight. It is
  deliberately neither a link nor a button: the week strip is a glance, not a
  way through. `HomeView` holds the query and passes each day its activity.
- **A component that adapts to its width queries itself**, rather than being
  told. `event-card` sets `container-type: inline-size` on its own `:host` and
  reflows below `20rem` from an `@container` rule in its own stylesheet — no
  container has to be declared by whoever renders it, and no class describes
  where it sits. Safe there because the host is a block in a grid track, whose
  inline size comes from its containing block; **do not** give one to a
  content-sized host (`app-tag`, `app-chip`, `app-segmented` are all
  `inline-flex`), which the inline-size containment would collapse to nothing.

  This does **not** replace `event-card`'s `layout` attribute. Every list in the
  app is a single full-width column, so the card is exactly as wide on the
  dashboard as in the calendar — `layout` is an editorial choice about how much
  to say, which no measurement can stand in for. Reach for a container query
  when the thing that changed is genuinely the available room.

- **Anything that has to float above the app is a popover, not a `z-index`.**
  `showModal()` puts both dialog primitives in the top layer, which beats every
  `z-index` there is — `app-update-toast` used to sit at `z-index: 10` and was
  drawn behind the event sheet's backdrop, so the update prompt was invisible
  in exactly the case it mattered. It now uses `popover="manual"` (`manual`, not
  `auto`: a stray outside tap must not dismiss it). Undo the UA popover styles
  when you do this — centred `inset: 0` + `margin: auto`, a solid border, a
  Canvas background and `width: fit-content`.

  That rule is about beating a **dialog**, and the app has exactly one
  `z-index` in document CSS: `.navigation` (`views/main.css`) sits at
  `z-index: 1`. (A component may still use one privately inside its own shadow
  root — `app-calendar` puts its selection pill at `z-index: -1` — which is
  local to that tree and not what this rule is about.) It is not an
  exception to the rule — it must _not_ beat a dialog, and cannot, because
  `showModal()` uses the top layer. What it does is lift the fixed nav bar above
  the page content scrolling under it, which tree order alone does not
  guarantee: the bar is rendered _before_ `<main>` in `app-root`, so at
  `z-index: auto` anything in a view that forms a stacking context paints on top
  of it. `content-visibility: auto` on the event and budget rows does (it
  implies paint containment) and hid the bar completely; a `transform` or
  `opacity` animation would too. Reach for the top layer to float above the app;
  leave this one z-index alone.

- **A live region has to exist before its contents change, and `hidden` does not
  count as existing.** Rendering a fully-formed `role="status"` element into the
  DOM typically announces nothing — and `hidden` (like `display: none`) takes an
  element out of the accessibility tree, so unhiding one is the same insertion
  by another name. Keep the region mounted, unhidden and empty, and change what
  is _inside_ it: `app-update-toast`'s `.toast-region`, `event-sheet`'s
  `.event-form__error-region` and `EventDetailView`'s
  `.event-detail__error-region` are all `display: contents` wrappers that cost
  no layout while empty — which is what makes never hiding them affordable, even
  inside a `flex` column with a `gap`.
- **A field's error message is not a live region, and carries no role.**
  `commons/field-parts.ts` renders `[part="error"]` for all three fields —
  permanently, hidden with `?hidden` while empty — but with no `role="alert"`.
  The message reaches the user through `aria-describedby` + `aria-invalid` on
  the control, read on focus. An assertive region on every field fires on every
  blur, which is noise, and says nothing at all on the path that actually
  matters. `?hidden` is fine _here_ precisely because there is no live region to
  keep in the accessibility tree. A new field type renders
  `${fieldMessages(...)}` rather than copying the markup — `app-input`,
  `app-select` and `app-checkbox` had three verbatim copies of it once already.
- **Setting a field's `error` shows it — no reveal step, and none to copy.**
  A blur or the platform `invalid` event marks a field `touched`, which is what
  normally gates the message. An `error` set from outside is not waiting on the
  user's turn: it is the app stating a verdict, so
  `FormControl.setExternalError()` marks the field touched itself. That is the
  only reason a `novalidate` form works at all — and `event-sheet` is one, it
  has to be, because the reader in `data/forms.ts` owns the rules. Submitting it
  empty once did _nothing visible_: `readForm` produced every message, each
  reached its field as `error`, and not one was displayed.
  `event-sheet.test.ts` pins that, including a `maxLength` failure the browser
  itself considers valid — reveal must not route through native validity.
  All a form still owns is focus: `#focusFirstError()`. Never
  `reportValidity()`, which stacks the browser's own bubble on top of the
  message the field already renders.
- **`.container` is a wrapper, not a modifier.** Write
  `<div class="container"><ul class="meta-list">`, never both classes on one
  element: `.meta-list` zeroes its own padding and sits in a _later_
  `components` sub-layer, so it silently wins and the card loses its inset.
  `HorseView` and `ProfileView` already nest it this way.

## Styling / design tokens

- `src/styles/main.css` declares the layer order:
  `@layer reset, tokens, base, components, views, utilities;` — respect
  this order; new global CSS must be added inside the matching
  `@layer` file, not appended ad hoc. `views` sits **after** `components` so a
  view can adjust a shared component it hosts (the other way round,
  `.container`'s padding silently beat what `.ration-list` asked for on the
  same element), and `utilities` is last so a utility wins without
  `!important`.
- A class used by more than one view belongs in `styles/components/`, not in
  whichever view's stylesheet happened to define it first — `.meta-list` /
  `.meta-item` (label-left, value-right rows inside a `.container`) started
  in `views/horse.css` and moved out when `ProfileView` needed the same rows.
- Sub-layer `@layer a, b, c;` statements must appear **before** the `@import`s
  that create those layers — a layer already created by an import cannot be
  reordered afterwards. See `layers/views.css`.
- Tokens (all consumed as `var(--token-name)`, including inside shadow
  DOM — custom properties pierce shadow boundaries automatically):
  - Colors: `src/styles/tokens/color.css` — a raw scale
    (`--color-brown-0..9`, `--color-pink-1/2`, ...) and, below it, aliases that
    name a **role**: `--color-page`, `--color-divider`, `--color-danger`,
    `--color-text-muted`, `--color-disabled-surface/line/content`,
    `--color-surface-hover`, `--color-control-track`, `--color-brown-light/middle/dark`,
    and `--color-theme-<key>` / `--color-theme-<key>-background` per `ThemeKey`.
    **Never reach past the aliases into the scale.** Component and view CSS
    reads a role; only `color.css` names a scale position. 24 rules across 12
    files used to break that — two of them re-deriving a value an unused alias
    already held — which is what made a dark theme 12 files of hunting instead
    of one block of overrides. If no role fits, add one here rather than
    inlining the scale. `--color-danger` covers validation errors _and_
    destructive actions; it replaced a bare `#b3261e` repeated in four field
    components.
  - Spacing: `--spacing-2/4/6/8/12/16/20/24/32` (rem, 4px scale).
  - Radius: `--radius-2/4/6/8/12/16/24/32`, `--radius-pill: 999px`.
  - Typography: `--font-family-base` ("Inter"), `--font-size-base/lg/sm`,
    `--line-height-base`, `--font-color`. **Inter is self-hosted** from
    `public/fonts/` (latin subset only) — a remote font is never in the
    precache, so the app fell back to `sans-serif` offline.
  - Layout: `--nav-bar-height` (the fixed nav bar's height excluding the
    home-indicator inset). Anything that must clear the nav bar reads this
    rather than repeating the arithmetic. `--content-max-width` (40rem) is the
    readable column: `.main-content` and `nav-bar`'s items both read it, so the
    bar's items stay lined up with the content above them on a wide window.
    `.main-content` is deliberately **not** also a `container-type: inline-size`
    container — that implies `contain: layout`, and `HorseView` and
    `EventDetailView` render `<dialog>`-based components _inside_ `<main>`. Add
    it when a rule needs it, with a test on the sheet's geometry.
  - Shadow-root utilities: `.visually-hidden` lives in one file,
    `styles/layers/component-utilities.css` — `main.css` imports it straight
    into the `utilities` layer for the document, and `BaseElement` also adopts
    the same bytes (via `?inline`) _after_ a component's own styles, because a
    document `@layer` cannot cross a shadow boundary. Inside a shadow root
    component styles are unlayered and unlayered beats every layer — anything
    shipped in `component-reset.css` is the weakest rule in the tree — so last
    in source order is the "utilities win" available there. One file, not a
    pair to keep in step.

    Shared component CSS has a **second channel**, and the two are not
    interchangeable. `component-utilities.css` is for rules the document _and_
    every shadow root want — every `BaseElement` adopts them whether it uses
    them or not. A `commons/*.styles.ts` fragment is the opt-in one: a
    `CSSResult` a component composes into its own
    `static componentStyles = [fragment, css`…`]`, **first** in the array so the
    component still wins at equal specificity. `sliding-selection.styles.ts` is
    the one that exists — the background that travels to the selected item of a
    row, used by `app-segmented` and by `app-calendar`'s day grid, and wanted
    by nothing in the document. Its anchor name is tree-scoped, so a consumer
    has to hold both the row and the items in **one** shadow root: `nav-bar`
    cannot use it, because each `nav-item` is its own tree. `css` caches the result, so
    every consumer adopts the same `CSSStyleSheet` by reference, exactly as the
    reset does.

    **`reset.styles.ts` exports these as two separate values on purpose** —
    `resetStyles` and `utilityStyles` — and `BaseElement.styles` composes them
    as `[reset, shared, component, utilities]`. Do not merge the two exports
    or reorder that array: the ordering _is_ the mechanism, and collapsing it
    silently stops utilities winning inside every shadow root at once.

  - Motion: `src/styles/tokens/motion.css` — `--duration-fast` (0.15s,
    hover/selection feedback), `--duration-medium` (0.2s), `--duration-slow`
    (0.32s, the bottom sheet), plus `--easing-standard` and `--easing-sheet`.
    Use these rather than hardcoding a duration; the five components that did
    could drift apart with nothing flagging it.
  - **No shadow tokens exist** — components hardcode `box-shadow` inline; do the
    same unless you introduce one deliberately.
- To restyle a shadow component from a view, prefer a **custom property**
  hook over `::part`. `::part` rules come from the outer tree and beat the
  component's own — including its `:focus-visible`/`:state(invalid)` rules,
  which then silently stop working. `app-input` exposes
  `--app-input-background` and `--app-input-error-color` for exactly this;
  `::part(control)` is still right for something the component never varies
  itself, like `border-radius`.
- `src/theme/theme.ts` (`ThemeKey` -> `{ color, backgroundColor }`) and
  `src/types/event.types.ts` (`EventTypeKey` -> `{ label, icon, theme }`)
  are the palette/icon source of truth for anything event- or
  category-flavored. **`app-icon` and `app-tag` are domain-free and resolve
  nothing themselves** — they read two custom properties, and the call site
  composes them with `iconStyle(...)` / `tagStyle(...)` over a `ThemeMeta`:
  `style=${styleMap(tagStyle(eventType.theme(event.type)))}`. That is what
  lets the document taxonomy colour a tag exactly as the event taxonomy does;
  an `event-type` attribute used to live on both and could only ever serve
  one of them. Prefer this over hardcoding a colour whenever the thing being
  displayed maps to a `ThemeKey`.
- Icons: names are camelCase (`shoppingCart`) and that is the **only**
  accepted spelling — `app-icon` does not normalise kebab-case, because a
  mismatch between `IconName` and what templates write is invisible to `tsc`.
  Adding one is covered under "Other conventions worth knowing" below.

## PWA / offline

```
src/pwa/
  index.ts             # initPwa() / applyUpdate(), called from app-root
  service-worker.js    # SW source — plain JS, never bundled or type checked
public/
  manifest.webmanifest
  icons/               # generated, see scripts/generate-icons.mjs
```

- **No `vite-plugin-pwa` / Workbox.** The plugin in `vite.config.ts` walks
  `dist/` in `closeBundle` (the only hook that runs after `public/` is
  copied), then writes `dist/sw.js` from `src/pwa/service-worker.js` with
  two `__…__` tokens replaced: the precache URL list and a cache name
  hashed from the _contents_ of every file. Hashing contents matters —
  `index.html` is not content-hashed, so a build that only changes it must
  still produce a different `sw.js` or the browser sees no update.
- The app has no backend, so the whole build is precached on install and
  everything is served **cache-first**; `index.html` is cached under `/`
  and returned for every navigation, which is what makes deep links like
  `/horse/<id>` work offline. Cache lookups pass `ignoreVary: true` — some
  servers send `Vary: Origin`, and module scripts do send an `Origin`
  header while the worker's own precache requests don't, so without it
  every asset lookup misses and the app fails to boot offline.
- **A new worker never activates on its own.** It parks in `waiting`, the
  page gets a `pwa-update-ready` event, `app-update-toast` offers
  "Actualiser", and `applyUpdate()` posts `SKIP_WAITING` and reloads on
  `controllerchange`.
- Because of that reload, `app-root` **must not intercept
  `navigationType === 'reload'`** — the Navigation API reports reloads as
  navigations, and intercepting one turns it into a soft re-render.
- **There is no service worker under `npm run dev`** (`apply: 'build'`, plus
  an `import.meta.env.PROD` guard in `initPwa`). Verify PWA behaviour with
  `npm run build && npm run preview`.
- `initPwa()` also calls `navigator.storage.persist()`: IndexedDB is
  evictable by default and it holds the only copy of the user's data.
- Icons are **generated and committed**, not built. `sharp` is deliberately
  not a dependency — regenerate with
  `npm i -D sharp && node scripts/generate-icons.mjs && npm un sharp`.
- Any host serving this must fall back to `index.html` for unknown paths,
  or a cold deep link 404s before the worker is ever installed.

## Other conventions worth knowing

- **Icons are a sprite, not inlined SVG.** `vite/icon-sprite.ts` builds
  `/icons.svg` — one `<symbol>` per file in `src/assets/icons/` — and `app-icon`
  references a glyph with `<use href="/icons.svg#name">`. Adding an icon is: drop
  the file in that folder, add its camelCase name to `ICON_NAMES` in
  `components/app-icon/icons.ts`. The plugin is handed that array and **fails the
  build** if the folder and the list disagree in either direction, so neither can
  drift. The list stays hand-written because `IconName` is what makes
  `icon="chevronLef"` a compile error, and a union cannot be derived from a
  directory at type-check time. Glyphs must paint with `currentColor` (never a
  hard-coded hex) — that is what lets `--icon-color` theme them through the
  `<use>` shadow tree.
- **A modal dialog locks the page behind it.** `showModal()` makes the rest of
  the document inert but leaves it _scrollable_, so `ModalDialog` takes a lock
  from `commons/scroll-lock.ts` on open and releases it on close and on
  teardown. Nothing else should touch `html.scroll-locked`. It lives in the
  controller rather than in a `html:has(app-modal[open])` rule because
  `event-sheet` and `document-viewer` both nest their dialog inside a shadow
  root, where document CSS cannot see it. The companion half is
  `overscroll-behavior: contain` on `.dialog__body`, which stops a flick that
  runs out of dialog from chaining to the page.

- Modern/platform-first CSS is favored over hand-rolled JS: cascade
  `@layer`s, `:has()`, `@starting-style` + `transition-behavior:
allow-discrete` (see `app-bottom-sheet` for animating a native
  `<dialog>` open/closed), `color-mix()`, `dvh` units,
  `env(safe-area-inset-*)` (requires `viewport-fit=cover` in
  `index.html`, already set), View Transitions API for route changes —
  **directional**: `Router` tags each navigation `forward` or `back` (a push is
  forward, a traversal compares history indices, a `replace` gets no type) and
  `main.css` animates the two differently through
  `:root:active-view-transition-type(...)`. The object form of
  `startViewTransition` is feature-detected, so a browser with only the callback
  form still gets the plain cross-fade. `Router` also swallows `ready`/`finished`
  — they reject with AbortError on any skipped transition, which a double-tap
  produces routinely.
  Reach for these before adding an animation library or extra JS.
- **Two Vitest projects, declared in `vitest.config.ts`.** `npm test` runs both;
  `npm run test:data` and `npm run test:components` run one.
- **`data`** (`src/data/**/*.test.ts`, node environment) is where a bug is
  permanent — a bad row in IndexedDB outlives every reload — and it is pure
  TypeScript with no DOM. Dexie runs against `fake-indexeddb`, installed by
  `src/data/__tests__/setup.ts` before `db.ts` constructs its instance at module
  scope. The backup merge, the schema upgrade, the season windows, the
  local-vs-UTC date handling and the cents arithmetic are the parts worth
  guarding.
- **`components`** (`src/components/**/*.test.ts`, `src/views/**/*.test.ts`)
  runs in a real headless Chromium via `@vitest/browser` + Playwright. It has to
  be a real browser, not a DOM shim: these components are built on
  `ElementInternals`, `CustomStateSet` (`:state()`), `<dialog>.showModal()`, the
  top layer, `delegatesFocus` and container queries, none of which jsdom
  implements — a shimmed suite would pass against a mock while the real thing
  broke. CI installs the browser with `npx playwright install --with-deps
chromium`; locally it is the same command, once.
- `src/commons/controllers/router.test.ts` drives **real** navigations rather
  than synthesising events (`NavigateEvent` is not constructible). A
  file-scoped "keeper" listener intercepts every navigation with a no-op
  handler so the runner's iframe never actually unloads — without it, the two
  tests that check the router _doesn't_ intercept would take the whole run
  down. The `beforeRender` throws -> `location.href` fallback is deliberately
  left uncovered: it asks for a real page load, which no component fixture can
  survive. It needs a Playwright test against `npm run preview`.
- `src/components/event-sheet/event-sheet.test.ts` covers the failed-submit
  path — the one that used to fail _silently_, showing the user nothing while
  every field had been told it was wrong. It seeds a horse through
  `data/__tests__/factories.ts`; component tests run against the browser's real
  IndexedDB.
- `src/components/__tests__/change-events.test.ts` pins the composed-event
  contract — the one thing here that fails _silently_, since a `change` that
  never crosses the boundary just looks like an inert control.
- Mount through `src/components/__tests__/fixture.ts`. `fixture(html\`...\`)`renders into a container **attached to the document** —`connectedCallback`is
where every controller subscribes,`showModal()`throws on a disconnected
dialog, and`:state()`means nothing outside a rendered tree — and cleans up
after each test. Use its`settled(el)`rather than a bare`await el.updateComplete`: several components legitimately set reactive state
from `updated()`(a field mirrors its native control's validity there, because
the control does not settle until the DOM has caught up), and Lit signals that
by resolving`updateComplete`with`false`. Awaiting once lands mid-cascade.
- Build calendar fixtures with a **whole** `CalendarEvent`, not a partial one:
  `occurrencesByDate` walks `end`, so a half-built literal fails inside date
  arithmetic rather than at the boundary. See `calendarEvent()` in
  `app-calendar.test.ts`.
- Repository tests share `src/data/__tests__/factories.ts`: `makeHorse`/`makeEvent`
  /`makeRation`/`makeDocument` build whole records, and `resetDb()` clears every
  table and re-establishes the owner id (`createRecord` throws without one).
  Build fixtures with the factories rather than the repositories — a test often
  needs a row in a state a repository would never produce (an old `updatedAt`, a
  tombstone, an archived-but-not-deleted horse), and that is exactly what the
  read paths must be exercised against.
- `db.test.ts` deletes and rebuilds the database around every test, so it keeps
  its own frozen copy of the old schema (`V1_STORES`) — never update that to
  match `STORES`, or the upgrade is tested against itself. `resetDb()` only
  clears tables, which is right for everything except a version change.
- **`vi.useFakeTimers()` deadlocks every Dexie query** — it resolves promises on
  the real task queue. Backdate the stored timestamp instead; see
  `meta.repo.test.ts`'s `daysSinceBackup` test.
- PWA behaviour still needs `npm run build && npm run preview` — there is no
  service worker under `npm run dev`, so update flow, precaching and offline
  cannot be covered by either suite.
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and build.
- **`npm run lint` is oxlint** (`.oxlintrc.json`) — a single binary, no config
  sprawl, and deliberately **no formatter**: the "no Prettier" decision stands.
  Only the `correctness` and `suspicious` categories are on. The `unicorn`
  plugin is deliberately **off**: its `no-await-in-loop` fights the sequential
  awaits Dexie transactions require, and `no-array-sort`/`no-array-reverse` fire
  on arrays the repositories have just built and own outright. Keep the config
  signal-only — a linter that cries wolf is the reason this project had none.
