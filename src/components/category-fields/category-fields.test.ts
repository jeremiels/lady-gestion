import { html } from "lit";
import { describe, expect, it } from "vitest";
import { fixture, settled } from "../__tests__/fixture.ts";
import { dropIndex } from "../../commons/controllers/drag-reorder.ts";
import { moveField } from "../../data/category-editor.ts";
import type { CustomFieldDef } from "../../data/types.ts";
import "./category-fields.ts";
import type { CategoryFields, FieldsReorderDetail } from "./category-fields.ts";

/**
 * Reordering a form's fields, in a real browser: the drag is pointer events,
 * layout and transforms, and the keyboard path is focus moving with a node.
 */

const field = (id: string, label: string): CustomFieldDef => ({
  id,
  label,
  required: false,
  control: "text",
});

const FIELDS = [
  field("title", "Nom"),
  field("date", "Date"),
  field("coach", "Coach"),
  field("notes", "Note"),
];

/** Mounted with an owner that applies every move, as the editor does. */
const mount = async () => {
  const el = await fixture<CategoryFields>(
    html`<category-fields .fields=${FIELDS}></category-fields>`,
  );
  const moves: FieldsReorderDetail[] = [];
  el.addEventListener("fields-reorder", (event) => {
    const { from, to } = (event as CustomEvent<FieldsReorderDetail>).detail;
    moves.push({ from, to });
    el.fields = moveField(el.fields, from, to);
  });
  return { el, moves };
};

const labels = (el: CategoryFields) =>
  [...el.renderRoot.querySelectorAll(".open__label")].map(
    (label) => label.textContent,
  );

const handle = (el: CategoryFields, index: number) => {
  const button = el.renderRoot.querySelectorAll<HTMLElement>(".handle")[index]!;
  // Synthetic pointers have no active pointer to capture — see
  // `app-bottom-sheet.test.ts`.
  button.setPointerCapture = () => {};
  button.releasePointerCapture = () => {};
  return button;
};

const pointer = (type: string, clientY: number) =>
  new PointerEvent(type, {
    pointerId: 1,
    pointerType: "touch",
    clientY,
    bubbles: true,
    composed: true,
  });

const middleOf = (el: CategoryFields, index: number) => {
  const rows = el.renderRoot.querySelectorAll(".row");
  const rect = rows[index]!.getBoundingClientRect();
  return rect.top + rect.height / 2;
};

const frame = () => new Promise(requestAnimationFrame);

describe("dropIndex", () => {
  const middles = [10, 30, 50, 70];

  it("lands past every row whose middle the dragged one crossed", () => {
    expect(dropIndex(middles, 3, 25)).toBe(1);
    expect(dropIndex(middles, 0, 55)).toBe(2);
  });

  it("stays put short of the next middle", () => {
    expect(dropIndex(middles, 1, 45)).toBe(1);
  });
});

describe("category-fields — dragging a handle", () => {
  it("moves the field to where it was dropped, and leaves no style behind", async () => {
    const { el, moves } = await mount();
    const grip = handle(el, 2);
    const start = middleOf(el, 2);
    const target = middleOf(el, 0) - 5;

    grip.dispatchEvent(pointer("pointerdown", start));
    grip.dispatchEvent(pointer("pointermove", (start + target) / 2));
    grip.dispatchEvent(pointer("pointermove", target));
    grip.dispatchEvent(pointer("pointerup", target));
    await frame();
    await settled(el);

    expect(moves).toEqual([{ from: 2, to: 0 }]);
    expect(labels(el)).toEqual(["Coach", "Nom", "Date", "Note"]);
    await new Promise((resolve) => setTimeout(resolve, 450));
    for (const row of el.renderRoot.querySelectorAll<HTMLElement>(".row")) {
      expect(row.getAttribute("style") ?? "").toBe("");
      expect(row.dataset.dragging).toBeUndefined();
    }
  });

  it("slides the rows it passes out of the way while the finger is down", async () => {
    const { el } = await mount();
    const grip = handle(el, 0);
    const start = middleOf(el, 0);

    grip.dispatchEvent(pointer("pointerdown", start));
    grip.dispatchEvent(pointer("pointermove", middleOf(el, 1) + 5));

    const rows = el.renderRoot.querySelectorAll<HTMLElement>(".row");
    expect(rows[1]!.style.transform).toMatch(/translateY\(-/);
    expect(rows[2]!.style.transform).toBe("");

    grip.dispatchEvent(pointer("pointercancel", start));
  });

  it("puts everything back on Escape, telling the owner nothing", async () => {
    const { el, moves } = await mount();
    const grip = handle(el, 0);
    const start = middleOf(el, 0);

    grip.dispatchEvent(pointer("pointerdown", start));
    grip.dispatchEvent(pointer("pointermove", middleOf(el, 3)));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    grip.dispatchEvent(pointer("pointerup", middleOf(el, 3)));
    await frame();

    expect(moves).toEqual([]);
    expect(labels(el)).toEqual(["Nom", "Date", "Coach", "Note"]);
  });
});

describe("category-fields — the keyboard", () => {
  it("moves a field one place with ↓, keeps focus on it and says so", async () => {
    const { el, moves } = await mount();
    const grip = handle(el, 0);
    grip.focus();

    grip.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    await frame();
    await settled(el);

    expect(moves).toEqual([{ from: 0, to: 1 }]);
    expect(labels(el)).toEqual(["Date", "Nom", "Coach", "Note"]);
    expect(
      (el.renderRoot as ShadowRoot).activeElement?.getAttribute("aria-label"),
    ).toBe("Déplacer « Nom »");
    expect(el.renderRoot.querySelector(".announcement")?.textContent).toBe(
      "« Nom » déplacé en position 2 sur 4.",
    );
  });

  it("does nothing past either end", async () => {
    const { el, moves } = await mount();

    handle(el, 0).dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    handle(el, 3).dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );

    expect(moves).toEqual([]);
  });
});
