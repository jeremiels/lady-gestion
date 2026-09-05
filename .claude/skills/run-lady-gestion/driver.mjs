#!/usr/bin/env node
/**
 * REPL driver for lady-gestion.
 *
 * Reads one command per line from stdin, drives a headless Chromium against
 * the Vite dev server, prints a result line, then `ok`. Designed for tmux
 * `send-keys` / `capture-pane`, but a heredoc pipe works too.
 *
 *   node .claude/skills/run-lady-gestion/driver.mjs <<'EOF'
 *   nav /events
 *   wait app-calendar .calendar__day
 *   ss
 *   quit
 *   EOF
 *
 * Two things here exist because of what this app is:
 *
 * - Every component but the views renders into **shadow DOM**. Playwright's
 *   CSS engine pierces it, so `click`/`wait` take plain selectors — but
 *   `page.evaluate` does not, which is why `shadow` and `$` exist.
 * - The only data store is IndexedDB behind `src/data/`. `seed` imports that
 *   module *inside the page* and calls the real repositories, so a write goes
 *   through `LiveQuery` exactly as it would in the app.
 */
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../..");
const PORT = Number(process.env.PORT ?? 5173);
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS ?? "/tmp/lady-shots";

/**
 * Vite's `base`. The app is a GitHub Pages *project* site, so `npm run dev`
 * and `npm run preview` both serve it under a prefix, while the route table in
 * `app-root.ts` matches paths *without* one — `commons/base-path.ts` is what
 * strips it. So every URL this driver builds needs the prefix back on the
 * front, and the app paths you type stay the ones the app itself uses.
 *
 * Read out of the config rather than hardcoded: it drifted once already, and a
 * stale prefix is a silent failure — Vite answers with its "did you mean to
 * visit ...?" page, so `nav` succeeds, `wait` times out 15s later, and nothing
 * says why. `BASE=` overrides for a server started some other way.
 */
