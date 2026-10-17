import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db.ts";
import { seedIfEmpty } from "../seed.ts";
import { sumByCategory } from "../budget.ts";
import * as categoriesRepo from "../repositories/categories.repo.ts";
import * as postsRepo from "../repositories/posts.repo.ts";
import type { Category, Post } from "../types.ts";
import { exportBackup } from "./export.ts";
import { automaticBackup } from "./file.ts";
import { importBackup, planRestore } from "./restore.ts";
import { checkBackup } from "./validate.ts";
import { pickedFile, resetDatabase } from "./snapshot.fixtures.ts";

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
 * `isScalarBag` in `validate.ts`. A rule that rejects a row she actually has is
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

// Named in the suite title, not just chosen silently. The entire value of this
// file is "it ran against her real, current data", and with more than one
// export on disk that claim is unverifiable from the output otherwise.
const label = newest?.split("/").at(-1) ?? "no export found";

type RealSnapshot = {
  ownerId: string;
  tables: Record<string, { id: string }[]>;
};

describe.skipIf(newest === undefined)(
  `importBackup — against the real backup (${label})`,
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

    it("gives a new phone back exactly what the file holds, orphaned customFields keys included", async () => {
      // The path she takes: a fresh install seeds its demo, then she picks her
      // latest backup.
      await seedIfEmpty();
      const snapshot = real();
      await importBackup(checkBackup(snapshot));

      // Reported so the run says how much data it actually covered.
      expect(
        rowCount(snapshot),
        `${label} carried ${rowCount(snapshot)} rows`,
      ).toBeGreaterThan(0);
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

      await importBackup(checkBackup(snapshot));

      const stored = await db.posts.toArray();
      for (const key of new Set(orphans)) {
        expect(stored.some((post) => key in post.customFields)).toBe(true);
      }
    });

    it("gives the same database when restored a second time", async () => {
      const snapshot = real();
      await importBackup(checkBackup(snapshot));
      const after = await exportBackup();

      await importBackup(checkBackup(snapshot));

      expect((await exportBackup()).tables).toStrictEqual(after.tables);
    });

    it("asks for a copy over her data, not over a fresh install", async () => {
      // A new phone: nothing but the seed, so "Restaurer un fichier" asks for
      // no copy first, and none of her files is only here.
      await seedIfEmpty();
      const fresh = await planRestore(pickedFile(real()));
      expect(fresh.copy).toBeNull();
      expect(fresh.unsentFiles).toBe(0);

      // Once restored, it is hers: restoring over it takes a copy of it first.
      await importBackup(fresh.backup);
      const over = await planRestore(pickedFile(real()));
      expect(over.copy?.tables).toStrictEqual((await exportBackup()).tables);
      expect(over.unsentFiles).toBe(0);
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

      await importBackup(checkBackup(snapshot));

      for (const post of deleted) {
        expect((await db.posts.get(post.id))?.deletedAt).toBe(post.deletedAt);
      }
    });

    it("writes no category on the launch after a restore", async () => {
      // Her categories are hers: the next launch must not write this build's
      // catalogue over the ones the file brought back.
      await seedIfEmpty();
      await importBackup(checkBackup(real()));
      const before = await db.categories.toArray();
      const bulkPut = vi.spyOn(db.categories, "bulkPut");

      await seedIfEmpty();

      expect(bulkPut).not.toHaveBeenCalled();
      expect(await db.categories.toArray()).toStrictEqual(before);
      bulkPut.mockRestore();
    });

    it("adds up to the same budget the file holds, read through the budget role", async () => {
      // The ledger read straight from the file: every live, uncancelled post
      // of a category switched on, with a number under
      // `customFields.amountCents`.
      const snapshot = real();
      const posts = snapshot.tables.posts as unknown as Post[];
      const enabled = new Set(
        (snapshot.tables.categories as unknown as Category[])
          .filter((type) => type.enabled && type.deletedAt === null)
          .map((type) => type.key),
      );
      const before = new Map<string, number>();
      for (const post of posts) {
        const amount = post.customFields.amountCents;
        if (
          post.deletedAt !== null ||
          post.status === "cancelled" ||
          !enabled.has(post.categoryKey) ||
          typeof amount !== "number"
        ) {
          continue;
        }
        before.set(
          post.categoryKey,
          (before.get(post.categoryKey) ?? 0) + amount,
        );
      }
      expect(before.size, "this backup records no spending").toBeGreaterThan(0);

      await importBackup(checkBackup(snapshot));

      const types = await categoriesRepo.listAll();
      const after = new Map<string, number>();
      for (const horse of snapshot.tables.horses!) {
        const ledger = await postsRepo.listBudget(horse.id);
        for (const slice of sumByCategory(ledger, types)) {
          after.set(slice.type, (after.get(slice.type) ?? 0) + slice.cents);
        }
      }
      // `sumByCategory` rolls children into their root; do the same to `before`.
      const rootKey = (key: string) => {
        const type = types.find((one) => one.key === key);
        const parent = types.find((one) => one.id === type?.parentId);
        return parent?.key ?? key;
      };
      const rolled = new Map<string, number>();
      for (const [key, cents] of before) {
        rolled.set(rootKey(key), (rolled.get(rootKey(key)) ?? 0) + cents);
      }
      expect(after).toEqual(rolled);
    });

    it("adopts the file's owner once the transaction has committed", async () => {
      const snapshot = real();
      await importBackup(checkBackup(snapshot));

      expect((await db.meta.get("ownerId"))?.value).toBe(snapshot.ownerId);
    });

    it("is what an automatic backup sends, whole", async () => {
      const snapshot = real();
      await importBackup(checkBackup(snapshot));

      const backup = await automaticBackup();

      // Never taken for an untouched demo, which is the one database an
      // automatic backup sends nothing of.
      expect(backup).not.toBeNull();
      const sent = JSON.parse(backup!.json) as RealSnapshot;
      expect(rowCount(sent)).toBeGreaterThanOrEqual(rowCount(snapshot));

      // And the file it sends restores, every row of it.
      await resetDatabase();
      await importBackup(checkBackup(sent));
      expect(rowCount(await exportBackup())).toBe(rowCount(sent));
    });
  },
);
