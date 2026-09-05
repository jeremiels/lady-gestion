/**
 * Service worker source. Plain JS on purpose: it is never bundled or type
 * checked — the plugin in `vite.config.ts` reads this file, replaces the two
 * `__…__` tokens below and writes the result to `dist/sw.js`.
 *
 * Strategy: precache the whole build on install (the app has no backend, so
 * "the whole build" is the entire app), then serve everything cache-first.
 * A new build produces a new `CACHE_NAME`, so the old cache is dropped
 * wholesale on activate instead of being invalidated entry by entry.
 *
 * A new cache does **not** mean a new download. The install copies every entry
 * whose `revision` is unchanged out of the previous build's cache and only
 * fetches the rest — see `install` below.
 */

/** Replaced at build time — a content hash of every precached file. */
const CACHE_NAME = "__CACHE_NAME__";

/**
 * Replaced at build time with `[{ url, revision }]` for every built and public
 * asset. `revision` is a hash of that one file's contents.
 */
const PRECACHE_MANIFEST = __PRECACHE_MANIFEST__;

/**
 * The path the app is served under, derived from where this file sits.
 *
 * `sw.js` is emitted at the root of the build output, so the directory part of
 * its own URL is the app's base — `/` from an origin root, `/lady-gestion/` on
 * GitHub Pages. Derived rather than injected as a third build-time token: a
 * worker is scoped to its own directory whatever this file says, so a token
 * that disagreed with `self.location` would leave it precaching one prefix
 * while controlling another.
 */
const BASE = new URL("./", self.location.href).pathname;

/** Deep links (`/events`, `/horse/…`) are all served by the same shell. */
const APP_SHELL = BASE;

/**
 * Where the manifest above is stored inside its own cache, so the *next*
 * install can read the revisions this build shipped with.
 *
 * A cache entry records only a URL and a response — not what build wrote it —
 * so without this the next install would know its own revisions and have no
 * way to compare them against what is already on the device. Named `__…` so it
 * cannot collide with anything the build emits, and kept under `BASE` so it
 * stays inside the worker's own scope.
 */
const MANIFEST_URL = `${BASE}__precache-manifest`;

/**
 * Precached entries are stored from requests the worker built itself, which
 * carry no `Origin` header — while a module script or a stylesheet requested
 * by the page does. Any server sending `Vary: Origin` (Vite's preview server
 * does) would then turn every one of those lookups into a miss, and the app
 * would fail to boot offline. Nothing here is content-negotiated, so the
 * header is simply not part of the cache key.
 */
/**
 * Scoped to this build's cache. Without `cacheName` the lookup searches every
 * cache in the origin, so during the window where a new worker has installed
 * but the old one still controls the page, both builds' caches hold `/` and
 * the winner depends on creation order.
 */
const MATCH_OPTIONS = { ignoreVary: true, cacheName: CACHE_NAME };

/**
 * Everything the previous build left behind that this one can reuse.
 *
 * Returns a `Map` from URL to a still-valid cached `Response`, holding only
 * entries whose revision matches what this build wants. Entries whose bytes
 * changed, and entries this build no longer ships, are simply absent — the old
 * cache is deleted wholesale on activate either way.
 */
async function reusableEntries() {
  const wanted = new Map(
    PRECACHE_MANIFEST.map((entry) => [entry.url, entry.revision]),
  );
  const reusable = new Map();

  for (const name of await caches.keys()) {
    if (name === CACHE_NAME) continue;

    const previous = await caches.open(name);
    const manifest = await previous.match(MANIFEST_URL, { ignoreVary: true });
    // A cache with no manifest predates this scheme, or was written by
    // something else entirely. Nothing in it can be trusted by revision.
    if (!manifest) continue;

    let entries;
    try {
      entries = await manifest.json();
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (reusable.has(entry.url)) continue;
      if (wanted.get(entry.url) !== entry.revision) continue;

      const hit = await previous.match(entry.url, { ignoreVary: true });
      if (hit) reusable.set(entry.url, hit);
    }
  }

  return reusable;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Carried forward rather than re-fetched. Without this every deploy costs
      // each returning user the whole build again — the JS bundle, the WebP,
      // the font subset, every icon — because the cache name is derived from
      // the build's contents and activate drops the old cache entirely. A
      // one-file change now costs one file.
      const reusable = await reusableEntries();

      const results = await Promise.allSettled(
        PRECACHE_MANIFEST.map(async ({ url }) => {
          const carried = reusable.get(url);
          if (carried) return cache.put(url, carried);

          // `reload` bypasses the HTTP cache: index.html is not content-hashed,
          // so without it a fresh install can precache the previous deploy's
          // shell.
          return cache.add(new Request(url, { cache: "reload" }));
        }),
      );

      // `addAll` rejects without naming the entry that failed, and a failed
      // install means no offline mode at all — worth a diagnostic. Adding them
      // individually still fails the install: a partial precache is worse than
      // none, because the shell would boot offline and then 404 on a chunk.
      const failed = PRECACHE_MANIFEST.filter(
        (_, index) => results[index].status === "rejected",
      );

      if (failed.length > 0) {
        console.error(
          "[sw] Précache incomplet, installation abandonnée :",
          failed.map((entry) => entry.url),
        );
        throw new Error(`Precache failed for ${failed.length} file(s)`);
      }

      // Last, and only once every entry landed: this is what the *next* install
      // reads to decide what it can reuse, so it must never describe a cache
      // that was not fully written.
      await cache.put(
        MANIFEST_URL,
        new Response(JSON.stringify(PRECACHE_MANIFEST), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    })(),
  );
  // No skipWaiting() here: the new worker stays parked until the user accepts
  // the update (see `app-update-toast`), so a running session is never swapped
  // out from under itself.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // A full page load or a deep link: always answer with the cached shell so
  // the app opens offline, whatever the path.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cached = await caches.match(APP_SHELL, MATCH_OPTIONS);
        if (cached) return cached;

        try {
          return await fetch(request);
        } catch {
          // No cached shell and no network — only reachable before the first
          // install has completed. An explicit response beats a rejected
          // promise, which the browser renders as its own offline error page.
          return new Response("Application indisponible hors ligne.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request, MATCH_OPTIONS);
      if (cached) return cached;

      try {
        const response = await fetch(request);

        // Anything the build did not know about (a lazily added asset) is worth
        // keeping, but only if it actually came back intact.
        if (response.ok && response.type === "basic") {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
        }

        return response;
      } catch (error) {
        // Offline and never precached. Without this the promise rejects
        // unhandled, which surfaces as an opaque failure with no clue as to
        // which resource was missing.
        console.warn(
          "[sw] Ressource indisponible hors ligne :",
          request.url,
          error,
        );
        return Response.error();
      }
    })(),
  );
});
