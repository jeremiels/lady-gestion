# Custom Event Types — User-Facing Form Builder

## Context

Event types (`veto`, `marechal`, `dentiste`, `osteo`, `cours`, `alimentation`, `achat`, `pension`, `travail`) and the fields their form shows are currently a closed, compile-time TypeScript configuration (`src/types/event.types.ts`: `EVENT_TYPE_META`, `EVENT_FORM_SPEC`, `EVENT_FORM_VARIANT`). Adding or changing a type today requires a code change and a release.

The goal is to let end users, from within the app, create their own event types and edit any type — including the 9 built-ins — choosing its label/icon/color an, with real custom fields (text, number,
Both research agents are running — one on the data/persistence stack (DB schema, migrations, service layer, blast radius across the app), the other on the form DSL and any existing settings/customization UI patterns to reuse. I'll
wait for both before designing the plan.

# Custom Event Types — User-Facing Form Builder

## Context

Event types (`veto`, `marechal`, `dentiste`, `osteo`, `cours`, `alimentation`, `achat`, `pension`, `travail`) and the fields their form shows are currently a closed, compile-time TypeScript configuration (`src/types/event.types.ts`: `EVENT_TYPE_META`, `EVENT_FORM_SPEC`, `EVENT_FORM_VARIANT`). Adding or changing a type today requires a code change and a release.

The goal is to let end users, from within the app, create their own event types and edit any type — including the 9 built-ins — choosing its label/icon/color and which fields its form shows, with real custom fields (text, number, date, yes/no, choice list), not just toggles on today's fixed slots. This turns event types from a TypeScript union into user data, which is a substantial architectural change (confirmed by research: 5+ call sites read the static tables, 3 places hardcode specific type literals for dashboard behavior, and the DB has no generic field bag today).

**Refreshed 2026-09-06** against commit `c60fc47` ("add combobox + update travail form"), which landed after the original research and touched the exact files this plan targets:

- `EVENT_FORM_SPEC` gained an `amount: boolehe one layout with no Budget field(`amountCents`is nulled server-side when`spec.amount`is false). Amount is **no longer a universally-fixed base field**; treat it like`counterparty`/`followUp`/`activity` — a per-type-configurable field.
- The work layout's activity field ("Nom") now renders via a new reusable `src/components/app-combobox/app-combobox.ts` — reuse this component for the generic `'choice'`/`'workActivity'` field kinds in the new field-builder UI instead of `app-select`.
- `EventInput.title` is now `string | null` and derived specially for `work`-layout events: `eventFields` in
  `events.service.ts` synthesizes `title` from (`formatWorkActivity`) when `spec.activity`is true, rather than reading a separate title field. Any generic field-bag redesign must preserve this synthesis rule for whichever type carries the `workActivity` field kind.

## Non-goals for v1

- Drag-to-reorder types (new types simply append after existing ones; reordering can be a follow-up).
- Any multi-user/server sync (out of scope — app is fully local/offline; only the existing manual JSON backup needs updating).
- Letting a field change its `kind` once reaould be a lossy conversion) —
  entTypes`** (bump `SCHEMA_VERSION`in`src/data/db.ts`to 6, new`db.version(6).stores(...)`):

eventTypes: 'id, key, order, archived, updatedAt'

```ts
interface EventTypeDef extends BaseRecord {
  key: string;              // stable slug, generated at creation, immutable — this is what HorseEvent.type stores
  label: string;
  icon: IconName;
  theme: ThemeKey;
  isBuiltIn: boolean;       // true for the 9 seeded defaults; informative only, does NOT block editing
  isAppointment: boolean;   // drives dashboard "upcoming appointments" list — replaces hardcoded APPOINTMENT_TYPES
  tracksWork: boolean;      // drives week-strip day-activity tracking — replaces hardcoded 'travail' checks
  archived: boolean;        // soft-delete: rs, still resolves for historical events
  order: number;            // explicit stable order (drives budget donut/legend order)
  fields: CustomFieldDef[]; // extra fields d the fixed base fields
}

interface CustomFieldDef {
  id: string;                // stable key i, immutable after creation
number;// number/decimal
  options?: string[];        // choice
}

HorseEvent gains one new column: customFields: Record<string, string | number | boolean | null> (src/data/types.ts). It replaces the old named columns providerName, vendor, followUpInterval, activity, and now also amountCents's per-type presence rule — those become plain entries in the bag (e.g. customFields.counterparty, customFields.followUp, customFields.activity, customFields.amountCents). No new Dexie index is needed; the bag is opaque, matching how notes/location already work.

The fixed base fields common to every type — date, status, location, notes — stay as-is and are not configurable. amountCents/currency is not one of these anymore (see refresh note above): model it as a per-type optional field like the others, defaulting to present for all seeded types except travail.

Work-activity linkage: travail's activity field is a special case (it's backed by the existing user-editable activities catalogue, src/components/activity-sheet/, and now rendered via app-combobox), not a generic 'choice'. Keep it as the distinct kind: 'workActivity', so tracksWork: true types can include one such field and:
- the day-sheet write path can find it generically (type.fields.find(f => f.kind === 'workActivity')) instead of assuming the type key is 'travail'.
- eventFields's title-synthesis rule (title = formatWorkActivity(value) when this field is present and set) is preserved generically off the field's presence, not off a hardcoded type check.

Migration (db.ts v6 upgrade + snapshot.ts)

In the same upgrade() transaction:
1. Seed the 9 built-in EventTypeDef rows (isBuiltIn: true, order: 0..8), reconstructed from today's EVENT_TYPE_META/EVENT_FORM_SPEC/EVENT_FORM_VARIANT — e.g. veto/marechal/dentiste/osteo get isAppointment: true and
   a counterparty text field plus an amount k: true and a workActivity field, no amountfield; cours/pension get an amount field only; alimentation/achat get a counterparty field plus amount.
2. Walk every existing events row and move providerName/vendor → customFields.counterparty, followUpInterval → customFields.followUp, activity → customFields.activity, amountCents → customFields.amountCents (only for types where the seeded def carries an amount field), then drop the now-unused columns.

Per the documented convention in snapshot.tshing db.version(n).upgrade()"), add theidentical step to migrateSnapshot for JSON backup restores, and add eventTypes to RECORD_TABLES in db.ts so it's automatically included in backup export/import/seed-clear.

Repository & reactive registry

- src/data/repositories/event-types.repo.ts — CRUD via the existing generic crud() helper, mirroring activities.repo.ts. Add a listAll()/reactive query following whatever pattern activities.repo.ts already uses for live updates in components.
- Replace the static EVENT_TYPE_META/eventType/EVENT_TYPES/EVENT_FORM_SPEC exports in event.types.ts with small
  runtime helpers operating on a fetched Eve

- EVENT_SCHEMA.type validation whitelist becomes oneOf(currentTypeKeys, { required: true }), computed from the live list at render/submit time instead of the compile-time EVENT_TYPES array.
- Once a type is selected, build the type-specific part of the form schema dynamically from type.fields: for each CustomFieldDef, map kind → the matching data/forms.ts parser factory (text/decimal/cents/bool/isoDate/oneOf for choice), keyed by field.id, branching required at runtime (the type-level required overload trick in forms.ts doesn't apply to data-driven schemas — that's fine, results are read as Record<string, unknown>).
- Rendering: replace the current hardcoded counterparty/followUp/activity/amount html blocks with a loop over type.fields, one small render function per kind (text→app-input, number/decimal→numeric app-input, cents→reuse the existing amount-field pattern, bool→app-switch, date→existing date input pattern, choice→app-combobox with field.options, workActivity→reuse app-combobox wired to the activity catalogue, same as today's #renderActivity).
- readForm(formEl, dynamicSchema) result becomes EventInput.customFields. Preserve the title synthesis rule as a small post-processing step keyed off kind === 'workActivity' rather than off input.type === 'travail'.

Persistence layer (events.service.ts, data/events.ts)

- eventFields/eventFormSpec-column-mapping logic is deleted; customFields is written verbatim from EventInput.customFields. Base fields (date/status/location/notes) unchanged.
- dayActivityFields (currently hardcodes type: 'travail') and workSessionByDate/workActivityByDate (currently check   event.type === 'travail') both change to: ork === true, use its key and itswn constraint.
- APPOINTMENT_TYPES (hardcoded Set in data/events.ts) is replaced by filtering the live type list on isAppointment, consumed by events.repo.ts's listUpcoming.
- budget.ts's sumByType iterates the live type list sorted by order instead of the fixed EVENT_TYPES array, preserving stable donut/legend order; new types append with order = max + 1. Since amountCents moves into customFields, sumByType must read customFields.amountCents for types that carry an amount field, and treat types without one as contributing zero.

New UI: manage event types

No existing settings/CRUD screen to copy — build new, reusing existing primitives (app-bottom-sheet, app-chip, app-input, app-switch, app-combobox, <app-icon>):
  Entry point: a "Types d'événements" row inday's closest thing to a settings screen),linking to a new src/views/EventTypesView.ts — a list of all types (built-in and custom together, no visual         distinction beyond an optional "par défaut/theme/label, tappable to edit; a "+" opensthe same editor in create mode.
- Editor: new bottom-sheet component src/components/event-type-sheet/event-type-sheet.ts — label input; icon picker (grid over ICON_NAMES from components/app-icon/icons.ts, rendered with <app-icon>); theme picker (swatches over the 9 ThemeKey values in theme/theme.ts); "Renil" toggles for isAppointment/tracksWork; an, each with kind selector + label + required + kind-specific options like choice items or number min/max). No icon/color picker exists anywhere yet, so this is new UI, not a reuse of an existing pattern.
- Archive vs delete: since HorseEvent.type is a direct key reference, hard-deleting a type that has events would orphan their display. Default action is "Archiver" (archived: true — hidden from new-event pickers, still resolves for historical events); offer a "Supprimer définitivement" action only when a count query on events.repo confirms zero events reference that key.

Testing & verification

- src/data/db.test.ts: extend the upgrade-path test to cover v6 (seeding + column migration).
- New src/data/repositories/event-types.repo.test.ts mirroring activities.repo.ts test conventions.
- Update src/data/events.test.ts (APPOINTMENT_TYPES/tracksWork/dayActivityFields behavior) and src/data/services/events.service.test.ts (already covers spec.amount/title-synthesis behavior post-c60fc47 — extend rather than replace).
- Update component tests: event-sheet.test.ts (dynamic field rendering per type, already recently touched by c60fc47 — check for conflicts), BudgetView.test.ts (ordering + amount-in-customFields), EventsView.test.ts (filters over dynamic types), EventDetailView.test.ts.
- New EventTypesView.test.ts and event-type-wser project, per existing test:componentsconvention).
- Run npm run build (typecheck + oxlint + vite build) and both npm run test:data / npm run test:components.
- Manual pass via the run-lady-gestion skill: create a custom type mixing several field kinds, create/edit an event of that type, edit a built-in type's label/icon/fields, confirm the dashboard/budget donut and week-strip day-activity still work, export a backup then import it into a fresh DB to confirm the v6 migration round-trips.

Suggested build order

1. Data model + migration + event-types.repo.ts + seeding (no UI change yet, app still works off the seeded defaults).
2. Make event.types.ts's accessors and event-sheet.ts fully dynamic/data-driven for the 9 seeded types (should behave identically to today, including the amouns rules from c60fc47, once this lands).
3. Generalize APPOINTMENT_TYPES/tracksWork/budget ordering off the new flags.
4. Build the type-management UI (list + editor, icon/theme pickers, field-list editor).
5. Backup/migration hardening + full test pa
```
