import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db.ts";
import { seedIfEmpty } from "../seed.ts";
import type { Post } from "../types.ts";
import { exportBackup, importBackup } from "./snapshot.ts";
import { resetDatabase } from "./snapshot.fixtures.ts";

/**
 * The restore, run against the **real** database it exists to protect.
 *
 * `backup/` holds the live user's own exports and is gitignored — this repo is
 * deployed publicly. So this suite reads whatever is there at run time and
 * skips itself when there is nothing, rather than committing a copy of
 * someone's data to make a test deterministic.
 *
 * Why it is worth having anyway: every other suite here runs against fixtures
 * written to satisfy the code. This one runs against rows that were not,
 * including a `customFields` key no category declares any more — see
 * `assertRows` in `snapshot.ts`. A rule that rejects a row she actually has is
 * a wrong rule, and this is the only place that can say so.
 *
 * To run it, drop a real export into `backup/`. Without one it reports as
 * skipped, which is the honest result — not a pass.
 *
 * Read through Vite's glob rather than `node:fs`: the app tsconfig types only
 * `vite/client`, and this suite has no business being the one file that drags
 * node types into `src`.
 */
const files = import.meta.glob("../../../backup/lady-gestion-*.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Newest by filename — exports are timestamped, so lexical order is chronological. */
const newest = Object.keys(files).sort().at(-1);

type RealSnapshot = {
  schemaVersion: number;
  ownerId: string;
  tables: Record<string, { id: string }[]>;
};

describe.skipIf(newest === undefined)(
  "importBackup — against the real backup",
  () => {
    const real = (): RealSnapshot =>
      JSON.parse(files[newest as string]!) as RealSnapshot;

    const rowCount = (snapshot: RealSnapshot) =>
      Object.values(snapshot.tables).reduce(
        (total, rows) => total + rows.length,
        0,
      );

    const byId = (rows: { id: string }[]) =>
      Object.fromEntries(rows.map((row) => [row.id, row]));

    beforeEach(resetDatabase);

    it("imports every row, on an empty database", async () => {
      const snapshot = real();
      const result = await importBackup(snapshot);

      // Nothing rejected, nothing skipped: an empty database has no local copy
      // to lose a last-write-wins argument to.
      expect(result.imported).toBe(rowCount(snapshot));
      expect(result.skipped).toBe(0);
    });

    it("round-trips losslessly, orphaned customFields keys included", async () => {
      const snapshot = real();
      await importBackup(snapshot);

      const exported = await exportBackup();
      for (const table of Object.keys(snapshot.tables)) {
        expect(
          byId(exported.tables[table as keyof typeof exported.tables]),
          `table ${table} did not survive the round trip`,
        ).toStrictEqual(byId(snapshot.tables[table]!));
      }
    });

    it("keeps a customFields key no category declares any more", async () => {
      const snapshot = real();

      const declared = new Set<string>();
      const walk = (field: { id: string; reveals?: { id: string }[] }) => {
        declared.add(field.id);
        field.reveals?.forEach(walk);
      };
      for (const category of snapshot.tables.categories as unknown as {
        fields: { id: string; reveals?: { id: string }[] }[];
      }[]) {
        category.fields.forEach(walk);
      }

      const orphans = (snapshot.tables.posts as unknown as Post[]).flatMap(
        (post) =>
          Object.keys(post.customFields).filter((key) => !declared.has(key)),
      );

      // If this ever reads zero the case has stopped being exercised — say so
      // rather than passing vacuously.
      expect(
        orphans.length,
        "this backup no longer carries an orphaned customFields key; the rule is untested",
      ).toBeGreaterThan(0);

      await importBackup(snapshot);

      const stored = await db.posts.toArray();
      for (const key of new Set(orphans)) {
        expect(stored.some((post) => key in post.customFields)).toBe(true);
      }
    });

    it("is idempotent: a second import writes nothing", async () => {
      const snapshot = real();
      await importBackup(snapshot);
      const after = await exportBackup();

      const second = await importBackup(snapshot);

      expect(second.imported).toBe(0);
      expect(second.skipped).toBe(rowCount(snapshot));
      expect((await exportBackup()).tables).toStrictEqual(after.tables);
    });

    it("brings tombstones back as tombstones", async () => {
      const snapshot = real();
      const deleted = (snapshot.tables.posts as unknown as Post[]).filter(
        (post) => post.deletedAt !== null,
      );
      expect(
        deleted.length,
        "this backup has no soft-deleted posts; the case is untested",
      ).toBeGreaterThan(0);

      await importBackup(snapshot);

      for (const post of deleted) {
        expect((await db.posts.get(post.id))?.deletedAt).toBe(post.deletedAt);
      }
    });

    it("lets the file's categories win over a device that just seeded its own", async () => {
      // The real restore path: a fresh install seeds 14 built-ins moments
      // before the user imports. `yieldsToFile` is what stops that seed
      // outvoting the file, and every one of her categories is unedited, so it
      // applies to all of them.
      await seedIfEmpty();
      const snapshot = real();

      await importBackup(snapshot);

      const stored = await db.categories.toArray();
      for (const category of snapshot.tables.categories as unknown as {
        id: string;
        ownerId: string;
      }[]) {
        const local = stored.find((row) => row.id === category.id);
        expect(
          local?.ownerId,
          `category ${category.id} kept the seed's owner`,
        ).toBe(category.ownerId);
      }
    });

    it("adopts the file's owner once the transaction has committed", async () => {
      const snapshot = real();
      await importBackup(snapshot);

      expect((await db.meta.get("ownerId"))?.value).toBe(snapshot.ownerId);
    });

    it("leaves the user with one horse, not two", async () => {
      // `clearUntouchedSeedData` runs inside the restore's transaction now; the
      // demo horse must be gone and only the file's must remain.
      await seedIfEmpty();
      const snapshot = real();

      await importBackup(snapshot);

      expect(await db.horses.count()).toBe(snapshot.tables.horses!.length);
    });
  },
);
