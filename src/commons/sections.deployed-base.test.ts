import { beforeAll, expect, it, vi } from "vitest";
import type * as Sections from "./sections.ts";

/**
 * The section table, loaded under the base path the app actually deploys to.
 *
 * `SECTIONS[].root` was once built with `appHref()`, so it carried the deploy
 * prefix while the paths `Router` compares it against had already been stripped
 * by `toAppPath()`. Under `npm run dev` and under the rest of the suite
 * `BASE_URL` is `/`, the prefix is empty and the two forms are identical — the
 * app shipped to GitHub Pages with no lateral route transition at all and every
 * assertion in `sections.test.ts` still passed.
 *
 * **Its own file, and this is load-bearing.** `vi.resetModules()` does not
 * re-execute a module the file has already imported: statically importing
 * `sections.ts` here would pin `base-path.ts` to `BASE_URL = '/'` for the whole
 * file, the stub below would change nothing, and these two tests would pass
 * against the very bug they exist to catch — verified by reintroducing it.
 * Nothing in this file may import the module graph under test at the top level;
 * the dynamic import in `beforeAll` has to be its first load.
 */

let sections: typeof Sections;

beforeAll(async () => {
  vi.stubEnv("BASE_URL", "/lady-gestion/");
  sections = await import("./sections.ts");

  // Guards the guard: if the stub ever stops reaching `base-path.ts`, these
  // tests would quietly go back to exercising the root base and passing for the
  // wrong reason — the exact failure this file is here to rule out.
  const { appHref } = await import("./base-path.ts");
  expect(appHref("/events")).toBe("/lady-gestion/events");
});

it("recognises a sideways move between section roots", () => {
  expect(sections.isLateral("/", "/events")).toBe(true);
  expect(sections.isLateral("/budget", "/documents")).toBe(true);
});

it("keeps section roots app-relative", () => {
  expect(sections.SECTIONS.map((section) => section.root)).toEqual([
    "/",
    "/events",
    "/budget",
    "/documents",
  ]);
});
