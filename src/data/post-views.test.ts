import { describe, expect, it } from "vitest";
import { BUILT_IN_CATEGORY_ROWS, makePost } from "./__tests__/factories.ts";
import { followUpValue } from "./posts.ts";
import {
  dashboardAgenda,
  filterPosts,
  postInfoRows,
  shareSummary,
  splitCourses,
} from "./post-views.ts";

const TYPES = BUILT_IN_CATEGORY_ROWS;
const typeOf = (key: string) => TYPES.find((type) => type.key === key)!;

const vetVisit = makePost({
  categoryKey: "veto",
  title: "Contrôle œil",
  date: "2026-06-15",
  time: "09:30",
  notes: "RAS",
  customFields: {
    counterparty: "Clinique vétérinaire",
    amountCents: 8000,
    followUp: followUpValue({ amount: 6, unit: "week" }),
  },
});

describe("postInfoRows", () => {
  it("lists what the post holds, labelled by its own type", () => {
    const rows = postInfoRows(vetVisit, typeOf("veto"));

    expect(rows.map((row) => row.label)).toEqual([
      "Nom",
      "Date",
      "Practicien",
      "Budget",
      "Prochain rendez-vous",
      "Note",
    ]);
    expect(rows.find((row) => row.label === "Practicien")?.value).toBe(
      "Clinique vétérinaire",
    );
  });

  it("reads a reminder back through its field's own wording", () => {
    const cure = makePost({
      categoryKey: "cures",
      customFields: { reminder: "1h" },
    });

    expect(postInfoRows(cure, typeOf("cures"))).toContainEqual({
      label: "Notification",
      value: "1 heure avant",
    });
  });

  it("keeps only Nom and Date while the type is unknown", () => {
    const rows = postInfoRows({ ...vetVisit, notes: null }, undefined);

    expect(rows.map((row) => row.label)).toEqual(["Nom", "Date"]);
  });
});

describe("shareSummary", () => {
  it("says the type, the date, who and how much", () => {
    const summary = shareSummary(vetVisit, typeOf("veto"));

    expect(summary.startsWith("Vétérinaire · ")).toBe(true);
    expect(summary).toContain("Clinique vétérinaire");
    expect(summary).toMatch(/80,00\s€$/);
  });
});

describe("filterPosts", () => {
  const posts = [
    vetVisit,
    makePost({ id: "farrier", categoryKey: "marechal", title: "Ferrure" }),
    makePost({
      id: "cancelled",
      categoryKey: "veto",
      title: "Contrôle annulé",
      status: "cancelled",
    }),
  ];

  it("finds a post by its practitioner, ignoring accents", () => {
    const found = filterPosts(posts, TYPES, {
      categoryKey: null,
      query: "clinique veterinaire",
    });

    expect(found.map((post) => post.id)).toEqual([vetVisit.id]);
  });

  it("never lists a cancelled post", () => {
    const found = filterPosts(posts, TYPES, { categoryKey: null, query: "" });

    expect(found.map((post) => post.id)).not.toContain("cancelled");
  });

  it("keeps a picked category's posts only", () => {
    const found = filterPosts(posts, TYPES, {
      categoryKey: "marechal",
      query: "",
    });

    expect(found.map((post) => post.id)).toEqual(["farrier"]);
  });
});

describe("splitCourses", () => {
  it("sets cures apart from events, and drops a cancelled cure", () => {
    const cure = makePost({ id: "cure", categoryKey: "cures" });
    const cancelledCure = makePost({
      id: "cure-off",
      categoryKey: "cures",
      status: "cancelled",
    });

    const { courses, events } = splitCourses([vetVisit, cure, cancelledCure]);

    expect(courses.map((post) => post.id)).toEqual(["cure"]);
    expect(events.map((post) => post.id)).toEqual([vetVisit.id]);
  });
});

describe("dashboardAgenda", () => {
  it("lists a cure as upcoming before it starts, and as running once it has", () => {
    const today = "2026-06-15";
    const later = makePost({
      id: "later",
      categoryKey: "cures",
      date: "2026-06-20",
    });
    const running = makePost({
      id: "running",
      categoryKey: "cures",
      date: "2026-06-10",
    });

    const agenda = dashboardAgenda(
      [later, running],
      [later, running],
      TYPES,
      today,
      5,
    );

    expect(agenda.upcoming.map((post) => post.id)).toEqual(["later"]);
    expect(agenda.ongoing.map((post) => post.id)).toEqual(["running"]);
  });
});
