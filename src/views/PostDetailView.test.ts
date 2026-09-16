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
import "./PostDetailView.ts";
import type { PostDetailView } from "./PostDetailView.ts";

/**
 * Deleting navigates back to the list through the real Navigation API — see
 * `router.test.ts` for why a file-scoped keeper is what makes that safe to
 * drive inside the runner's own page instead of tearing down the test run.
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

const mount = (postId: string) =>
  fixture<PostDetailView>(
    html`<post-detail-view .postId=${postId}></post-detail-view>`,
  );

const actionLabeled = (el: PostDetailView, label: string) =>
  [...el.querySelectorAll<HTMLButtonElement>(".post-detail__action")].find(
    (button) => button.textContent?.includes(label),
  )!;

const dialogButtonLabeled = (el: PostDetailView, label: string) =>
  [...el.querySelectorAll<HTMLButtonElement>(".post-detail__button")].find(
    (button) => button.textContent?.includes(label),
  )!;

beforeEach(resetDb);

describe("post-detail-view", () => {
  it("shows a not-found state for an id with no matching event", async () => {
    const el = await mount("missing");
    await waitFor(el, () => el.textContent!.includes("introuvable"));

    expect(el.querySelector(".post-detail__back-link")).not.toBeNull();
  });

  it("shows a care event’s practitioner and a purchase’s vendor, never the other", async () => {
    await db.posts.bulkAdd([
      makePost({
        id: "care-1",
        categoryKey: "veto",
        customFields: { counterparty: "Dr. Dupont", amountCents: 4500 },
      }),
      makePost({
        id: "purchase-1",
        categoryKey: "achat",
        customFields: { counterparty: "Décathlon", amountCents: 2000 },
      }),
    ]);

    const care = await mount("care-1");
    await waitFor(care, () => care.textContent!.includes("Practicien"));
    expect(care.textContent).toContain("Dr. Dupont");
    expect(care.textContent).not.toContain("Site");

    const purchase = await mount("purchase-1");
    await waitFor(purchase, () => purchase.textContent!.includes("Site"));
    expect(purchase.textContent).toContain("Décathlon");
    expect(purchase.textContent).not.toContain("Practicien");
  });

  it("shows an alimentation event’s quantity, already display-ready", async () => {
    await db.posts.bulkAdd([
      makePost({
        id: "alimentation-1",
        categoryKey: "alimentation",
        customFields: { quantity: "40 mL" },
      }),
      makePost({
        id: "care-3",
        categoryKey: "veto",
        customFields: { counterparty: "Dr. Dupont" },
      }),
    ]);

    const el = await mount("alimentation-1");
    await waitFor(el, () => el.textContent!.includes("Quantité du produit"));
    expect(el.textContent).toContain("40 mL");

    // Driven by the value being present, like every other custom field row —
    // a type with no quantity field never shows it.
    const care = await mount("care-3");
    await waitFor(care, () => care.textContent!.includes("Practicien"));
    expect(care.textContent).not.toContain("Quantité du produit");
  });

  it("shows a travail event’s activity by its label, not its stored key", async () => {
    await db.posts.bulkAdd([
      makePost({
        id: "work-1",
        categoryKey: "travail",
        customFields: { activity: "longe" },
      }),
      makePost({
        id: "care-2",
        categoryKey: "veto",
        customFields: { counterparty: "Dr. Dupont" },
      }),
    ]);

    const work = await mount("work-1");
    await waitFor(work, () => work.textContent!.includes("Activité"));
    expect(work.textContent).toContain("Longe");
    expect(work.textContent).not.toContain("longe");

    // The row is driven by the value, so an event that has none never shows it.
    const care = await mount("care-2");
    await waitFor(care, () => care.textContent!.includes("Practicien"));
    expect(care.textContent).not.toContain("Activité");
  });

  it("confirming delete soft-deletes the record and leaves the page", async () => {
    await db.posts.add(
      makePost({ id: "to-delete", title: "Visite à supprimer" }),
    );
    const el = await mount("to-delete");
    await waitFor(el, () => el.textContent!.includes("Visite à supprimer"));

    actionLabeled(el, "Supprimer").click();
    await settled(el);
    dialogButtonLabeled(el, "Supprimer").click();

    let stored = await db.posts.get("to-delete");
    for (let i = 0; i < 20 && stored?.deletedAt == null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      stored = await db.posts.get("to-delete");
    }
    expect(stored?.deletedAt).not.toBeNull();
  });
});
