---
name: categories
description: Add, edit, nest, or re-theme a post category (formerly "event type") in lady-gestion's built-in catalogue. Use when asked to create a new category, change a category's label/icon/colour/fields, file one type under another, give a type a new kind of form field, or when a category change has to rewrite posts already stored on a device.
---

Categories (called event types until schema v13) stopped being a compile-time
union in schema v6: they are rows in the `categories` table (`eventTypes` up to
v12), seeded from one array **on a first install only**. A `Post` points at one
through `categoryKey`. From then on the rows are the user's: she creates and
edits them in the form builder (Personnaliser › Catégories, `CategoryEditorView`),
and no launch writes `BUILT_IN_CATEGORIES` over them again.

So there are two different changes this skill covers:

- **The model a new install starts from** — an edit to `BUILT_IN_CATEGORIES`.
  It reaches no installed device.
- **A change to categories already on devices** — only through a schema
  version and a `ROW_STEPS` entry (see "When a schema version is needed"), and
  only when it cannot be left to her and the builder.

All paths are relative to the repo root. Read `docs/form-builder.md` for the
design this implements, and `AGENTS.md` for the repo's conventions.

## Where the catalogue lives

| What               | Where                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| The row type       | `Category`, `src/data/types.ts`                                                                                                       |
| The seed catalogue | `BUILT_IN_CATEGORIES`, `src/data/categories.ts`                                                                                       |
| Seeding            | `seedCategories`, same file                                                                                                           |
| Pure helpers       | `resolveCatalogue`, `rootsOf`, `childrenOf`, `subtreeKeys`, `canBeParentOf`, `fieldWithRole`, `amountOf`, `counterpartyOf`, same file |
| Builder rules      | `src/data/category-editor.ts` (`validateCategory`, `addField`, `linkField`, `isProtectedField`, …)                                    |
| Write paths        | `src/data/services/categories.service.ts` (`saveCategory`, `deleteCategory`); `categories.repo.ts` (`remove`)                         |
| Test fixtures      | `BUILT_IN_CATEGORY_ROWS`, `src/data/__tests__/factories.ts`                                                                           |

`seedCategories` stamps each row with **`id = def.key`**, deliberately: every
install seeds the same catalogue on its own — a phone, then the new phone its
backup is restored onto — and `importBackup` merges per `id`. A random id would
make each install produce different rows for the same type and double them on
restore.

One call site seeds: `seedCategoriesOnFirstInstall` in `src/data/seed.ts`,
at every launch — and it writes only into an empty table. A restore onto a new
phone needs nothing more: the file's copy replaces each freshly seeded,
never-edited built-in (`YIELDS_TO_FILE` in `backup/snapshot.ts`).

## Adding a type

One entry in `BUILT_IN_CATEGORIES`. Every field:

| Field           | Notes                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `key`           | The slug `Post.categoryKey` stores. **Immutable once shipped** — an event keeps it after the row is gone |
| `label`         | French, shown as-is. There is no i18n layer                                                              |
| `parentId`      | The parent row's `id`, or `null`. See below                                                              |
| `icon`          | An `IconName`, or `null` to inherit                                                                      |
| `theme`         | A `ThemeKey`, or `null` to inherit                                                                       |
| `isBuiltIn`     | `true` for anything in this array                                                                        |
| `isAppointment` | Puts it in the home view's "Rendez-vous à venir"                                                         |
| `tracksWork`    | Makes it the week strip's work session                                                                   |
| `enabled`       | `true` in the seed. The user's switch in Personnaliser › Catégories                                      |
| `order`         | Budget donut and legend order                                                                            |
| `fields`        | Beyond the fixed date/status/location/notes                                                              |

Reuse the field builders at the top of `categories.ts` rather than writing
literals: `counterpartyField(label)`, `amountField()`, `followUpField()`,
`activityField()`, `quantityField()`, and `careFields()` for the
practitioner + follow-up + budget trio the six care types share.

