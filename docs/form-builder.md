# Custom Event Types — User-Facing Form Builder

## Context

Event types (`veto`, `marechal`, `dentiste`, `osteo`, `cours`, `alimentation`, `achat`, `pension`, `travail`) and the fields their form shows used to be a closed, compile-time TypeScript configuration (`src/types/event.types.ts`: `EVENT_TYPE_META`, `EVENT_FORM_SPEC`, `EVENT_FORM_VARIANT`). Adding or changing a type required a code change and a release.

The goal is to let end users, from within the app, create their own event types and edit any type — including the built-ins — choosing its label/icon/color and which fields its form shows, with real custom fields (text, number, date, yes/no, choice list), not just toggles on today's fixed slots. This turns event types from a TypeScript union into user data, which is a substantial architectural change (confirmed by research: 5+ call sites read the static tables, 3 places hardcode specific type literals for dashboard behavior, and the DB had no generic field bag).

**Refreshed 2026-09-06** against commit `c60fc47` ("add combobox + update travail form"), which landed after the original research and touched the exact files this plan targets:

- `EVENT_FORM_SPEC` gained an `amount: boolean` — `work` was the one layout with no Budget field (`amountCents` is nulled server-side when `spec.amount` is false). Amount is **no longer a universally-fixed base field**; treat it like `counterparty`/`followUp`/`activity` — a per-type-configurable field.
- The work layout's activity field ("Nom") now renders via a new reusable `src/components/app-combobox/app-combobox.ts` — reuse this component for the generic `'choice'`/`'workActivity'` field kinds in the new field-builder UI instead of `app-select`.
- `EventInput.title` is now `string | null` and derived specially for `work`-layout events: `eventFields` in `events.service.ts` synthesizes `title` from `formatWorkActivity` when `spec.activity` is true, rather than reading a separate title field. Any generic field-bag redesign must preserve this synthesis rule for whichever type carries the `workActivity` field kind.

## Status — 2026-09-08

Steps 1–3 of the build order below shipped in commit `a63615e` ("refactor data schema types"): the data model, the schema v6 migration, `event-types.repo.ts`, and `event-sheet.ts`/`EventDetailView.ts`/`budget.ts` reading fields dynamically off the live type catalogue. The app behaves identically to before that commit for the 13 seeded types. **Steps 4 and 5 — the type-management UI and the backup/migration hardening pass — have not started.**

One design note for whoever picks up step 4: the shipped field-lookup helpers are split in two — `fieldOfKind` (safe only for `followUp`/`workActivity`, which are singleton-by-construction) and `fieldById` (for the general-purpose kinds — `text`, `cents`, `bool` — where a type could in principle carry more than one field of the same kind). A field-builder UI that lets a user add a _second_ `text` or `cents` field to a type is exactly the case `fieldById` exists for; do not reintroduce a kind-based lookup for a fixed slot once that UI exists.

## Non-goals for v1

- Drag-to-reorder types (new types simply append after existing ones; reordering can be a follow-up).
- Any multi-user/server sync (out of scope — app is fully local/offline; only the existing manual JSON backup needs updating).
- Letting a field change its `kind` once created (would be a lossy conversion) — deleting and re-adding is enough for v1.

## Data model (`EventTypeDef`, `CustomFieldDef`, schema v6)

New table `eventTypes` (bumped `SCHEMA_VERSION` in `src/data/db.ts` to 6, new `db.version(6).stores(...)`):

```
eventTypes: 'id, key, order, archived, updatedAt'
```

```ts
interface EventTypeDef extends BaseRecord {
  key: string; // stable slug, generated at creation, immutable — this is what HorseEvent.type stores
  label: string;
  icon: IconName;
  theme: ThemeKey;
  isBuiltIn: boolean; // true for the seeded defaults; informative only, does NOT block editing
  isAppointment: boolean; // drives dashboard "upcoming appointments" list — replaces hardcoded APPOINTMENT_TYPES
  tracksWork: boolean; // drives week-strip day-activity tracking — replaces hardcoded 'travail' checks
  archived: boolean; // soft-delete: hidden from pickers, still resolves for historical events
  order: number; // explicit stable order (drives budget donut/legend order)
  fields: CustomFieldDef[]; // extra fields beyond the fixed base fields
}

interface CustomFieldDef {
  id: string; // stable key into HorseEvent.customFields, immutable after creation
  kind: FieldKind; // 'text' | 'number' | 'cents' | 'bool' | 'isoDate' | 'choice' | 'followUp' | 'workActivity'
  label: string;
  required: boolean;
  options?: string[]; // choice-kind only
}
```

