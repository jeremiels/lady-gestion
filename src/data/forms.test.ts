import { describe, expect, it } from "vitest";
import {
  bool,
  cents,
  decimal,
  isoDate,
  oneOf,
  readForm,
  text,
  type ParseResult,
} from "./forms.ts";

/**
 * These parsers are the last step before a value reaches a repository, so a
 * gap here writes a permanent bad row. The cases worth pinning are the ones a
 * type checker cannot see: French decimal commas, blank-vs-absent, and the
 * difference between "not provided" and "provided as empty".
 */

/** Unwraps a successful parse, so a test can assign the value to a typed local. */
const expectValue = <T>(result: ParseResult<T>): T => {
  if (!result.ok)
    throw new Error(`expected a parsed value, got: ${result.error}`);
  return result.value;
};

describe("text", () => {
  it("trims", () => {
    expect(text()("  Ferrure  ")).toEqual({ ok: true, value: "Ferrure" });
  });

  it("reads blank as null, never as an empty string", () => {
    // An empty string in a nullable column is a third state nothing checks for.
    expect(text()("   ")).toEqual({ ok: true, value: null });
    expect(text()(null)).toEqual({ ok: true, value: null });
  });

  it("rejects blank when required", () => {
    expect(text({ required: true })("  ")).toMatchObject({ ok: false });
  });

  it("enforces maxLength after trimming", () => {
    expect(text({ maxLength: 3 })(" abc ")).toEqual({ ok: true, value: "abc" });
    expect(text({ maxLength: 3 })("abcd")).toMatchObject({ ok: false });
  });
});

describe("required narrows the result type", () => {
  it("drops null from the parsed type when required is true", () => {
    // The assignments below are the assertion: `required: true` must narrow
    // `T | null` to `T`, or a caller that marked a field required still has to
    // null-check it and the option promises something the types don't keep.
    const title: string = expectValue(text({ required: true })("Ferrure"));
    const date: string = expectValue(isoDate({ required: true })("2026-08-12"));
    const amount: number = expectValue(cents({ required: true })("12,50"));
    const type: "veto" | "marechal" = expectValue(
      oneOf(["veto", "marechal"] as const, { required: true })("veto"),
    );

    expect([title, date, amount, type]).toEqual([
      "Ferrure",
      "2026-08-12",
      1250,
      "veto",
    ]);
  });

  it("still fails on blank", () => {
    expect(text({ required: true })("")).toMatchObject({ ok: false });
  });
});

describe("decimal", () => {
  it("accepts a French decimal comma", () => {
    // The bug this whole helper exists to prevent: `type="number"` would have
    // handed back an empty string here and the edit would vanish silently.
    expect(decimal()("1,5")).toEqual({ ok: true, value: 1.5 });
  });

  it("accepts a dot just as well", () => {
    expect(decimal()("1.5")).toEqual({ ok: true, value: 1.5 });
  });

  it("reads blank as null", () => {
    expect(decimal()("")).toEqual({ ok: true, value: null });
  });

  it("rejects text rather than writing NaN", () => {
    expect(decimal()("beaucoup")).toMatchObject({ ok: false });
  });

  it("rejects Infinity", () => {
    expect(decimal()("Infinity")).toMatchObject({ ok: false });
  });

  it("enforces min and max inclusively", () => {
    expect(decimal({ min: 0 })("0")).toEqual({ ok: true, value: 0 });
    expect(decimal({ min: 0 })("-1")).toMatchObject({ ok: false });
    expect(decimal({ max: 10 })("10")).toEqual({ ok: true, value: 10 });
    expect(decimal({ max: 10 })("11")).toMatchObject({ ok: false });
  });
});