`isAppointment` and `tracksWork` are **behaviour flags, not code to write**.
They replaced a hardcoded `APPOINTMENT_TYPES` set and hardcoded
`type === "travail"` checks respectively; setting one is the whole change.

## Nesting a type

`parentId` holds the parent's **`id`**, not its `key` — unlike
`Post.categoryKey`, and the difference is deliberate (`src/data/types.ts` says
why). In `BUILT_IN_CATEGORIES` a literal slug works only because a seeded
built-in has `id === key`; say so in a comment where you write one.

Rules, all enforced by `canBeParentOf`:

- **Depth is capped at two.** A child cannot be a parent. Nesting a type that
  already has children builds a chain `resolveCatalogue` — one hop, no
  recursion — cannot read, and `BudgetSlice.children` cannot represent.
- **A child always inherits `theme`.** That is what makes a group one wedge in
  the budget ring; it is the invariant the feature rests on, not a preference.
  `reparent` (`category-editor.ts`) drops the theme on attach, and
  `saveCategory` stores a child's as `null`, for this reason.
- **`icon` is optional.** `null` inherits; a real value overrides and is what
  tells siblings apart inside a group. Overriding later is a data edit, not a
  migration.

At runtime, `saveCategory` is the only path that may create a link,
and `remove` promotes children back to roots (materialising the presentation
they were inheriting) so deleting a parent never repaints its children.

Currently nested: `cures` under `alimentation`, `traitement` under `veto`
(schema v9); `osteo` and `massage` under `soins` (schema v10). The other 10
are roots.

## When a schema version is needed

Editing the array changes new installs only. Anything that must reach
categories or posts **already on a device** is a version bump: a `categoryKey`
or a `customFields` value whose meaning changes (v11 rewrote `balade` to
`baladeApied`), a field shape the code starts to depend on (v16 gave
`amountCents` and `counterparty` their roles), or a table's shape. Before
writing one, ask whether it is really the app's to change: a label, a field
list or a default value is hers now, through the builder. `db.ts` has
declared only the current version since 2026-09-17, so read "Bumping
`SCHEMA_VERSION`" in `AGENTS.md` first: a `this.version(n).upgrade()` in
`src/data/db.ts` for devices, and a decision for backup files written at the
previous version (a step in `importBackup` before the merge, or refusing them).
The v1→v13 chain is in git history up to `b210ede` for a worked example.

Non-negotiables in a migration step:

