import { html } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../data/db.ts";
import { addDays, todayISO } from "../data/dates.ts";
import {
  makeHorse,
  makePost,
  makeRation,
  resetDb,
} from "../data/__tests__/factories.ts";
import { fixture, waitFor } from "../components/__tests__/fixture.ts";
import "./HorseView.ts";
import type { HorseView } from "./HorseView.ts";

import type { HorseTab } from "../commons/sections.ts";
import type { HorseProfile } from "../components/horse-profile/horse-profile.ts";
import type { HorseRation } from "../components/horse-ration/horse-ration.ts";
import type { HorseCourses } from "../components/horse-courses/horse-courses.ts";

const mount = (tab: HorseTab = "ration") =>
  fixture<HorseView>(
    html`<horse-view .horseId=${"horse-1"} .tab=${tab}></horse-view>`,
  );

/** The pieces of the page live in their own shadow roots. */
const rationList = (el: HorseView) =>
  el.querySelector<HorseRation>("horse-ration")!;
const profile = (el: HorseView) =>
  el.querySelector<HorseProfile>("horse-profile")!;

const rationRows = (el: HorseView) =>
  rationList(el)?.renderRoot.querySelectorAll(".item").length ?? 0;

beforeEach(async () => {
  await resetDb();
  await db.horses.add(makeHorse({ breed: "Selle Français" }));
});

describe("horse-view", () => {
  it("shows the identity card under Cheval, falling back to — for what is unknown", async () => {
    const el = await mount("cheval");
    await waitFor(el, () =>
      Boolean(profile(el)?.renderRoot.textContent?.includes("Selle Français")),
    );

    const identity = profile(el).renderRoot.querySelectorAll(".section")[0]!;
    const values = [...identity.querySelectorAll(".item__value")].map((node) =>
      node.textContent?.trim(),
    );

    // Sexe, Âge, Race, N° Sire, in that order.
    expect(values[0]).toBe("Jument");
    expect(values[2]).toBe("Selle Français");
    expect(values[3]).toBe("—"); // sireNumber is null in the factory default
  });

  it("shows the empty ration state, with no editing controls", async () => {
    const el = await mount();
    await waitFor(el, () =>
      Boolean(
        rationList(el)?.renderRoot.textContent?.includes(
          "Aucune ration enregistrée pour le moment.",
        ),
      ),
    );

    expect(el.querySelector("ration-sheet")).toBeNull();
  });

  it("lists the rations read-only — editing lives on the customize page", async () => {
    await db.rationItems.add(makeRation({ id: "ration-a", label: "Sel" }));

    const el = await mount();
    await waitFor(el, () => rationRows(el) === 1);

    expect(rationList(el).renderRoot.querySelector("button")).toBeNull();
  });

  it("splits the cures into à venir, running and Historique, with dates, dose and active days", async () => {
    const today = todayISO();
    await db.posts.bulkAdd([
      makePost({
        id: "running",
        categoryKey: "cures",
        title: "Uvemix",
        date: addDays(today, -9),
        customFields: { dosage: "40 mL" },
      }),
      makePost({
        id: "ended",
        categoryKey: "cures",
        title: "Ail",
        date: addDays(today, -40),
        customFields: { endDate: addDays(today, -31) },
      }),
      makePost({
        id: "later",
        categoryKey: "cures",
        title: "Spiruline",
        date: addDays(today, 5),
      }),
      makePost({ id: "other", categoryKey: "traitement", title: "Antibio" }),
    ]);

    const el = await mount("cures");
    const courses = () => el.querySelector<HorseCourses>("horse-courses");
    const cards = () => [
      ...(courses()?.renderRoot.querySelectorAll("course-card") ?? []),
    ];
    await waitFor(el, () => cards().length === 3);
    await Promise.all(cards().map((card) => card.updateComplete));

    const headings = [...courses()!.renderRoot.querySelectorAll("h2")].map(
      (h) => h.textContent?.trim(),
    );
    expect(headings).toEqual(["Cures à venir", "Cures en cours", "Historique"]);

    const [later, running, ended] = cards().map((card) =>
      card.shadowRoot!.textContent!.replace(/\s+/g, " "),
    );
    expect(later).toContain("Spiruline");
    expect(later).toContain("À partir du");
    expect(running).toContain("Uvemix");
    expect(running).toContain("à aujourd'hui");
    expect(running).toContain("40 mL/j");
    expect(running).toContain("10 jours actifs");
    expect(ended).toContain("Ail");
    expect(ended).toContain(" au ");
    expect(ended).toContain("10 jours actifs");
  });
});
