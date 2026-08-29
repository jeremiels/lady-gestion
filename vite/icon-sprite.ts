import { readFile, readdir } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { SPRITE_PATH } from '../src/components/app-icon/icons.ts';

/**
 * Builds `/icons.svg` — one `<symbol>` per file in `src/assets/icons/` — and
 * serves it in dev, in preview and in the browser test runner.
 *
 * **Why the icons left the JS bundle.** They used to be 29 `?raw` imports in
 * `icons.ts`, inlined into the `app-icon` chunk and pulled in by `app-root`, so
 * every route paid for every icon whether it drew one or not: 35 kB raw / 12.9 kB
 * gzip on the first paint, more than Lit and more than the app entry. A sprite
 * is one cacheable file the parser never has to touch, and `unsafeSVG` — a
 * runtime string-to-DOM parse per icon — goes with it.
 *
 * It also stops an icon edit from invalidating a JS chunk. `vite.config.ts`
 * already explains at length how automatic chunking once put Lit and Dexie
 * *inside* the icon chunk, so editing one glyph re-downloaded both on every
 * installed device. The service worker's precache manifest carries a `revision`
 * per file, so with the sprite outside the bundle a changed glyph re-downloads
 * the sprite and nothing else.
 *
 * **A stable file name, deliberately.** Not content-hashed, so `index.html` can
 * preload it by a name known at author time. That costs nothing here: the
 * manifest revisions every file by content anyway, which is the mechanism the
 * hashed names exist to provide.
 */

const ICONS_DIR = new URL('../src/assets/icons/', import.meta.url);

/** `chevron-left.svg` -> `chevronLeft`, matching the `IconName` spelling. */
const idOf = (file: string): string =>
  basename(file, '.svg').replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

const SVG = /^<svg([^>]*)>([\s\S]*)<\/svg>\s*$/;

/**
 * Attributes that belong to a standalone document rather than to a symbol.
 *
 * Everything else is carried across — `viewBox` above all, since the icons are
 * authored at three different sizes (16, 20 and 24), and `fill="none"`, which
 * the two stroke-drawn icons rely on to keep their paths unfilled.
 */
const DROP_ATTRS = /\s(?:xmlns(?::\w+)?|width|height|id|class)="[^"]*"/g;

async function buildSprite(expected: readonly string[]): Promise<string> {
  const files = (await readdir(ICONS_DIR)).filter((file) => file.endsWith('.svg')).sort();

  const found = files.map(idOf);
  // The old `?raw` imports failed the build when a file went missing, and that
  // safety is worth keeping — extended, since it now also catches a file added
  // to the folder that no `IconName` can reach.
  const missing = expected.filter((name) => !found.includes(name));
  const extra = found.filter((name) => !expected.includes(name));
  if (missing.length || extra.length) {
    throw new Error(
      '[lady-gestion:icon-sprite] src/assets/icons/ and ICON_NAMES disagree — ' +
        `${missing.length ? `no file for: ${missing.join(', ')}. ` : ''}` +
        `${extra.length ? `no name for: ${extra.join(', ')}.` : ''}`,
    );
  }

  const symbols = await Promise.all(
    files.map(async (file) => {
      const source = await readFile(new URL(file, ICONS_DIR), 'utf8');
      const match = SVG.exec(source.trim());
      if (!match) throw new Error(`[lady-gestion:icon-sprite] ${file} is not a single <svg> element.`);

      const [, attributes = '', inner = ''] = match;
      return `<symbol id="${idOf(file)}"${attributes.replace(DROP_ATTRS, '')}>${inner}</symbol>`;
    }),
  );

  return `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>`;
}

export function iconSprite(options: { names: readonly string[] }): Plugin {
  const sprite = () => buildSprite(options.names);
  // `emitFile` only exists in a real build. Dev and the browser test runner
  // both reach `buildStart` in serve mode, where calling it warns that the
  // plugin is not Vite-compatible — they take the middleware above instead.
  let building = false;
  let base = '/';

  // Dev and preview serve it from memory; the build writes it into `dist/`,
  // where the service worker plugin's directory walk picks it up like any other
  // emitted asset. Rebuilt per request rather than cached, so adding an icon in
  // dev is a reload rather than a restart.
  //
  // Mounted under `base`, not at the bare `SPRITE_PATH`: this repo serves dev
  // and preview under `/lady-gestion/` (see `vite.config.ts`), so the browser
  // — via `appHref(SPRITE_PATH)` in `app-icon.ts` — actually requests
  // `/lady-gestion/icons.svg`. A middleware mounted at `/icons.svg` never sees
  // that request; it falls through to Vite's SPA history fallback, which
  // serves `index.html` instead — 200 OK, wrong content, so every icon's
  // `<use>` silently resolves against HTML and draws nothing.
  const serve = (middlewares: ViteDevServer['middlewares'], servedBase: string) => {
    middlewares.use(`${servedBase.slice(0, -1)}${SPRITE_PATH}`, (_request, response, next) => {
      sprite()
        .then((body) => {
          response.setHeader('Content-Type', 'image/svg+xml');
          response.end(body);
        })
        .catch(next);
    });
  };

  return {
    name: 'lady-gestion:icon-sprite',

    configResolved(config) {
      building = config.command === 'build';
      base = config.base;
    },

    configureServer(server) {
      serve(server.middlewares, server.config.base);
    },

    configurePreviewServer(server) {
      serve(server.middlewares, server.config.base);
    },

    /**
     * Injects the sprite's `<link rel="preload">` with `base` already applied,
     * instead of writing it in `index.html` as `href="%BASE_URL%icons.svg"`.
     *
     * That token form built correctly — Vite's own root-absolute rewriting
     * only touches an href it can resolve inside `public/`, and the sprite is
     * emitted by this plugin instead, so a bare `/icons.svg` was shipping
     * unprefixed and 404ing on a hosted subpath (github.io/lady-gestion/...).
     * But in dev and preview, that *same* rewriting pass prefixes root-absolute
     * hrefs unconditionally — including one `%BASE_URL%` had already prefixed —
     * so the tag doubled up to `/lady-gestion/lady-gestion/icons.svg` and
     * silently 404'd behind Vite's SPA fallback. Injecting the finished,
     * already-prefixed href here instead sidesteps that second rewrite pass
     * entirely, in both dev and build.
     */
    transformIndexHtml() {
      return [
        {
          tag: 'link',
          injectTo: 'head',
          attrs: {
            rel: 'preload',
            href: `${base.slice(0, -1)}${SPRITE_PATH}`,
            as: 'image',
            type: 'image/svg+xml',
          },
        },
      ];
    },

    async buildStart() {
      // Emitting from `buildStart` rather than `generateBundle` so a mismatch
      // between the folder and `ICON_NAMES` fails before anything is written.
      if (!building) return;
      this.emitFile({ type: 'asset', fileName: SPRITE_PATH.slice(1), source: await sprite() });
    },
  };
}