- **Address rows by `key`.** It is the identity every lookup uses, and the only
  half of a row a file written by another build agrees with you on. Resolve any
  `id` you need (a parent's, say) out of the table you are looking at — do not
  assume `id === key`, which holds for a seeded row and nothing else.
- **Guard so replaying is a no-op.** A device patched live, backed up, then
  restored onto itself runs every step twice. Skip a row that is already in the
  target state, and never overwrite a choice the user could have made.
- **Leave `updatedAt` alone.** It is what a restore arbitrates last-write-wins
  by, and a migration every device runs must not win that argument.
- **Freeze the payload.** A constant describing what version _n_ did is not the
  place to add version _n+1_'s work; extending it silently changes what _n_
  does to every device still upgrading through it.

## Icons and themes

A new **icon** needs its name in `ICON_NAMES` (`src/components/app-icon/icons.ts`)
_and_ an SVG in `src/assets/icons/`. `vite/icon-sprite.ts` throws if the folder
and the list disagree in either direction, so a mismatch fails the build rather
than shipping a blank.

A new **theme** needs three things, all required: the union member in
`src/theme/theme.types.ts`, an entry in `THEME_META` (`src/theme/theme.ts`), and
the `--color-theme-<name>` / `--color-theme-<name>-background` pair in
`src/styles/tokens/color.css`. There are 9 keys; reusing one is normal.

`resolveCatalogue` falls back to `info`/`taupe` for a value this build cannot
draw, which is also the only guard against a restored backup naming a theme that
no longer exists — `THEME_META[key]` is a mapped type, so an unknown key would
be a `TypeError` at render.

## A new kind of field

Only when an existing kind genuinely cannot express it. `src/data/types.ts` is
explicit that `followUp`, `workActivity` and `quantity` exist "because a built-in
type already needs them, not because a generic field could reproduce what they
do" — `text`, `cents` and `bool` are the general-purpose three.

If you must, seven sites:

1. `FieldControl`, `src/data/types.ts`
2. `EVENT_SCHEMA` (the flat parser table) in `src/components/post-sheet/post-sheet.ts`
3. a render branch and a `#render*` method in the same file
4. `postFields`, `src/data/services/posts.service.ts` — which `customFields`
   key the value lands in
5. `formatFieldValue`, `src/data/post-views.ts` — reading it back for the
   detail card
6. `FIELD_KINDS`/`newField`/`kindOf` in `src/data/category-editor.ts`, and its
   default-value control in `field-sheet.ts` — so the builder can offer it
7. a parser in `src/data/forms.ts`; cross-field rules go in `src/data/posts.ts`
   as pure functions, on the model of `quantityPairErrors`

## Gotchas

- **`BUILT_IN_CATEGORY_ROWS` prefixes every id.** Test fixtures use
  `event-type-<key>`, so `parentId` has to be remapped through the same prefix
  (`factories.ts` does this). Skipping it leaves a dangling link, and the
  failure is **silent**: `resolveCatalogue` reads an unresolvable parent as a
  root, so the whole suite stays green while asserting against a flat catalogue
  the app does not ship.
- **A test that nests a type must pick a leaf.** `alimentation`, `veto` and
  `soins` have children now; re-parenting one of the three as someone else's
  child builds the three-deep chain `canBeParentOf` refuses.
  `marechal`, `dentiste`, `osteo` and `massage` are still leaves — none has
  children of its own — so all four remain safe to re-parent in a test, `osteo`
  and `massage` included even though they already have `soins` as a parent.
- **Find a field by its `role`, not its `id`, whenever the app acts on it.**
  The budget, the search, the share, the week strip, follow-ups and reminders
  all read `fieldWithRole`; the builder keeps one field per role
  (`validateCategory`) and lets her move a link from one field to another, so
  an id is not where a value lives once she has edited the form. `endDate` and
  `dosage` on `cures`/`traitement` are still read by id — the builder protects
  them (`isProtectedField`).
- **`categories.ts` and `posts.ts` must not import each other.** Either
  direction is circular the moment the other reaches back. Join them at the call
  site.
- **`enabled: false` hides a category and its posts everywhere.** Views read
  `categoriesRepo.listEnabled()`; the Catégories tab alone reads
  `listResolved()`. Post lists and totals in `posts.repo.ts` drop posts of a
  disabled category inside the query, so a `liveQuery` re-runs on a toggle. A
  parent's switch does not reach its children.

## Verify

```bash
npm run build && npm test
```

`build` is typecheck + oxlint + oxfmt + vite build; `test` runs both Vitest
projects (`data` on `fake-indexeddb`, `components` in headless Chromium).

A migration needs more than a green suite. Mutate it and watch a test fail —
break the parent lookup, then drop the replay guard — or it is only asserting
that the seed is the seed. `src/data/db.test.ts` opens a database written at the
last version (`V13_STORES`) under the current one — the upgrade's test goes
there; `src/data/backup/snapshot.test.ts` covers files, and
`snapshot.real-backup.test.ts` runs the walk over her real export. That a launch
leaves installed categories alone is `src/data/seed.reconcile.test.ts`.

Then look at it, via the `run-lady-gestion` skill — nesting and colour are not
things a unit test sees:

```bash
node .claude/skills/run-lady-gestion/driver.mjs <<'EOF'
nav /posts
wait app-chip
$ .posts-view__filters app-chip
click app-chip[label="Alimentation"]
$ .posts-view__filters--nested app-chip
ss chips
nav /budget
wait app-donut-chart
errors
quit
EOF
```

A nested type must be absent from the root chip row, present in the second row
once its parent is selected, drawn in its parent's colour, and folded into its
parent's wedge with a "N sous-types" disclosure in the legend.
