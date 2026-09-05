import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { iconSprite } from "./vite/icon-sprite.ts";
import { ICON_NAMES } from "./src/components/app-icon/icons.ts";

/**
 * Two suites, because the two halves of this app are only testable in different
 * places.
 *
 * **`data`** runs in Node. It is pure TypeScript with no DOM, and it is where a
 * silent bug is permanent — a bad row in IndexedDB outlives every reload.
 * `fake-indexeddb/auto` installs an in-memory IndexedDB onto globalThis before
 * `db.ts` constructs its Dexie instance at import time, so the repositories run
 * against a real database rather than a mock of one.
 *
 * **`components`** runs in a real Chromium. It has to: the components are built
 * on `ElementInternals`, `CustomStateSet`, `<dialog>.showModal()`, the top
 * layer and `delegatesFocus`, none of which jsdom implements — a jsdom suite
 * here would be testing a mock of the platform and passing while the real thing
 * broke. This replaces "verified in a browser by hand", which is what the
 * comment on this file used to mean.
 *
 * `src/commons/**` is in that project rather than in `data` because what lives
 * there is reactive controllers, and every one of them exists precisely to wrap
 * a browser API — internals, `<dialog>`, `matchMedia`, the Navigation API.
 * They are component code that happens not to sit in a component folder.
 */
export default defineConfig({
  // This config replaces `vite.config.ts` rather than extending it, so the
  // sprite plugin has to be named again here: without it `/icons.svg` 404s and
  // every icon in the browser suite renders empty. Nothing asserts on a glyph
  // today, which is exactly why it would have gone unnoticed.
  plugins: [iconSprite({ names: ICON_NAMES })],

  test: {
    projects: [
      {
        test: {
          name: "data",
          environment: "node",
          // Pinned so the local-vs-UTC date assertions are deterministic; the
          // app is French and `todayISO()` deliberately reads local calendar
          // fields.
          env: { TZ: "Europe/Paris" },
          include: ["src/data/**/*.test.ts"],
          setupFiles: ["./src/data/__tests__/setup.ts"],
          // Each file gets a fresh module registry and therefore a fresh
          // database.
          isolate: true,
        },
      },
      {
        /**
         * Every bare specifier the browser suite can reach, pre-bundled before the
         * first test runs.
         *
         * Vite's scanner crawls from the entry HTML, misses whatever only a test file
         * imports, and then discovers it *during* the run — at which point it
         * re-optimizes and reloads the page underneath whichever suite is executing.
         * Vitest reports that as `Vite unexpectedly reloaded a test`, and the suite
         * that was mid-import dies with `Failed to fetch dynamically imported module`
         * or `failed to find the current suite`.
         *
         * `router.test.ts` is the reason this is fatal rather than flaky. It drives
         * real navigations through the page it runs in and keeps the document alive
         * with an intercepting listener; a reload from under it takes the file's
         * whole context with it and collects zero tests.
         *
         * Invisible locally, because `node_modules/.vite` is warm after the first
         * run — and reliably broken in CI, where the cache is always cold. Reproduce
         * with `rm -rf node_modules/.vite && npm run test:components`.
         */
        optimizeDeps: {
          include: [
            "lit",
            "lit/decorators.js",
            "lit/directives/class-map.js",
            "lit/directives/if-defined.js",
            "lit/directives/keyed.js",
            "lit/directives/live.js",
            "lit/directives/repeat.js",
            "lit/directives/style-map.js",
            "dexie",
            "d3-shape",
          ],
        },

        test: {
          name: "components",
          env: { TZ: "Europe/Paris" },
          include: [
            "src/components/**/*.test.ts",
            "src/views/**/*.test.ts",
            "src/commons/**/*.test.ts",
          ],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
