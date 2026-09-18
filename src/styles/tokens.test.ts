import { describe, expect, it } from "vitest";
import "./main.css";

/**
 * Tokens introduced or adopted by replacing a literal, held to the exact value
 * that literal had.
 *
 * Swapping `font-size: 0.875rem` for `var(--font-size-sm)` across twenty-three
 * rules is only safe while the token is *precisely* `0.875rem`. Nothing else
 * checks that: edit the token and every one of those rules silently moves, in a
 * refactor whose entire premise was that nothing on screen changes.
 *
 * These are not style opinions. Changing a value here is allowed — but it is a
 * design decision, and this test is what makes it a deliberate one.
 */
const resolved = (property: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(property).trim();

describe("tokens adopted in place of a literal", () => {
  it("reports an undeclared property as empty", () => {
    // Without this every assertion below could pass against a document that
    // loaded no stylesheet at all.
    expect(resolved("--font-size-nonexistent")).toBe("");
  });

  it.each([
    ["--font-size-sm", "0.875rem"],
    ["--font-size-base", "1rem"],
    ["--font-size-xs", "0.75rem"],
    ["--focus-ring-offset", "2px"],
    ["--color-white", "#ffffff"],
  ])("%s is exactly %s", (token, value) => {
    expect(resolved(token)).toBe(value);
  });

  it("--focus-ring is the declaration the 21 rules used to spell out", () => {
    // Chromium substitutes nested `var()` at computed-value time, so this
    // reads back as the resolved colour rather than the reference — which is
    // the stronger check: it proves the ring really is brown-dark, 2px, solid,
    // and not merely a string that looks right.
    expect(resolved("--focus-ring")).toBe(
      `2px solid ${resolved("--color-brown-dark")}`,
    );
  });

  it("--color-white is the colour #fff was", () => {
    // `#fff` and `#ffffff` are the same colour; this is what keeps that true.
    const probe = document.createElement("div");
    probe.style.color = "#fff";
    document.body.append(probe);
    const asShorthand = getComputedStyle(probe).color;
    probe.style.color = resolved("--color-white");
    const asToken = getComputedStyle(probe).color;
    probe.remove();

    expect(asToken).toBe(asShorthand);
  });
});