`HorseEvent` gains one new column: `customFields: Record<string, string | number | boolean | null>` (`src/data/types.ts`). It replaces the old named columns `providerName`, `vendor`, `followUpInterval`, `activity`, and now also `amountCents`'s per-type presence rule — those become plain entries in the bag (e.g. `customFields.counterparty`, `customFields.followUp`, `customFields.activity`, `customFields.amountCents`). No new Dexie index is needed; the bag is opaque, matching how `notes`/`location` already work.

The fixed base fields common to every type — date, status, location, notes — stay as-is and are not configurable. `amountCents`/`currency` is not one of these anymore (see refresh note above): it's modeled as a per-type optional field like the others, present for every seeded type except `travail`.

Work-activity linkage: `travail`'s activity field is a special case (it's backed by the existing user-editable activities catalogue, `src/components/activity-sheet/`, rendered via `app-combobox`), not a generic `'choice'`. It stays the distinct kind `'workActivity'`, so `tracksWork: true` types can include one such field and:

- the day-sheet write path can find it generically (`type.fields.find(f => f.kind === 'workActivity')`) instead of assuming the type key is `'travail'`.
- `eventFields`'s title-synthesis rule (`title = formatWorkActivity(value)` when this field is present and set) is preserved generically off the field's presence, not off a hardcoded type check.

## Migration (`db.ts` v6 upgrade + `snapshot.ts`)

In the same `upgrade()` transaction:

1. Seed the built-in `EventTypeDef` rows (`isBuiltIn: true`, stable `order`), reconstructed from the old `EVENT_TYPE_META`/`EVENT_FORM_SPEC`/`EVENT_FORM_VARIANT` — e.g. `veto`/`marechal`/`dentiste`/`osteo` get `isAppointment: true` plus a counterparty text field, a follow-up field and an amount field; `travail` gets `tracksWork: true` and a `workActivity` field, no amount field; `cours`/`pension` get an amount field only; `alimentation`/`achat` get a counterparty field plus amount.
2. Walk every existing events row and move `providerName`/`vendor` → `customFields.counterparty`, `followUpInterval` → `customFields.followUp`, `activity` → `customFields.activity`, `amountCents` → `customFields.amountCents` (only for types where the seeded def carries an amount field), then drop the now-unused columns.

Per the documented convention in `snapshot.ts` for migrating `db.version(n).upgrade()` logic, the identical step is shared with `migrateSnapshot` for JSON backup restores (via `migrateEventToCustomFields` in `events.ts`), and `eventTypes` is added to `RECORD_TABLES` in `db.ts` so it's automatically included in backup export/import/seed-clear.

## Repository & reactive registry

- `src/data/repositories/event-types.repo.ts` — CRUD via the existing generic `crud()` helper, mirroring `activities.repo.ts`. `listAll()` follows the same `LiveQuery` pattern already used for live updates in components.
- The static `EVENT_TYPE_META`/`eventType`/`EVENT_TYPES`/`EVENT_FORM_SPEC` exports in `event.types.ts` are replaced by small runtime helpers in `event-types.ts` operating on a fetched `EventTypeDef[]`.

## Form (event-sheet.ts)

