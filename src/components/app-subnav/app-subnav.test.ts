import { html } from "lit";
import { describe, expect, it } from "vitest";
import { fixture } from "../__tests__/fixture.ts";
import "./app-subnav.ts";
import type { AppSubnav, SubnavItem } from "./app-subnav.ts";

const ITEMS: SubnavItem[] = [
  { href: "/horse/a/ration", label: "Ration", current: false },
  { href: "/horse/a/cheval", label: "Cheval", current: true },
];

const mount = () =>
  fixture<AppSubnav>(
    html`<app-subnav label="Sections" .items=${ITEMS}></app-subnav>`,
  );

const links = (el: AppSubnav) => [
  ...el.renderRoot.querySelectorAll<HTMLAnchorElement>("a"),
];

describe("app-subnav", () => {
  it("renders a labelled nav of real links, not a radio group", async () => {
    const el = await mount();

    expect(el.renderRoot.querySelector("nav")?.getAttribute("aria-label")).toBe(
      "Sections",
    );
    expect(links(el).map((a) => a.getAttribute("href"))).toEqual([
      "/horse/a/ration",
      "/horse/a/cheval",
    ]);
    expect(el.renderRoot.querySelector("[role=radio]")).toBeNull();
  });

  it("marks only the current page, and anchors the pill to it", async () => {
    const el = await mount();

    expect(links(el).map((a) => a.getAttribute("aria-current"))).toEqual([
      null,
      "page",
    ]);
    expect(
      links(el)
        .filter((a) => a.classList.contains("sliding-selection__active"))
        .map((a) => a.textContent?.trim()),
    ).toEqual(["Cheval"]);
  });
});
