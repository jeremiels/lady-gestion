import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { iconSprite } from './vite/icon-sprite.ts';
import { ICON_NAMES } from './src/components/app-icon/icons.ts';

/**
 * Files that ship but are never fetched by the running app, so precaching them
 * only costs every install bytes it cannot use:
 *
 * - source maps are useless offline;
 * - `sw.js` must never precache itself — a leftover from an earlier build would
 *   feed its own bytes back into the cache name and make the hash depend on
 *   build order;
 * - `_redirects` and `.nojekyll` are host configuration, read at deploy time,
 *   not by the client;
 * - `404.html` is a byte copy of the shell that only the *host* ever serves, on
 *   a cold deep link before this worker exists; once it does, navigations are
 *   answered from `/`. Precaching it would store the shell twice;
 * - the font licence has to be distributed alongside the font, not cached.
 *
 * The last two are also written after this plugin has walked the output — see
 * `githubPages` below — so they are absent rather than excluded on a normal
 * build. They are listed anyway: that ordering is an implementation detail of
 * the plugin array, and this regex is where the intent belongs.
 */
const PRECACHE_EXCLUDED =
  /(\.map|[\\/]sw\.js|[\\/]_redirects|[\\/]\.nojekyll|[\\/]404\.html|[\\/]LICENSE\.txt)$/;

async function filesIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
}

/**
 * Writes `dist/sw.js` from `src/pwa/service-worker.js`, injecting a precache
 * manifest of every built and public file plus a cache name derived from their
 * contents.
 *
 * The manifest is `{ url, revision }` pairs rather than a bare URL list, and
 * that is what lets an install carry unchanged files forward out of the
 * previous build's cache instead of re-downloading them. A URL alone cannot
 * support that: only `/assets/*` is content-hashed in its name, so the shell,
 * the manifest, the 60 kB font subset and every icon would still have to be
 * re-fetched on a deploy that did not touch them. `revision` is per-file, so
 * the worker can answer "is this exact byte sequence already on the device?"
 * for all of them.
 *
 * It runs in `closeBundle` — the last hook — because `public/` is copied into
 * `dist/` during the build, so that is the only point where walking the output
 * directory sees the manifest and the icons alongside the hashed bundles.
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  // Always trailing-slashed, `/` or `/lady-gestion/`. The manifest holds the
  // URLs the browser will actually request, so it has to carry the prefix the
  // app is served under — a root-absolute list would miss every entry on a
  // hosted subpath and the worker would re-fetch the whole app on each install.
  let base = '/';

  return {
    name: 'lady-gestion:service-worker',
    apply: 'build',
    enforce: 'post',

    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      base = config.base;
    },

    async closeBundle() {
      const files = (await filesIn(outDir))
        .filter((file) => !PRECACHE_EXCLUDED.test(file))
        .sort();

      // index.html is precached under `base` — the URL the app is actually
      // loaded from — so the navigation fallback and the shell share one cache
      // entry.
      const entries = await Promise.all(
        files.map(async (file) => {
          const path = `${base}${relative(outDir, file).split(/[\\/]/).join('/')}`;
          const contents = await readFile(file);
          return {
            url: path === `${base}index.html` ? base : path,
            revision: createHash('sha256').update(contents).digest('hex').slice(0, 16)
          };
        })
      );

      entries.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));

      // Hashing contents, not names: index.html is not content-hashed, so a
      // build that only changes it must still produce a different sw.js or the
      // browser sees no update at all. Folding the per-file revisions in gives
      // the same guarantee for one pass over the files instead of two.
      const cacheHash = createHash('sha256');
      for (const entry of entries) cacheHash.update(`${entry.url}:${entry.revision}\n`);

      const source = await readFile(new URL('./src/pwa/service-worker.js', import.meta.url), 'utf8');

      // `String.replace` silently no-ops on a missing token, which would ship a
      // sw.js containing the literal `__PRECACHE_MANIFEST__` — a syntax error
      // the browser only reports in the service worker console, long after
      // deploy.
      for (const token of ['__CACHE_NAME__', '__PRECACHE_MANIFEST__']) {
        if (!source.includes(token)) {
          throw new Error(
            `[lady-gestion:service-worker] ${token} not found in src/pwa/service-worker.js — ` +
              'the worker template and this plugin have drifted apart.'
          );
        }
      }

      await writeFile(
        join(outDir, 'sw.js'),
        source
          .replace('__CACHE_NAME__', `lady-gestion-${cacheHash.digest('hex').slice(0, 12)}`)
          .replace('__PRECACHE_MANIFEST__', JSON.stringify(entries, null, 2))
      );
    }
  };
}

/**
 * Writes the two files GitHub Pages needs and no bundler knows about.
 *
 * `404.html` is the SPA fallback. Pages serves static files and has no rewrite
 * rules — `public/_redirects` is read by Netlify and Cloudflare, and is inert
 * here — so a cold load of `/events`, a manifest shortcut, a shared
 * `/horse/<id>` link or a refresh on any route is a request for a file that
 * does not exist. What Pages does have is a convention: it returns `404.html`
 * for every unmatched path. A byte copy of the built shell there boots the app,
 * which then resolves the route client-side exactly as it would have.
 *
 * The copy is of `dist/index.html`, not the source: the shell has to carry the
 * hashed script and style tags the build just emitted, or the fallback loads an
 * app that cannot start.
 *
 * `.nojekyll` stops Pages running the output through Jekyll, which drops files
 * and directories whose names begin with an underscore. The Actions-based
 * deploy in `.github/workflows/ci.yml` never invokes Jekyll, so today this is
 * inert — it is what keeps the output intact if the site is ever switched back
 * to deploying from a branch.
 *
 * Ordered after `serviceWorker()` in the plugin array so neither file is on
 * disk when the precache manifest is built.
 */
