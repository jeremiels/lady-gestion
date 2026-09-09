---
name: event-types
description: Add, edit, nest, or re-theme an event type in lady-gestion's built-in catalogue. Use when asked to create a new event type, change a type's label/icon/colour/fields, file one type under another, give a type a new kind of form field, or when a change to `BUILT_IN_EVENT_TYPES` needs a schema migration to reach devices that already have the row.
---

Event types stopped being a compile-time union in schema v6: they are rows in
the `eventTypes` table, seeded from one array. Adding or editing one is
therefore a **data** change, not a code change — but only if you touch the four
places that have to agree, and avoid the three traps below.

All paths are relative to the repo root. Read `docs/form-builder.md` for the
design this implements, and `AGENTS.md` for the repo's conventions.

## Where the catalogue lives

| What               | Where                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| The row type       | `EventTypeDef`, `src/data/types.ts`                                                                                  |
| The seed catalogue | `BUILT_IN_EVENT_TYPES`, `src/data/event-types.ts`                                                                    |
| Seeding            | `seedEventTypeDefs`, same file                                                                                       |
| Pure helpers       | `resolveCatalogue`, `rootsOf`, `childrenOf`, `subtreeKeys`, `canBeParentOf`, `fieldById`, `fieldWithRole`, same file |
| Write paths        | `src/data/repositories/event-types.repo.ts` (`setParent`, `remove`)                                                  |
| Test fixtures      | `BUILT_IN_EVENT_TYPE_ROWS`, `src/data/__tests__/factories.ts`                                                        |

`seedEventTypeDefs` stamps each row with **`id = def.key`**, deliberately: a
fresh install, a live upgrade and a backup restore all seed the same catalogue,
and `importBackup` merges per `id`. A random id would make those three produce
three different rows for the same type and double them on restore.

Three call sites seed, and they must agree: `src/data/seed.ts` (fresh install),
`src/data/db.ts`'s v6 upgrade (live), `src/data/backup/snapshot.ts`'s
`migrateSnapshot` (restore). They already do, because all three call
`seedEventTypeDefs`. Keep it that way.

## Adding a type

One entry in `BUILT_IN_EVENT_TYPES`. Every field:

| Field           | Notes                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `key`           | The slug `HorseEvent.type` stores. **Immutable once shipped** — an event keeps it after the row is gone |
| `label`         | French, shown as-is. There is no i18n layer                                                             |
| `parentId`      | The parent row's `id`, or `null`. See below                                                             |
| `icon`          | An `IconName`, or `null` to inherit                                                                     |
| `theme`         | A `ThemeKey`, or `null` to inherit                                                                      |
| `isBuiltIn`     | `true` for anything in this array                                                                       |
| `isAppointment` | Puts it in the home view's "Rendez-vous à venir"                                                        |
| `tracksWork`    | Makes it the week strip's work session                                                                  |
| `archived`      | Declared and seeded; **nothing filters on it yet**                                                      |
| `order`         | Budget donut and legend order                                                                           |
| `fields`        | Beyond the fixed date/status/location/notes                                                             |

Reuse the field builders at the top of `event-types.ts` rather than writing
literals: `counterpartyField(label)`, `amountField()`, `followUpField()`,
`activityField()`, `quantityField()`, and `careFields()` for the
practitioner + follow-up + budget trio the six care types share.

`isAppointment` and `tracksWork` are **behaviour flags, not code to write**.
They replaced a hardcoded `APPOINTMENT_TYPES` set and hardcoded
`type === "travail"` checks respectively; setting one is the whole change.

## Nesting a type

`parentId` holds the parent's **`id`**, not its `key` — unlike
`HorseEvent.type`, and the difference is deliberate (`src/data/types.ts` says
why). In `BUILT_IN_EVENT_TYPES` a literal slug works only because a seeded
built-in has `id === key`; say so in a comment where you write one.

Rules, all enforced by `canBeParentOf`:

- **Depth is capped at two.** A child cannot be a parent. Nesting a type that
  already has children builds a chain `resolveCatalogue` — one hop, no
  recursion — cannot read, and `BudgetSlice.children` cannot represent.
- **A child always inherits `theme`.** That is what makes a group one wedge in
  the budget ring; it is the invariant the feature rests on, not a preference.
  `setParent` writes `theme: null` on attach for this reason.