describe("cents", () => {
  it("converts euros to integer cents", () => {
    expect(cents()("12,50")).toEqual({ ok: true, value: 1250 });
  });

  it("rounds to the nearest cent rather than truncating", () => {
    expect(cents()("0,005")).toEqual({ ok: true, value: 1 });
  });

  it("reads blank as null — the entry simply costs nothing", () => {
    expect(cents()("")).toEqual({ ok: true, value: null });
  });

  it("keeps 0 distinct from null", () => {
    expect(cents()("0")).toEqual({ ok: true, value: 0 });
  });

  it("rejects text", () => {
    expect(cents()("gratuit")).toMatchObject({ ok: false });
  });
});

describe("bool", () => {
  it("treats an absent entry as unchecked", () => {
    // An unchecked checkbox submits nothing at all — this is the whole contract.
    expect(bool()(null)).toEqual({ ok: true, value: false });
  });

  it("treats any present value as checked", () => {
    expect(bool()("on")).toEqual({ ok: true, value: true });
    expect(bool()("")).toEqual({ ok: true, value: true });
  });
});

describe("oneOf", () => {
  const TYPES = ["veto", "marechal"] as const;

  it("accepts a known value", () => {
    expect(oneOf(TYPES)("veto")).toEqual({ ok: true, value: "veto" });
  });

  it("rejects an unknown value instead of storing it", () => {
    expect(oneOf(TYPES)("dentiste")).toMatchObject({ ok: false });
  });

  it("reads blank as null unless required", () => {
    expect(oneOf(TYPES)("")).toEqual({ ok: true, value: null });
    expect(oneOf(TYPES, { required: true })("")).toMatchObject({ ok: false });
  });
});

describe("isoDate", () => {
  it('accepts what <input type="date"> submits', () => {
    expect(isoDate()("2026-08-12")).toEqual({ ok: true, value: "2026-08-12" });
  });

  it("rejects a French-formatted date, which would sort wrongly", () => {
    // Range indexes rely on lexicographic ordering; `12/08/2026` breaks it.
    expect(isoDate()("12/08/2026")).toMatchObject({ ok: false });
  });

  it("reads blank as null unless required", () => {
    expect(isoDate()("")).toEqual({ ok: true, value: null });
    expect(isoDate({ required: true })("")).toMatchObject({ ok: false });
  });
});

describe("readForm", () => {
  const schema = {
    title: text({ required: true }),
    quantity: decimal({ min: 0 }),
    seasonal: bool(),
  };

  const formData = (entries: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) data.append(key, value);
    return data;
  };

  it("parses every field into one typed object", () => {
    const result = readForm(
      formData({ title: "Ferrure", quantity: "1,5" }),
      schema,
    );

    expect(result).toEqual({
      ok: true,
      value: { title: "Ferrure", quantity: 1.5, seasonal: false },
    });
  });

  it("reports every failure at once, not just the first", () => {
    // One error per submit means as many round trips as there are mistakes.
    const result = readForm(
      formData({ title: "", quantity: "beaucoup" }),
      schema,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(Object.keys(result.errors).sort()).toEqual(["quantity", "title"]);
  });

  it("yields no value at all when any field fails", () => {
    const result = readForm(formData({ title: "", quantity: "2" }), schema);

    expect(result).not.toHaveProperty("value");
  });

  it("treats an absent field the same as a blank one", () => {
    const result = readForm(formData({ title: "Ferrure" }), schema);

    expect(result).toMatchObject({
      ok: true,
      value: { quantity: null, seasonal: false },
    });
  });

  it("accepts a FormData built from generated field names", () => {
    // The pattern that makes drift impossible: schema and data built from the
    // same list, so the keys cannot disagree.
    const ids = ["a", "b"];
    const generated = Object.fromEntries(
      ids.map((id) => [`quantity-${id}`, decimal()]),
    );
    const data = formData({ "quantity-a": "1,5", "quantity-b": "50" });

    expect(readForm(data, generated)).toEqual({
      ok: true,
      value: { "quantity-a": 1.5, "quantity-b": 50 },
    });
  });
});
