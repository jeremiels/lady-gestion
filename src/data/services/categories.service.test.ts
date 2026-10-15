import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db.ts";
import {
  BUILT_IN_CATEGORY_ROWS,
  makePost,
  resetDb,
} from "../__tests__/factories.ts";
import { addField, draftOf, newCategoryDraft } from "../category-editor.ts";
import { deleteCategory, saveCategory } from "./categories.service.ts";

beforeEach(resetDb);

const stored = (key: string) => db.categories.get({ key });
const builtIn = (key: string) =>
  BUILT_IN_CATEGORY_ROWS.find((type) => type.key === key)!;

const assurance = () => ({
  ...newCategoryDraft(),
  label: "  Assurance ",
  icon: "file" as const,
  theme: "gold" as const,
  fields: addField(newCategoryDraft().fields, "money").fields,
});

describe("saveCategory — a new category", () => {
  it("is hers, keyed by its own id, last among the roots", async () => {
    const result = await saveCategory({ existing: null, draft: assurance() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { category } = result;
    expect(category).toMatchObject({
      label: "Assurance",
      key: category.id,
      isBuiltIn: false,
      enabled: true,
      parentId: null,
      order:
        Math.max(
          ...BUILT_IN_CATEGORY_ROWS.filter(
            (type) => type.parentId === null,
          ).map((type) => type.order),
        ) + 1,
    });
    expect(await stored(category.key)).toEqual(category);
  });

  it("writes nothing when the draft cannot be saved", async () => {
    const before = await db.categories.count();

    const result = await saveCategory({
      existing: null,
      draft: newCategoryDraft(),
    });

    expect(result.ok).toBe(false);
    expect(await db.categories.count()).toBe(before);
  });

  it("drops a child's own colour — it takes its parent's", async () => {
    const result = await saveCategory({
      existing: null,
      draft: { ...assurance(), parentId: builtIn("veto").id },
    });

    expect(result.ok && result.category.theme).toBeNull();
  });
});

describe("saveCategory — an existing category", () => {
  it("saves her edit over a built-in, stamping it as hers", async () => {
    const veto = (await stored("veto"))!;
    const draft = { ...draftOf(veto), label: "Véto" };

    const result = await saveCategory({ existing: veto, draft });

    const after = (await stored("veto"))!;
    expect(result.ok).toBe(true);
    expect(after.label).toBe("Véto");
    expect(after.updatedAt > veto.updatedAt).toBe(true);
    expect(after.fields).toEqual(veto.fields);
  });

  it("writes nothing for a draft that changes nothing", async () => {
    const veto = (await stored("veto"))!;
    // Rebuilt the way the editor rebuilds a field: same data, other key order.
    const draft = {
      ...draftOf(veto),
      fields: veto.fields.map((field) =>
        Object.fromEntries(Object.entries(field).reverse()),
      ) as typeof veto.fields,
    };

    await saveCategory({ existing: veto, draft });

    expect(await stored("veto")).toEqual(veto);
  });

  it("reports a category deleted underneath it", async () => {
    const veto = (await stored("veto"))!;
    await db.categories.put({ ...veto, deletedAt: "2026-01-01T00:00:00.000Z" });

    const result = await saveCategory({
      existing: veto,
      draft: { ...draftOf(veto), label: "Véto" },
    });

    expect(result.ok).toBe(false);
  });
});

describe("deleteCategory", () => {
  it("deletes a category no post is filed under", async () => {
    const pension = (await stored("pension"))!;

    expect(await deleteCategory(pension.id)).toBe(true);
    expect((await stored("pension"))?.deletedAt).not.toBeNull();
  });

  it("refuses while a post is filed under it, and writes nothing", async () => {
    await db.posts.add(makePost({ categoryKey: "pension" }));
    const pension = (await stored("pension"))!;

    expect(await deleteCategory(pension.id)).toBe(false);
    expect(await stored("pension")).toEqual(pension);
  });

  it("does not count a deleted post", async () => {
    await db.posts.add(
      makePost({
        categoryKey: "pension",
        deletedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    const pension = (await stored("pension"))!;

    expect(await deleteCategory(pension.id)).toBe(true);
  });
});
