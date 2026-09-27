import { html } from "lit";
import { describe, expect, it } from "vitest";
import { fixture } from "../__tests__/fixture.ts";
import "./nav-item.ts";
import type { NavItem } from "./nav-item.ts";

const current = async (attributes: { active: boolean; landing: boolean }) => {
  const el = await fixture<NavItem>(
    html`<nav-item
      href="/posts"
      label="Activités"
      ?active=${attributes.active}
      ?landing=${attributes.landing}
    ></nav-item>`,
  );
  return el.renderRoot.querySelector("a")!.getAttribute("aria-current");
};

describe("nav-item", () => {
  it("is the current page only on the section's own landing page", async () => {
    expect(await current({ active: true, landing: true })).toBe("page");
    // A sub-page: its own tabs say which page is current.
    expect(await current({ active: true, landing: false })).toBe("true");
    expect(await current({ active: false, landing: false })).toBe("false");
  });
});
