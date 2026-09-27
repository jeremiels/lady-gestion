import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type * as Navigation from "./navigation.ts";

/**
 * `navigateTo`, `goBack` and `goBackOutOf`, loaded under the base path the app
 * deploys to — and serves from under `npm run dev`.
 *
 * Every caller passes an app path (`/posts`). Under the rest of the suite
 * `BASE_URL` is `/`, so a missing prefix writes the very same URL and passes;
 * here it would write `/posts`, outside the service worker's scope, which the
 * next reload turns into a 404.
 *
 * Its own file, loading the module graph in `beforeAll` only, for the reason
 * `sections.deployed-base.test.ts` gives: a static import would pin
 * `base-path.ts` to the root base before the stub lands.
 */

let nav: typeof Navigation;

beforeAll(async () => {
  vi.stubEnv("BASE_URL", "/lady-gestion/");
  nav = await import("./navigation.ts");

  // Guards the guard, as in `sections.deployed-base.test.ts`.
  const { appHref } = await import("./base-path.ts");
  expect(appHref("/posts")).toBe("/lady-gestion/posts");
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Stands in for the real navigation, which would take the test page away. */
const stubNavigate = () =>
  vi.spyOn(navigation, "navigate").mockReturnValue({} as NavigationResult);

it("keeps a programmatic navigation under the base path", () => {
  const navigate = stubNavigate();

  nav.navigateTo("/posts");

  expect(navigate).toHaveBeenCalledWith("/lady-gestion/posts");
});

it("keeps goBack's fallback under the base path on a cold start", () => {
  const navigate = stubNavigate();
  vi.spyOn(navigation, "currentEntry", "get").mockReturnValue({
    index: 0,
  } as NavigationHistoryEntry);

  nav.goBack("/posts");

  expect(navigate).toHaveBeenCalledWith("/lady-gestion/posts");
});

it("keeps goBackOutOf's fallback under the base path", () => {
  const navigate = stubNavigate();
  vi.spyOn(navigation, "currentEntry", "get").mockReturnValue({
    index: 0,
  } as NavigationHistoryEntry);

  nav.goBackOutOf(() => true, "/profile");

  expect(navigate).toHaveBeenCalledWith("/lady-gestion/profile");
});
