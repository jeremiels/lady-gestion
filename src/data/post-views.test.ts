import { describe, expect, it } from "vitest";
import { BUILT_IN_CATEGORY_ROWS, makePost } from "./__tests__/factories.ts";
import { followUpValue } from "./posts.ts";
import {
  dashboardAgenda,
  filterPosts,
  formatFieldValue,
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

  it("follows with every other filled field, in the form's order", () => {
    const show = makePost({
      categoryKey: "concours",
      customFields: {
        competition: "CSO 1m",
        amountCents: 4500,
        result: "4pts",
      },
    });

    expect(postInfoRows(show, typeOf("concours"))).toEqual([
      expect.objectContaining({ label: "Nom" }),
      expect.objectContaining({ label: "Date" }),
      { label: "Budget", value: expect.stringMatching(/45,00\s€/) },
      { label: "Épreuve", value: "CSO 1m" },
      { label: "Résultat", value: "4 pts" },
    ]);
  });

  it("shows a field the form builder made, once it holds something", () => {
    const type = {
      ...typeOf("pension"),
      fields: [
        ...typeOf("pension").fields,
        { id: "box", label: "Box", required: false, control: "text" as const },
        {
          id: "paddock",
          label: "Paddock",
          required: false,
          control: "checkbox" as const,
        },
      ],
    };
    const month = makePost({
      categoryKey: "pension",
      customFields: { box: "B12", paddock: false },
    });

    const labels = postInfoRows(month, type).map((row) => row.label);
    expect(labels).toContain("Box");
    // An unticked box has nothing to say.
    expect(labels).not.toContain("Paddock");
  });

  it("keeps only Nom and Date while the type is unknown", () => {
    const rows = postInfoRows({ ...vetVisit, notes: null }, undefined);

    expect(rows.map((row) => row.label)).toEqual(["Nom", "Date"]);
  });
});

describe("formatFieldValue", () => {
  const field = (control: "date" | "checkbox" | "number" | "select") => ({
    id: "f",
    label: "F",
    required: false,
    control,
    options: [{ value: "a", label: "Option A" }],
  });

  it("words each control the way the app does elsewhere", () => {
    expect(formatFieldValue(field("checkbox"), true, "EUR")).toBe("Oui");
    expect(formatFieldValue(field("number"), 1.5, "EUR")).toBe("1,5");
    expect(formatFieldValue(field("select"), "a", "EUR")).toBe("Option A");
    expect(formatFieldValue(field("date"), "2026-06-15", "EUR")).toMatch(/15/);
  });

  it("shows a choice the field no longer offers as it was stored", () => {
    expect(formatFieldValue(field("select"), "gone", "EUR")).toBe("gone");
  });

  it("has nothing to say about a blank", () => {
    expect(formatFieldValue(field("select"), null, "EUR")).toBeNull();
    expect(formatFieldValue(field("select"), "", "EUR")).toBeNull();
    expect(formatFieldValue(field("checkbox"), false, "EUR")).toBeNull();
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
