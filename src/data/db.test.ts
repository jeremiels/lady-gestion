import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, SCHEMA_VERSION } from "./db.ts";
import { DEFAULT_SEASON } from "./seasons.ts";

/**
 * The schema upgrades, exercised against databases that really were written by
 * the previous version rather than ones built with the current schema.
 *
 * This is the only code path in the app that runs on an install already holding
 * the user's data, and it gets exactly one chance: if it throws, Dexie leaves
 * the database unopenable and the app boots to an empty screen with the only
 * copy of the data stranded behind a failed version change.
 */

const DB_NAME = "lady-gestion";

/**
 * The stores as v1..v4 declared them — no index changed across those four, only
 * row shapes, and v5 adds a table none of them had. **Do not** update this to
 * track `STORES`, or the upgrades end up tested against themselves.
 */
const LEGACY_STORES = {
  horses: "id, name, updatedAt",
  events:
    "id, horseId, date, type, status, [horseId+date], [horseId+type], updatedAt",
  documents: "id, horseId, eventId, category, [horseId+category], updatedAt",
  documentBlobs: "documentId",
  rationItems: "id, horseId, [horseId+sortOrder], updatedAt",
  meta: "key",
};

const stamps = {
  ownerId: "owner-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

/** A ration row as v1 wrote it: a `seasonal` flag and no `season`. */
const v1Ration = (id: string, seasonal: boolean) => ({
  ...stamps,
  id,
  horseId: "horse-1",
  label: id,
  quantity: 2,
  unit: "kg",
  seasonal,
  sortOrder: 0,
});

/** An event row as v1 and v2 wrote it: no `vendor`, no `followUpInterval`. */
const preV3Event = (id: string) => ({
  ...stamps,
  id,
  horseId: "horse-1",
  type: "veto",
  title: id,
  date: "2026-06-15",
  time: null,
  status: "planned",
  amountCents: null,
  currency: "EUR",
  providerName: null,
  location: null,
  notes: null,
  recurrenceId: null,
});

/** An event row as v3 wrote it: the two v3 columns, but no `activity`. */
const preV4Event = (id: string) => ({
  ...preV3Event(id),
  vendor: null,
  followUpInterval: null,
});

/** An event row as v4 wrote it: complete, with a session on it. */
const v4Event = (id: string) => ({ ...preV4Event(id), activity: "longe" });

/**
 * An event row as v5 wrote it — every legacy column present, none folded into
 * `customFields` yet. `type` defaults to `veto` but is overridable, since which
 * columns the v6 fold keeps depends on the seeded type's own fields.
 */
const preV6Event = (id: string, type = "veto") => ({
  ...preV4Event(id),
  type,
  activity: null,
});

/** The stores a real v5 device's IndexedDB actually has — `LEGACY_STORES`
 * plus the `activities` table v5 introduced. */
const V5_STORES = { ...LEGACY_STORES, activities: "id, horseId, updatedAt" };

/** Writes a database already at v5, then closes it so `db` can upgrade it
 * straight to v6 — the one migration `writeLegacyDatabase` cannot exercise,
 * since its fixed `LEGACY_STORES` predates the `activities` table. */
const writeV5Database = async (rows: { events?: unknown[] }) => {
  const legacy = new Dexie(DB_NAME);
  legacy.version(5).stores(V5_STORES);
  await legacy.open();
  if (rows.events?.length) await legacy.table("events").bulkAdd(rows.events);
  legacy.close();
};

/** The stores a real v6 device's IndexedDB actually has — `V5_STORES` plus
 * the `eventTypes` table v6 introduced. */
const V6_STORES = {
  ...V5_STORES,
  eventTypes: "id, key, order, archived, updatedAt",
};

/**
 * The `alimentation` `eventTypes` row exactly as v6 wrote it — no `quantity`
 * field yet. Hand-frozen rather than read off the live `BUILT_IN_EVENT_TYPES`,
 * which now includes it — the same trap `LEGACY_STORES`'s own note warns
 * against for the stores above.
 */
const preV7AlimentationType = () => ({
  ...stamps,
  id: "alimentation",
  key: "alimentation",
  label: "Alimentation",
  icon: "carrot",
  theme: "yellow",
  isBuiltIn: true,
  isAppointment: false,
  tracksWork: false,
  archived: false,
  order: 1,
  fields: [
    { id: "counterparty", kind: "text", label: "Site", required: false },
    { id: "amountCents", kind: "cents", label: "Budget", required: false },
  ],
});

/** The stores a real v7 device has. v7 changed row content, not indexes, so
 * this is `V6_STORES` — restated rather than aliased, so the day v8's own
 * successor adds an index this constant does not silently follow it. */
const V7_STORES = { ...V6_STORES };

/**
 * An `eventTypes` row exactly as v7 wrote it — no `parentId`, and `icon`/
 * `theme` never nullable. Hand-frozen, for the reason `preV7AlimentationType`
 * and `LEGACY_STORES` both give: reading it off the live constants would
 * exercise the upgrade against its own output.
 */
const preV8VetoType = () => ({
  ...stamps,
  id: "veto",
  key: "veto",
  label: "Vétérinaire",
  icon: "firstAidKit",
  theme: "pink",
  isBuiltIn: true,
  isAppointment: true,
  tracksWork: false,
  archived: false,
  order: 6,
  fields: [
    { id: "counterparty", kind: "text", label: "Practicien", required: false },
  ],
});

/** Writes a database already at v7, then closes it so `db` can upgrade it
 * straight to v8. */
const writeV7Database = async (rows: { eventTypes?: unknown[] }) => {
  const legacy = new Dexie(DB_NAME);
  legacy.version(7).stores(V7_STORES);
  await legacy.open();
  if (rows.eventTypes?.length) {
    await legacy.table("eventTypes").bulkAdd(rows.eventTypes);
  }
  legacy.close();
};

const V8_STORES = { ...V7_STORES };

/**
 * The two rows v9 nests, and the parents they nest under, exactly as v8 wrote
 * them: roots, each with its own icon and theme.
 *
 * Hand-frozen for the reason the fixtures above give — reading them off
 * `BUILT_IN_EVENT_TYPES` would exercise the upgrade against its own output,
 * since that array already carries the nesting.
 *
 * The ids are deliberately *not* the keys. A seeded built-in has `id === key`
 * (`seedEventTypeDefs`), so a fixture that repeated that would pass whether the
 * migration resolved the parent's id or just assumed the key was one.
 */
const preV9Types = () => [
  {
    ...stamps,
    id: "type-alimentation",
    key: "alimentation",
    label: "Alimentation",
    icon: "carrot",
    theme: "yellow",
    parentId: null,
    isBuiltIn: true,
    isAppointment: false,
    tracksWork: false,
    archived: false,
    order: 1,
    fields: [],
  },
  { ...preV8VetoType(), id: "type-veto", parentId: null },
  {
    ...stamps,
    id: "type-cures",
    key: "cures",
    label: "Cures",
    icon: "pawPrint",
    theme: "purple",
    parentId: null,
    isBuiltIn: true,
    isAppointment: true,
    tracksWork: false,
    archived: false,
    order: 11,
    fields: [],
  },
  {
    ...stamps,
    id: "type-traitement",
    key: "traitement",
    label: "Traitement",
    icon: "info",
    theme: "orange",
    parentId: null,
    isBuiltIn: true,
    isAppointment: true,
    tracksWork: false,
    archived: false,
    order: 12,
    fields: [],
  },
];

/** Writes a database already at v8, then closes it so `db` can upgrade it
 * straight to v9. */
const writeV8Database = async (rows: { eventTypes?: unknown[] }) => {
  const legacy = new Dexie(DB_NAME);
  legacy.version(8).stores(V8_STORES);
  await legacy.open();
  if (rows.eventTypes?.length) {
    await legacy.table("eventTypes").bulkAdd(rows.eventTypes);
  }
  legacy.close();
};

const V9_STORES = { ...V8_STORES };

/**
 * The two rows v10 touches, exactly as v9 left them: `soins` and `osteo`,
 * both roots — `osteo` with its own icon and theme, unaffected by v9's own
 * migration since it was never one of the two rows that touched.
 *
 * Hand-frozen for the reason `preV9Types` gives: reading either off
 * `BUILT_IN_EVENT_TYPES` would exercise the upgrade against its own output,
 * since that array already carries both the nesting and `massage` itself.
 */
const preV10Types = () => [
  {
    ...stamps,
    id: "type-soins",
    key: "soins",
    label: "Soins",
    icon: "firstAidKit",
    theme: "pink",
    parentId: null,
    isBuiltIn: true,
    isAppointment: true,
    tracksWork: false,
    archived: false,
    order: 10,
    fields: [],
  },
  {
    ...stamps,
    id: "type-osteo",
    key: "osteo",
    label: "Ostéopathe",
    icon: "pawPrint",
    theme: "orange",
    parentId: null,
    isBuiltIn: true,
    isAppointment: true,
    tracksWork: false,
    archived: false,
    order: 7,
    fields: [],
  },
];

/** Writes a database already at v9, then closes it so `db` can upgrade it
 * straight to v10. */
const writeV9Database = async (rows: { eventTypes?: unknown[] }) => {
  const legacy = new Dexie(DB_NAME);
  legacy.version(9).stores(V9_STORES);
  await legacy.open();
  if (rows.eventTypes?.length) {
    await legacy.table("eventTypes").bulkAdd(rows.eventTypes);
  }
  legacy.close();
};

/** Writes a database already at v6, then closes it so `db` can upgrade it
 * straight to v7 — isolating that one migration the same way `writeV5Database`
 * isolates v5 -> v6. */
const writeV6Database = async (rows: { eventTypes?: unknown[] }) => {
  const legacy = new Dexie(DB_NAME);
  legacy.version(6).stores(V6_STORES);
  await legacy.open();
  if (rows.eventTypes?.length) {
    await legacy.table("eventTypes").bulkAdd(rows.eventTypes);
  }
  legacy.close();
};

/** Writes a database at `version`, then closes it so `db` can upgrade it. */
const writeLegacyDatabase = async (
  version: number,
  rows: { events?: unknown[]; rationItems?: unknown[]; horses?: unknown[] },
) => {
  const legacy = new Dexie(DB_NAME);
  legacy.version(version).stores(LEGACY_STORES);
  await legacy.open();

  for (const [table, values] of Object.entries(rows)) {
    if (values?.length) await legacy.table(table).bulkAdd(values);
  }
  legacy.close();
};

beforeEach(async () => {
  // Every test starts from no database at all, so opening `db` afterwards is a
  // real version change rather than a no-op on an already-current store.
  db.close();
  await Dexie.delete(DB_NAME);
});

afterEach(async () => {
  db.close();
  await Dexie.delete(DB_NAME);
});

describe("v1 -> v2: seasonal flag becomes a window", () => {
  it("gives a seasonal row the default window", async () => {
    await writeLegacyDatabase(1, {
      rationItems: [v1Ration("seasonal-row", true)],
    });

    await db.open();

    expect((await db.rationItems.get("seasonal-row"))?.season).toEqual(
      DEFAULT_SEASON,
    );
  });

  it("reads a non-seasonal row as fed all year", async () => {
    await writeLegacyDatabase(1, {
      rationItems: [v1Ration("year-round", false)],
    });

    await db.open();

    expect((await db.rationItems.get("year-round"))?.season).toBe(null);
  });

  it("drops the old flag instead of leaving it beside the new field", async () => {
    await writeLegacyDatabase(1, {
      rationItems: [v1Ration("seasonal-row", true)],
    });

    await db.open();

    // A stale duplicate is what the next reader trusts by mistake — and
    // `exportBackup` copies whatever is on the row into the backup file.
    expect(await db.rationItems.get("seasonal-row")).not.toHaveProperty(
      "seasonal",
    );
  });

  it("migrates every row, not just the first", async () => {
    await writeLegacyDatabase(1, {
      rationItems: [
        v1Ration("a", true),
        v1Ration("b", false),
        v1Ration("c", true),
      ],
    });

    await db.open();

    const rows = await db.rationItems.orderBy("id").toArray();
    expect(rows.map((row) => row.season)).toEqual([
      DEFAULT_SEASON,
      null,
      DEFAULT_SEASON,
    ]);
  });
});

describe("v2 -> v3: events gain vendor and followUpInterval", () => {
  // The two columns this version adds are no longer visible on their own by
  // the time `db.open()` returns — v6's fold (below) absorbs them into
  // `customFields` in the same upgrade chain — so what is left to pin here is
  // that an absent-not-`undefined` value survives all the way through rather
  // than the fold seeing an actual `undefined` and choking on it.
  it("folds an absent vendor/followUpInterval into customFields as null, not undefined", async () => {
    await writeLegacyDatabase(2, { events: [preV3Event("event-1")] });

    await db.open();

    const event = await db.events.get("event-1");
    expect(event?.customFields).toHaveProperty("counterparty", null);
    expect(event?.customFields).toHaveProperty("followUp", null);
  });

  it("migrates every event", async () => {
    await writeLegacyDatabase(2, {
      events: [preV3Event("a"), preV3Event("b"), preV3Event("c")],
    });

    await db.open();

    const events = await db.events.orderBy("id").toArray();
    expect(
      events.every((event) => event.customFields.counterparty === null),
    ).toBe(true);
  });

  it("leaves the rest of the row untouched", async () => {
    await writeLegacyDatabase(2, { events: [preV3Event("event-1")] });

    await db.open();

    expect(await db.events.get("event-1")).toMatchObject({
      title: "event-1",
      date: "2026-06-15",
      currency: "EUR",
      status: "planned",
    });
  });
});

describe("v3 -> v4: events gain activity", () => {
  // Same caveat as v2 -> v3 above: `activity` itself is not observable after
  // `db.open()`, only its fold into `customFields.activity` — and only for a
  // `tracksWork` type, which `veto` (the other fixtures' type) is not, so
  // these use `travail` instead.
  it("folds an absent activity into customFields as null, not undefined", async () => {
    await writeLegacyDatabase(3, {
      events: [{ ...preV4Event("event-1"), type: "travail" }],
    });

    await db.open();

    expect(await db.events.get("event-1")).toHaveProperty(
      "customFields.activity",
      null,
    );
  });

  it("migrates every event", async () => {
    await writeLegacyDatabase(3, {
      events: [
        { ...preV4Event("a"), type: "travail" },
        { ...preV4Event("b"), type: "travail" },
        { ...preV4Event("c"), type: "travail" },
      ],
    });

    await db.open();

    const events = await db.events.orderBy("id").toArray();
    expect(events.every((event) => event.customFields.activity === null)).toBe(
      true,
    );
  });

  it("leaves the rest of the row untouched", async () => {
    await writeLegacyDatabase(3, { events: [preV4Event("event-1")] });

    await db.open();

    expect(await db.events.get("event-1")).toMatchObject({
      title: "event-1",
      date: "2026-06-15",
      currency: "EUR",
      status: "planned",
    });
  });
});

describe("v4 -> v5: the activities table appears", () => {
  it("creates the store on a database that never had it", async () => {
    await writeLegacyDatabase(4, { events: [v4Event("event-1")] });

    await db.open();

    // Reaching the table at all is the assertion: on a database whose object
    // stores predate it, `db.activities` throws rather than returning empty.
    expect(await db.activities.count()).toBe(0);
  });

  it("leaves the existing rows alone", async () => {
    // `travail` is the type that keeps `activity` after v6's fold — `veto`,
    // `v4Event`'s default, has no `workActivity` field.
    await writeLegacyDatabase(4, {
      events: [{ ...v4Event("event-1"), type: "travail" }],
    });

    await db.open();

    // A new store means no rows to rewrite, and so no `.upgrade()` — which is
    // exactly what could silently drop data if one were added later. `activity`
    // has since folded into `customFields` by v6, run in the same chain.
    expect(await db.events.get("event-1")).toMatchObject({
      title: "event-1",
      date: "2026-06-15",
      customFields: { activity: "longe" },
    });
  });
});

describe("v5 -> v6: event types become data, events fold into customFields", () => {
  it("seeds the 14 built-in types", async () => {
    await writeV5Database({});

    await db.open();

    expect(await db.eventTypes.count()).toBe(14);
  });

  it("gives a seeded type the fields the app already offered under that type", async () => {
    await writeV5Database({});

    await db.open();

    const veto = await db.eventTypes.where("key").equals("veto").first();
    expect(veto).toMatchObject({
      label: "Vétérinaire",
      isBuiltIn: true,
      isAppointment: true,
      tracksWork: false,
    });
    expect(veto?.fields.map((field) => field.kind).sort()).toEqual([
      "cents",
      "followUp",
      "text",
    ]);
  });

  it("finishes wiring up the four previously-broken types, correcting coucours to concours", async () => {
    await writeV5Database({});

    await db.open();

    const keys = (await db.eventTypes.toArray()).map((type) => type.key).sort();
    expect(keys).toEqual([
      "achat",
      "alimentation",
      "concours",
      "cours",
      "cures",
      "dentiste",
      "marechal",
      "massage",
      "osteo",
      "pension",
      "soins",
      "traitement",
      "travail",
      "veto",
    ]);
  });

  it("folds a care event's practitioner and follow-up into customFields", async () => {
    await writeV5Database({
      events: [
        {
          ...preV6Event("event-1", "veto"),
          providerName: "Dr Martin",
          followUpInterval: { amount: 6, unit: "week" },
        },
      ],
    });

    await db.open();

    const event = await db.events.get("event-1");
    expect(event?.customFields.counterparty).toBe("Dr Martin");
    expect(event?.customFields.followUp).toBe("6w");
  });

  it("folds a purchase's vendor into the same counterparty key a care event uses", async () => {
    await writeV5Database({
      events: [{ ...preV6Event("event-1", "achat"), vendor: "Décathlon" }],
    });

    await db.open();

    expect((await db.events.get("event-1"))?.customFields.counterparty).toBe(
      "Décathlon",
    );
  });

  it("drops amountCents entirely for a type with no amount field", async () => {
    await writeV5Database({
      events: [
        {
          ...preV6Event("event-1", "travail"),
          activity: "longe",
          amountCents: 4500,
        },
      ],
    });

    await db.open();

    const event = await db.events.get("event-1");
    expect(event?.customFields).not.toHaveProperty("amountCents");
    expect(event?.customFields.activity).toBe("longe");
  });

  it("renames a coucours-typed event to concours", async () => {
    await writeV5Database({ events: [preV6Event("event-1", "coucours")] });

    await db.open();

    expect((await db.events.get("event-1"))?.type).toBe("concours");
  });

  it("removes the legacy columns from every migrated row", async () => {
    await writeV5Database({ events: [preV6Event("event-1", "veto")] });

    await db.open();

    const event = await db.events.get("event-1");
    expect(event).not.toHaveProperty("providerName");
    expect(event).not.toHaveProperty("vendor");
    expect(event).not.toHaveProperty("followUpInterval");
    expect(event).not.toHaveProperty("activity");
    expect(event).not.toHaveProperty("amountCents");
  });
});

describe("v6 -> v7: alimentation gains a quantity field", () => {
  it("appends the field to the existing row", async () => {
    await writeV6Database({ eventTypes: [preV7AlimentationType()] });

    await db.open();

    const alimentation = await db.eventTypes
      .where("id")
      .equals("alimentation")
      .first();
    expect(alimentation?.fields.map((field) => field.id).sort()).toEqual([
      "amountCents",
      "counterparty",
      "quantity",
    ]);
  });

  it("leaves a type with no quantity field untouched", async () => {
    const veto = {
      ...stamps,
      id: "veto",
      key: "veto",
      label: "Vétérinaire",
      icon: "firstAidKit",
      theme: "pink",
      isBuiltIn: true,
      isAppointment: true,
      tracksWork: false,
      archived: false,
      order: 6,
      fields: [
        {
          id: "counterparty",
          kind: "text",
          label: "Practicien",
          required: false,
        },
      ],
    };
    await writeV6Database({ eventTypes: [preV7AlimentationType(), veto] });

    await db.open();

    const stored = await db.eventTypes.where("id").equals("veto").first();
    expect(stored?.fields).toEqual(veto.fields);
  });
});

describe("v7 -> v8: event types gain a parent", () => {
  it("gives every existing row an explicit null parent", async () => {
    await writeV7Database({ eventTypes: [preV8VetoType()] });

    await db.open();

    const stored = await db.eventTypes.get("veto");
    // `null`, not absent: `undefined` contradicts the declared type and is
    // dropped by `JSON.stringify` on the next backup export, so the file would
    // never carry the column and never heal itself.
    expect(stored).toHaveProperty("parentId", null);
  });

  it("leaves the presentation columns alone — they were never optional before", async () => {
    await writeV7Database({ eventTypes: [preV8VetoType()] });

    await db.open();

    expect(await db.eventTypes.get("veto")).toMatchObject({
      icon: "firstAidKit",
      theme: "pink",
    });
  });

  it("keeps a real parent when the row already has one", async () => {
    // A device patched live, backed up, then restored onto itself replays this
    // upgrade over rows that are already past it.
    await writeV7Database({
      eventTypes: [
        { ...preV8VetoType(), id: "soins", key: "soins" },
        { ...preV8VetoType(), parentId: "soins" },
      ],
    });

    await db.open();

    expect((await db.eventTypes.get("veto"))?.parentId).toBe("soins");
  });
});

describe("v8 -> v9: cures and traitement file under a parent", () => {
  it("attaches each one and clears the presentation it stops owning", async () => {
    await writeV8Database({ eventTypes: preV9Types() });

    await db.open();

    // The parent's `id`, resolved from the table — not its `key`, which these
    // fixtures deliberately differ from.
    expect(await db.eventTypes.get("type-cures")).toMatchObject({
      parentId: "type-alimentation",
      icon: null,
      theme: null,
    });
    expect(await db.eventTypes.get("type-traitement")).toMatchObject({
      parentId: "type-veto",
      icon: null,
      theme: null,
    });
  });

  it("leaves the parents, and every other root, exactly as they were", async () => {
    await writeV8Database({ eventTypes: preV9Types() });

    await db.open();

    expect(await db.eventTypes.get("type-alimentation")).toMatchObject({
      parentId: null,
      icon: "carrot",
      theme: "yellow",
    });
    expect(await db.eventTypes.get("type-veto")).toMatchObject({
      parentId: null,
      icon: "firstAidKit",
      theme: "pink",
    });
  });

  it("keeps a parent the user already chose", async () => {
    // Replayed by a device patched live, backed up, then restored onto itself
    // — and the one case where re-running this would destroy a real choice.
    const types = preV9Types().map((type) =>
      type.key === "cures" ? { ...type, parentId: "type-veto" } : type,
    );
    await writeV8Database({ eventTypes: types });

    await db.open();

    expect((await db.eventTypes.get("type-cures"))?.parentId).toBe("type-veto");
    expect((await db.eventTypes.get("type-cures"))?.theme).toBe("purple");
  });

  it("does nothing when the parent is not in the catalogue at all", async () => {
    // A type the user deleted. Writing a dangling `parentId` would leave a
    // link `resolveCatalogue` silently reads back as "root" anyway — the
    // nesting simply does not happen, and the row keeps what it can draw.
    const types = preV9Types().filter((type) => type.key !== "alimentation");
    await writeV8Database({ eventTypes: types });

    await db.open();

    expect(await db.eventTypes.get("type-cures")).toMatchObject({
      parentId: null,
      icon: "pawPrint",
      theme: "purple",
    });
  });
});

describe("v9 -> v10: osteo files under soins, massage is seeded as its sibling", () => {
  it("attaches osteo to soins, clearing its theme but keeping its icon", async () => {
    await writeV9Database({ eventTypes: preV10Types() });

    await db.open();

    // Unlike v9's own `cures`/`traitement`, `osteo`'s icon is kept rather
    // than nulled — it is a real, already-shipped icon, not a placeholder.
    expect(await db.eventTypes.get("type-osteo")).toMatchObject({
      parentId: "type-soins",
      icon: "pawPrint",
      theme: null,
    });
  });

  it("leaves soins, and every other root, exactly as it was", async () => {
    await writeV9Database({ eventTypes: preV10Types() });

    await db.open();

    expect(await db.eventTypes.get("type-soins")).toMatchObject({
      parentId: null,
      icon: "firstAidKit",
      theme: "pink",
    });
  });

  it("keeps a parent the user already chose", async () => {
    // Replayed by a device patched live, backed up, then restored onto
    // itself — the one case where re-running this would destroy a real
    // choice.
    const types = preV10Types().map((type) =>
      type.key === "osteo" ? { ...type, parentId: "type-soins" } : type,
    );
    await writeV9Database({ eventTypes: types });

    await db.open();

    expect((await db.eventTypes.get("type-osteo"))?.theme).toBe("orange");
  });

  it("does nothing when the parent is not in the catalogue at all", async () => {
    // A device where `soins` was deleted. A dangling `parentId` would leave a
    // link `resolveCatalogue` silently reads back as "root" anyway.
    const types = preV10Types().filter((type) => type.key !== "soins");
    await writeV9Database({ eventTypes: types });

    await db.open();

    expect(await db.eventTypes.get("type-osteo")).toMatchObject({
      parentId: null,
      icon: "pawPrint",
      theme: "orange",
    });
  });

  it("seeds massage as a new child of soins", async () => {
    await writeV9Database({ eventTypes: preV10Types() });

    await db.open();

    const massage = await db.eventTypes.where("key").equals("massage").first();
    expect(massage).toMatchObject({
      label: "Massage",
      isBuiltIn: true,
      isAppointment: true,
    });
    const soins = await db.eventTypes.where("key").equals("soins").first();
    expect(massage?.parentId).toBe(soins?.id);
  });

  it("does not double massage when the file already carries it", async () => {
    // Replayed the same way the reparenting guard above is.
    const massage = {
      ...stamps,
      id: "type-massage",
      key: "massage",
      label: "Massage",
      icon: null,
      theme: null,
      parentId: "type-soins",
      isBuiltIn: true,
      isAppointment: true,
      tracksWork: false,
      archived: false,
      order: 13,
      fields: [],
    };
    await writeV9Database({ eventTypes: [...preV10Types(), massage] });

    await db.open();

    expect(await db.eventTypes.where("key").equals("massage").count()).toBe(1);
  });
});

describe("a v1 database upgrading all the way", () => {
  it("runs every upgrade in sequence", async () => {
    await writeLegacyDatabase(1, {
      rationItems: [v1Ration("ration-1", true)],
      events: [preV3Event("event-1")],
    });

    await db.open();

    expect((await db.rationItems.get("ration-1"))?.season).toEqual(
      DEFAULT_SEASON,
    );
    expect(await db.events.get("event-1")).toHaveProperty(
      "customFields.counterparty",
      null,
    );
    expect(await db.activities.count()).toBe(0);
    expect(await db.eventTypes.count()).toBe(14);
    // Seeded by v6 — from the current catalogue, so already nested — and left
    // alone by v9 and v10, whose guards each skip a row that is not a root.
    // Both routes to the same four children is the point: a fresh seed and a
    // device that upgraded all the way through have to agree on the finished
    // shape.
    const catalogue = await db.eventTypes.toArray();
    expect(
      catalogue
        .filter((type) => type.parentId !== null)
        .map((type) => type.key)
        .sort(),
    ).toEqual(["cures", "massage", "osteo", "traitement"]);
  });

  it("opens at the version the backup envelope advertises", async () => {
    await writeLegacyDatabase(1, {});

    await db.open();

    // `exportBackup` stamps `SCHEMA_VERSION` onto every file it writes; if the
    // constant and the live database drift, a restore reads the wrong shape.
    expect(db.verno).toBe(SCHEMA_VERSION);
  });
});
