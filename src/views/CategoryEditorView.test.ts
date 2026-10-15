import { html } from "lit";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { db } from "../data/db.ts";
import { makePost, resetDb } from "../data/__tests__/factories.ts";
import { fixture, settled, waitFor } from "../components/__tests__/fixture.ts";
import "./CategoryEditorView.ts";
import type { CategoryEditorView } from "./CategoryEditorView.ts";
import type { CategoryEditor } from "../components/category-editor/category-editor.ts";
import type { CategoryFields } from "../components/category-fields/category-fields.ts";
import type { FieldSheet } from "../components/field-sheet/field-sheet.ts";
import type { AppSwitch } from "../components/app-switch/app-switch.ts";

/** Built-in rows carry a prefixed id in tests — see `factories.ts`. */
const VETO = "event-type-veto";

const mount = async (categoryId: string | null) => {
  const el = await fixture<CategoryEditorView>(
    html`<category-editor-view
      .categoryId=${categoryId}
    ></category-editor-view>`,
  );
  await waitFor(el, () => editor(el)?.draft !== null);
  return el;
};

const editor = (el: CategoryEditorView) =>
  el.querySelector<CategoryEditor>("category-editor");
const fields = (el: CategoryEditorView) =>
  editor(el)!.renderRoot.querySelector<CategoryFields>("category-fields")!;
const sheet = (el: CategoryEditorView) =>
  editor(el)!.renderRoot.querySelector<FieldSheet>("field-sheet")!;

const typeLabel = async (el: CategoryEditorView, value: string) => {
  const input = editor(el)!
    .renderRoot.querySelector("app-input")!
    .renderRoot.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(
    new InputEvent("input", { bubbles: true, composed: true }),
  );
  await settled(el);
  await settled(editor(el)!);
};

const flush = async (el: CategoryEditorView) => {
  await settled(el);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await settled(el);
};

/**
 * Saving leaves through the real Navigation API — intercepted for the file, as
 * `PostDetailView.test.ts` does, so it does not tear the runner's page down.
 */
let keeper: AbortController;
let startUrl: string;

beforeAll(() => {
  startUrl = location.href;
  keeper = new AbortController();
  navigation.addEventListener(
    "navigate",
    (event) => {
      if (!event.canIntercept || event.navigationType === "reload") return;
      event.intercept({ handler: async () => {} });
    },
    { signal: keeper.signal },
  );
});

afterAll(() => keeper.abort());

afterEach(async () => {
  if (location.href !== startUrl) {
    await navigation
      .navigate(startUrl, { history: "replace" })
      .finished?.catch(() => {});
  }
});

beforeEach(resetDb);

describe("category-editor-view", () => {
  it("opens a built-in on its own form", async () => {
    const el = await mount(VETO);

    const labels = [
      ...fields(el).renderRoot.querySelectorAll(".open__label"),
    ].map((label) => label.textContent);
    expect(labels).toEqual([
      "Nom",
      "Date",
      "Practicien",
      "Budget",
      "Planifier un rendez-vous",
      "Note",
    ]);
  });

  it("saves her edit only on Enregistrer", async () => {
    const el = await mount(VETO);

    await typeLabel(el, "Véto");
    expect((await db.categories.get(VETO))?.label).toBe("Vétérinaire");

    el.querySelector<HTMLButtonElement>(".category-editor-view__save")!.click();
    await flush(el);

    expect((await db.categories.get(VETO))?.label).toBe("Véto");
  });

  it("asks before leaving with changes, and not without", async () => {
    const el = await mount(VETO);
    const back = el.querySelector<HTMLButtonElement>(
      ".category-editor-view__back",
    )!;
    const discard = () =>
      el.querySelector<HTMLElement & { open: boolean }>("app-modal")!.open;

    await typeLabel(el, "Véto");
    back.click();
    await settled(el);

    expect(discard()).toBe(true);
  });

  it("refuses to save a new category with no name, icon or colour, and says why", async () => {
    const el = await mount(null);
    const before = await db.categories.count();

    el.querySelector<HTMLButtonElement>(".category-editor-view__save")!.click();
    await flush(el);

    expect(await db.categories.count()).toBe(before);
    expect(editor(el)!.errors).toMatchObject({
      label: expect.any(String),
      icon: expect.any(String),
      theme: expect.any(String),
    });
  });

  it("offers to delete only a category no post is filed under", async () => {
    await db.posts.add(makePost({ categoryKey: "veto" }));
    const withPosts = await mount(VETO);
    await waitFor(
      withPosts,
      () => !!withPosts.querySelector(".category-editor-view__note"),
    );
    expect(withPosts.querySelector(".category-editor-view__delete")).toBeNull();

    const empty = await mount("event-type-pension");
    await waitFor(
      empty,
      () => !!empty.querySelector(".category-editor-view__delete"),
    );
  });

  it("makes a field the intervenant from its sheet, leaving the budget alone", async () => {
    const el = await mount("event-type-cours");
    const coach = [
      ...fields(el).renderRoot.querySelectorAll<HTMLButtonElement>(".open"),
    ].find((button) => button.textContent?.includes("Coach"))!;
    coach.click();
    await settled(editor(el)!);
    await settled(sheet(el));

    const linked = sheet(el).renderRoot.querySelector<AppSwitch>(
      'app-switch[name="linked"]',
    )!;
    linked.renderRoot.querySelector("input")!.click();
    await settled(linked);
    sheet(el).renderRoot.querySelector("form")!.requestSubmit();
    await settled(editor(el)!);

    const draft = editor(el)!.draft!;
    expect(draft.fields.find((field) => field.id === "coach")?.role).toBe(
      "counterparty",
    );
    // Budget stays where it was.
    expect(draft.fields.find((field) => field.id === "amountCents")?.role).toBe(
      "budget",
    );
  });
});
