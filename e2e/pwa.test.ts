import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { build, preview, type PreviewServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The service worker, against the production build served as it is deployed —
 * under `/lady-gestion/`, by `vite preview`. The one piece of the app the other
 * suites cannot reach: it only exists in a build, and only a real browser runs
 * it.
 *
 * Built into a temporary directory rather than `dist/`, which is left alone,
 * and served from there, so the update test can rewrite `sw.js` in place the
 * way a deploy does.
 */

let outDir: string;
let server: PreviewServer;
let browser: Browser;
let appUrl: string;

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), "lady-gestion-e2e-"));
  // Vitest runs with NODE_ENV=test, which Vite would honour: Lit in dev mode
  // and `import.meta.env.PROD` false, so `initPwa` never registers the worker.
  process.env.NODE_ENV = "production";
  await build({
    mode: "production",
    logLevel: "warn",
    build: { outDir, emptyOutDir: true },
  });
  server = await preview({
    logLevel: "warn",
    build: { outDir },
    preview: { port: 0, strictPort: false },
  });
  const local = server.resolvedUrls?.local[0];
  if (!local) throw new Error("vite preview did not report a URL");
  appUrl = local; // already carries the /lady-gestion/ base
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

/** A first visit, waited on until the service worker controls the page. */
const installed = async (): Promise<{
  context: BrowserContext;
  page: Page;
}> => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(appUrl);
  await page.waitForSelector("horse-card");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  return { context, page };
};

const cacheNames = (page: Page) => page.evaluate(() => caches.keys());

describe("the installed app", () => {
  it("opens offline, with its data, even on a deep link", async () => {
    const { context, page } = await installed();
    const horse = await page.locator(".horse-card__info-title").innerText();

    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector("horse-card");
    expect(await page.locator(".horse-card__info-title").innerText()).toBe(
      horse,
    );

    // Any path is answered with the cached shell, which routes it.
    await page.goto(new URL("posts", appUrl).href);
    await page.waitForSelector("posts-view");

    await context.close();
  });

  it("routes a tapped reminder in the open window, without reloading it", async () => {
    const { context, page } = await installed();
    // Gone if the page reloads.
    await page.evaluate(() => {
      (window as { stillHere?: boolean }).stillHere = true;
    });

    // What `notificationclick` sends once it has focused the window.
    const [worker] = context.serviceWorkers();
    await worker!.evaluate(async () => {
      const scope = self as unknown as {
        clients: {
          matchAll(o: object): Promise<{ postMessage(m: unknown): void }[]>;
        };
      };
      const [client] = await scope.clients.matchAll({ type: "window" });
      client!.postMessage({ type: "OPEN_PATH", path: "/posts" });
    });

    await page.waitForSelector("posts-view");
    expect(new URL(page.url()).pathname).toBe("/lady-gestion/posts");
    expect(
      await page.evaluate(() => (window as { stillHere?: boolean }).stillHere),
    ).toBe(true);

    await context.close();
  });

  it("parks a new version until Actualiser, then swaps to it", async () => {
    const { context, page } = await installed();
    const [before] = await cacheNames(page);
    expect(before).toBeDefined();

    // A deploy, as far as the browser can tell: new bytes at the same URL,
    // carrying a cache name of its own.
    const swPath = join(outDir, "sw.js");
    const source = await readFile(swPath, "utf8");
    const next = `${before}-next`;
    await writeFile(swPath, source.replace(`"${before}"`, `"${next}"`));

    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update();
    });
    const button = page.getByRole("button", { name: "Actualiser" });
    await button.waitFor();

    // Parked: the running session still belongs to the old worker.
    expect(await cacheNames(page)).toContain(before);

    await Promise.all([page.waitForEvent("load"), button.click()]);
    await page.waitForSelector("horse-card");
    await page.waitForFunction(
      (name) => caches.keys().then((names) => names.join() === name),
      next,
    );

    await context.close();
  });
});