- **`icon` is optional.** `null` inherits; a real value overrides and is what
  tells siblings apart inside a group. Overriding later is a data edit, not a
  migration.

At runtime, `eventTypesRepo.setParent` is the only path that may create a link,
and `remove` promotes children back to roots (materialising the presentation
they were inheriting) so deleting a parent never repaints its children.

Currently nested: `cures` under `alimentation`, `traitement` under `veto`
(schema v9); `osteo` and `massage` under `soins` (schema v10). The other 10
are roots.

## The two-migration rule

Changing the array reaches **only a fresh install**. Every installed device
already has the row, and so does every backup file. So any edit to a type that
already shipped needs a version bump and **two** migrations that agree:

| Half        | Where                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------ |
| Live device | `this.version(n).upgrade()` in `src/data/db.ts`                                            |
| Backup file | a `if (backup.schemaVersion < n)` step in `migrateSnapshot`, `src/data/backup/snapshot.ts` |

Bump `SCHEMA_VERSION` in `db.ts` and add its line to the version list comment
there. If no index changed, repeat the previous `.stores()` verbatim.

Two worked templates, both still in the tree:

- **v7** — the content of one seeded row changes (`alimentation` gains a
  `quantity` field). Addressed by `key`; guarded against double-adding.
- **v9** — two rows gain a parent. Payload shared as `SCHEMA_V9_NESTINGS`
  (`event-types.ts`) so the two halves cannot drift, the same way v6 shares
  `migrateEventToCustomFields`.

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

If you must, six sites:

1. `FieldControl`, `src/data/types.ts`
2. `EVENT_SCHEMA` (the flat parser table) in `src/components/event-sheet/event-sheet.ts`
3. a render branch and a `#render*` method in the same file
4. `eventFields`, `src/data/services/events.service.ts` — which `customFields`
   key the value lands in
5. `#infoRows`, `src/views/EventDetailView.ts` — reading it back for display
6. a parser in `src/data/forms.ts`; cross-field rules go in `src/data/events.ts`
   as pure functions, on the model of `quantityPairErrors`

## Gotchas

- **`BUILT_IN_EVENT_TYPE_ROWS` prefixes every id.** Test fixtures use
  `event-type-<key>`, so `parentId` has to be remapped through the same prefix
  (`factories.ts` does this). Skipping it leaves a dangling link, and the
  failure is **silent**: `resolveCatalogue` reads an unresolvable parent as a
  root, so the whole suite stays green while asserting against a flat catalogue
  the app does not ship.
- **A test that nests a type must pick a leaf.** `alimentation`, `veto` and
  `soins` have children now; re-parenting one of the three as someone else's
  child builds the three-deep chain `setParent` would have refused.
  `marechal`, `dentiste`, `osteo` and `massage` are still leaves — none has
  children of its own — so all four remain safe to re-parent in a test, `osteo`
  and `massage` included even though they already have `soins` as a parent.
- **`fieldById`, not `fieldWithRole`, for a fixed slot.** `fieldWithRole` is
  only safe for `followUp` and `workActivity`, which are singletons by
  construction; for `counterparty`, `amountCents` and `quantity` it resolves to
  whichever field of that kind comes first.
- **`event-types.ts` and `events.ts` must not import each other.** Either
  direction is circular the moment the other reaches back. Join them at the call
  site.
- **`archived` is seeded but not honoured.** `listAll` filters `deletedAt` only.
  Do not rely on it to hide a type.

## Verify

```bash
npm run build && npm test
```

`build` is typecheck + oxlint + oxfmt + vite build; `test` runs both Vitest
projects (`data` on `fake-indexeddb`, `components` in headless Chromium).

A migration needs more than a green suite. Mutate it and watch a test fail —
break the parent lookup, then drop the replay guard — or it is only asserting
that the seed is the seed. `src/data/db.test.ts` writes a database at each old
version and reopens it at the current one; `src/data/backup/snapshot.test.ts`
does the same for files. Add to **both**.

Then look at it, via the `run-lady-gestion` skill — nesting and colour are not
things a unit test sees:

```bash
node .claude/skills/run-lady-gestion/driver.mjs <<'EOF'
nav /events
wait app-chip
$ .events-view__filters app-chip
click app-chip[label="Alimentation"]
$ .events-view__filters--nested app-chip
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