- `EVENT_SCHEMA.type` validation whitelist becomes `oneOf(currentTypeKeys, { required: true })`, computed from the live list at render/submit time instead of the compile-time `EVENT_TYPES` array.
- Once a type is selected, build the type-specific part of the form schema dynamically from `type.fields`: for each `CustomFieldDef`, map `kind` → the matching `data/forms.ts` parser factory (text/decimal/cents/bool/isoDate/oneOf for choice), keyed by `field.id`, branching `required` at runtime (the type-level required overload trick in `forms.ts` doesn't apply to data-driven schemas — that's fine, results are read as `Record<string, unknown>`).
- Rendering: a loop over `type.fields`, one small render function per kind (text → `app-input`, number/decimal → numeric `app-input`, cents → the existing amount-field pattern, bool → `app-switch`, date → the existing date input pattern, choice → `app-combobox` with `field.options`, workActivity → `app-combobox` wired to the activity catalogue, same as today's `#renderActivity`).
- `readForm(formEl, dynamicSchema)`'s result becomes `EventInput.customFields`. The title synthesis rule stays a small post-processing step keyed off `kind === 'workActivity'` rather than off `input.type === 'travail'`.

## Persistence layer (events.service.ts, data/events.ts)

- The `eventFields`/`eventFormSpec` column-mapping logic is gone; `customFields` is written verbatim from `EventInput.customFields`. Base fields (date/status/location/notes) unchanged.
- `dayActivityFields` and `workSessionByDate`/`workActivityByDate` no longer hardcode `type: 'travail'` / `event.type === 'travail'` — both take the resolved `EventTypeDef` (or the live type list) and key off `tracksWork`/the type's own `workActivity` field id.
- `APPOINTMENT_TYPES` (the hardcoded Set that used to live in `data/events.ts`) is replaced by filtering the live type list on `isAppointment`.
- `budget.ts`'s `sumByType` iterates the live type list sorted by `order` instead of the fixed `EVENT_TYPES` array, preserving stable donut/legend order; new types append with `order = max + 1`. Since `amountCents` moved into `customFields`, `sumByType` reads `customFields.amountCents` for types that carry an amount field, and treats types without one as contributing zero.

## New UI: manage event types (not started)

No existing settings/CRUD screen to copy — build new, reusing existing primitives (`app-bottom-sheet`, `app-chip`, `app-input`, `app-switch`, `app-combobox`, `<app-icon>`):

- Entry point: a "Types d'événements" row on the profile view (today's closest thing to a settings screen), linking to a new `src/views/EventTypesView.ts` — a list of all types (built-in and custom together, no visual distinction beyond an optional "par défaut" badge), sorted by label, tappable to edit; a "+" opens the same editor in create mode.
- Editor: new bottom-sheet component `src/components/event-type-sheet/event-type-sheet.ts` — label input; icon picker (grid over `ICON_NAMES` from `components/app-icon/icons.ts`, rendered with `<app-icon>`); theme picker (swatches over the `ThemeKey` values in `theme/theme.ts`); toggles for `isAppointment`/`tracksWork`; a field-list editor (each row: kind selector + label + required + kind-specific options like choice items or number min/max). No icon/color picker exists anywhere yet, so this is new UI, not a reuse of an existing pattern.
- Archive vs delete: since `HorseEvent.type` is a direct key reference, hard-deleting a type that has events would orphan their display. Default action is "Archiver" (`archived: true` — hidden from new-event pickers, still resolves for historical events); offer a "Supprimer définitivement" action only when a count query on `events.repo` confirms zero events reference that key.

## Testing & verification

- `src/data/db.test.ts`: extend the upgrade-path test to cover v6 (seeding + column migration) — done.
- New `src/data/repositories/event-types.repo.test.ts` mirroring `activities.repo.ts` test conventions — done.
- New `src/data/event-types.test.ts` for the pure helpers in `event-types.ts` (`fieldOfKind`/`fieldById`/`isAppointmentType`/`upcomingAppointments`/etc.) — still to add.
- Component tests once the management UI exists: new `EventTypesView.test.ts` and `event-type-sheet.test.ts`, per the existing `test:components` convention.
- Run `npm run build` (typecheck + oxlint + vite build) and both `npm run test:data` / `npm run test:components`.
- Manual pass via the `run-lady-gestion` skill once the UI exists: create a custom type mixing several field kinds, create/edit an event of that type, edit a built-in type's label/icon/fields, confirm the dashboard/budget donut and week-strip day-activity still work, export a backup then import it into a fresh DB to confirm the v6 migration round-trips.

## Suggested build order

1. ~~Data model + migration + `event-types.repo.ts` + seeding (no UI change yet, app still works off the seeded defaults).~~ Done — `a63615e`.
2. ~~Make `event-types.ts`'s accessors and `event-sheet.ts` fully dynamic/data-driven for the seeded types (behaves identically to before, including the amount rules from `c60fc47`).~~ Done — `a63615e`.
3. ~~Generalize `APPOINTMENT_TYPES`/`tracksWork`/budget ordering off the new flags.~~ Done — `a63615e`.
4. Build the type-management UI (list + editor, icon/theme pickers, field-list editor).
5. Backup/migration hardening + full test pass.