const normalizeBase = (value) => {
  const trimmed = value.replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}/` : "/";
};

const BASE = normalizeBase(
  process.env.BASE ??
    readFileSync(join(ROOT, "vite.config.ts"), "utf8").match(
      /^\s*base:\s*['"]([^'"]+)['"]/m,
    )?.[1] ??
    "/",
);

/** An app path (`/budget`) as the dev server wants it. Already-prefixed passes through. */
const url = (path) =>
  ORIGIN + (path.startsWith(BASE) ? path : BASE + path.replace(/^\/+/, ""));

/**
 * Playwright is not a project dependency and shouldn't become one — this app
 * ships 200 KB and the repo keeps its devDependencies deliberately thin (see
 * the `sharp` note in AGENTS.md). Keep it in a cache outside the tree instead.
 * The browser binaries live in the shared ~/.cache/ms-playwright.
 */
const CACHE = join(homedir(), ".cache", "lady-gestion-run");

const loadPlaywright = async () => {
  const require = createRequire(join(CACHE, "noop.js"));
  // `playwright` is CommonJS: through `import()` its exports arrive on `.default`.
  const unwrap = (mod) => mod.default ?? mod;
  try {
    return unwrap(await import(require.resolve("playwright")));
  } catch {
    console.error("installing playwright into " + CACHE + " (one time, ~30s)");
    mkdirSync(CACHE, { recursive: true });
    if (!existsSync(join(CACHE, "package.json"))) {
      execFileSync("npm", ["init", "-y"], { cwd: CACHE, stdio: "ignore" });
    }
    execFileSync("npm", ["i", "playwright"], { cwd: CACHE, stdio: "inherit" });
    execFileSync("npx", ["playwright", "install", "chromium"], {
      cwd: CACHE,
      stdio: "inherit",
    });
    return unwrap(await import(require.resolve("playwright")));
  }
};

const serverUp = async () => {
  try {
    await fetch(ORIGIN, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
};

/** Starts `npm run dev` unless something already answers on the port. */
const startServer = async () => {
  if (await serverUp()) return null;

  const vite = spawn("npm", ["run", "dev"], {
    cwd: ROOT,
    stdio: "ignore",
    detached: false,
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    if (await serverUp()) return vite;
  }
  vite.kill();
  throw new Error(`dev server did not come up on ${ORIGIN} within 30s`);
};

const playwright = await loadPlaywright();
const vite = await startServer();

const browser = await playwright.chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  // iPhone-ish. The app is mobile-first and its nav bar is fixed to the bottom.
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  // Both matter: French copy is asserted through Intl, and `dates.ts` builds
  // calendar dates from local midnight. A UTC container shifts them by a day.
  locale: "fr-FR",
  timezoneId: "Europe/Paris",
});
const page = await context.newPage();

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

mkdirSync(SHOTS, { recursive: true });
let shotCount = 0;

/**
 * `getComputedStyle` during a CSS transition returns the interpolated value,
 * and a screenshot catches the halfway frame — a selected calendar day comes
 * out muddy taupe instead of dark brown. Let transitions land first.
 */
const settle = async () => {
  await page.evaluate(
    () =>
      new Promise((done) => {
        requestAnimationFrame(() => requestAnimationFrame(done));
      }),
  );
  await page.waitForTimeout(400);
};

const commands = {
  async nav([path = "/"]) {
    await page.goto(url(path), { waitUntil: "networkidle" });
    return page.url();
  },

  /** Playwright's CSS engine pierces shadow roots, so pass the plain selector. */
  async wait(args) {
    const selector = args.join(" ");
    await page.waitForSelector(selector, { timeout: 15_000 });
    return `visible: ${selector}`;
  },

  async click(args) {
    const selector = args.join(" ");
    await page.locator(selector).first().click();
    await settle();
    return `clicked: ${selector}`;
  },

  /**
   * `fill <selector> | <value>`. The `|` is required: selectors here routinely
   * contain spaces (`.events-view__search input`), so splitting on whitespace
   * would silently fill the wrong element with the rest of the selector.
   * An empty value clears the field.
   */
  async fill(args) {
    const [selector, value = ""] = args.join(" ").split("|");
    if (selector === undefined || !args.join(" ").includes("|")) {
      return "ERROR: usage is `fill <selector> | <value>`";
    }
    await page.locator(selector.trim()).first().fill(value.trim());
    await settle();
    return `filled: ${selector.trim()}`;
  },

  /** `press Enter` or `press ArrowLeft 20` to repeat. */
  async press([key, times = "1"]) {
    for (let i = 0; i < Number(times); i++) await page.keyboard.press(key);
    await settle();
    return `pressed: ${key} x${times}`;
  },

  /** Focuses an element even inside a shadow root, which `page.focus` can also do. */
  async focus(args) {
    const selector = args.join(" ");
    await page.locator(selector).first().focus();
    return `focused: ${selector}`;
  },

  async viewport([w, h]) {
    await page.setViewportSize({ width: Number(w), height: Number(h) });
    await settle();
    return `viewport: ${w}x${h}`;
  },

  async ss([name]) {
    await settle();
    const file = join(
      SHOTS,
      `${String(++shotCount).padStart(2, "0")}-${name ?? "shot"}.png`,
    );
    await page.screenshot({ path: file });
    return file;
  },

  /**
   * Describes every match, including inside shadow DOM. Use this instead of
   * `eval` when you want to know what a component actually rendered — an
   * `eval` with `document.querySelectorAll` will not see into a shadow root.
   */
  async $(args) {
    const selector = args.join(" ");
    // A real function, not a string: `evaluateAll` returns undefined for a
    // stringified one instead of erroring.
    const found = await page.locator(selector).evaluateAll((els) =>
      els.map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
        class: el.getAttribute("class"),
        label: el.getAttribute("aria-label"),
        bg: getComputedStyle(el).backgroundColor,
        color: getComputedStyle(el).color,
      })),
    );
    return JSON.stringify(found, null, 2);
  },

  /** Raw page JS. Reaches a shadow root only if you walk `.shadowRoot` yourself. */
  async eval(args) {
    const result = await page.evaluate(`(async () => (${args.join(" ")}))()`);
    return JSON.stringify(result, null, 2);
  },

  /**
   * Runs JS with the app's own data layer in scope as `data`, so a write goes
   * through the real repositories and every `LiveQuery` re-renders:
   *
   *   seed const h = await data.horsesRepo.getActive();
   *        await data.eventsRepo.create({ horseId: h.id, ... })
   *
   * Only works against the dev server, which serves `/src/**` as ESM.
   */
  async seed(args) {
    const body = args.join(" ");
    const result = await page.evaluate(`(async () => {
      const data = await import('${BASE}src/data/index.ts');
      await data.initData();
      return (async () => { ${body} })();
    })()`);
    return JSON.stringify(result ?? "ok", null, 2);
  },

  async errors() {
    return errors.length ? errors.join("\n") : "none";
  },

  async route() {
    return page.url();
  },
};

const run = async (line) => {
  const [name, ...args] = line.trim().split(/\s+/);
  if (!name || name.startsWith("#")) return;
  if (name === "quit" || name === "exit") {
    await browser.close();
    vite?.kill();
    process.exit(0);
  }
  const command = commands[name];
  if (!command) {
    console.log(
      `unknown command: ${name} (have: ${Object.keys(commands).join(" ")} quit)`,
    );
    return;
  }
  console.log(await command(args));
};

console.log(
  `driver ready — ${ORIGIN}, shots in ${SHOTS}${vite ? " (started vite)" : ""}`,
);

const rl = createInterface({ input: process.stdin, terminal: false });
for await (const line of rl) {
  try {
    await run(line);
  } catch (error) {
    console.log(`ERROR: ${error.message.split("\n")[0]}`);
  }
  console.log("ok");
}

await browser.close();
vite?.kill();