function githubPages(): Plugin {
  let outDir = 'dist';

  return {
    name: 'lady-gestion:github-pages',
    apply: 'build',
    enforce: 'post',

    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },

    async closeBundle() {
      const shell = await readFile(join(outDir, 'index.html'));

      await Promise.all([
        writeFile(join(outDir, '404.html'), shell),
        writeFile(join(outDir, '.nojekyll'), '')
      ]);
    }
  };
}

/**
 * Vendor code gets its own chunks, keyed by package rather than left to the
 * bundler's automatic grouping.
 *
 * Not a size optimisation — the byte count is roughly unchanged. It is what
 * makes the per-file `revision` manifest above pay off. Left to itself, the
 * bundler hoists shared modules into the most-depended-on app chunk, and it
 * picked `app-icon`: Lit, Dexie and all 29 inlined SVGs ended up sharing one
 * content hash (147 kB raw / 49.6 kB gzip), so **editing a single icon changed
 * that hash and every installed device re-downloaded Lit and Dexie**. Splitting
 * by package means a chunk's hash only moves when that package does.
 *
 * `codeSplitting` and not `manualChunks`: Vite 8 bundles with Rolldown, where
 * `manualChunks` survives only as a deprecated Rollup-compatibility shim that
 * is translated into exactly this (as is `advancedChunks`, the spelling in
 * between — both warn on build). Groups are data, so the id-to-package function
 * that shim needs is not written here at all.
 *
 * Each `test` matches the directory name under `node_modules`, not a bare
 * substring — `/lit/` would also claim `polylit` and any app path with "lit" in
 * it. Lit arrives under four names (`lit` re-exports `lit-html`, `lit-element`
 * and `@lit/reactive-element`, which pulls in `@lit-labs/ssr-dom-shim`); they
 * version together, so they belong together. `d3-shape` brings `d3-path`, and
 * only `app-donut-chart` imports either, so that chunk stays behind the
 * `/budget` dynamic import.
 */
const vendorChunks = [
  { name: 'lit', test: /[\\/]node_modules[\\/](lit|lit-html|lit-element|@lit(-labs)?)[\\/]/ },
  { name: 'dexie', test: /[\\/]node_modules[\\/]dexie[\\/]/ },
  { name: 'd3', test: /[\\/]node_modules[\\/]d3-[^\\/]+[\\/]/ }
];

export default defineConfig({
  /**
   * The repository is a GitHub Pages *project* site, served from
   * `https://jeremiels.github.io/lady-gestion/` rather than an origin root.
   *
   * Vite rewrites the asset URLs it owns — the tags in `index.html`, `url()` in
   * processed CSS — but it cannot rewrite paths the app computes at runtime or
   * files copied verbatim out of `public/`. Those go through
   * `src/commons/base-path.ts`, which reads this value back as
   * `import.meta.env.BASE_URL`, and through relative URLs in the webmanifest.
   *
   * `vitest.config.ts` is a separate config and does not inherit this, so the
   * suites keep running at the origin root — which is also what `npm run dev`
   * serves, so both exercise the `base === '/'` path through that module.
   */
  base: '/lady-gestion/',

  plugins: [iconSprite({ names: ICON_NAMES }), serviceWorker(), githubPages()],

  build: {
    rollupOptions: {
      output: {
        codeSplitting: { groups: vendorChunks }
      }
    }
  }
});
