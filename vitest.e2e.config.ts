import { defineConfig } from "vitest/config";

/**
 * The end-to-end suite: the built app, served the way it is deployed, driven
 * in a real browser. Its own config rather than a third project in
 * `vitest.config.ts`, because it builds the app first and takes tens of
 * seconds — `npm test` stays the fast loop, and CI runs this as its own step.
 */
export default defineConfig({
  test: {
    name: "e2e",
    environment: "node",
    include: ["e2e/**/*.test.ts"],
    // The build alone takes a while; a service worker install and an update
    // cycle on top of it are not millisecond affairs either.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
