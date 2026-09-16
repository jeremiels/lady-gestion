/**
 * Generates the PWA icon set into `public/icons/`.
 *
 * The artwork is `scripts/icon-source.png`, a 1024px raster drawing on a
 * full-bleed `--color-page` background. It is opaque and the drawing already
 * sits inside the 80%-diameter maskable safe circle, so every icon — `any`,
 * `maskable` and the iOS touch icon — is the same image, only resized.
 *
 * Rasterizing needs `sharp`, which is NOT a project dependency — icons are
 * generated once and committed. To regenerate:
 *
 *   npm i -D sharp && node scripts/generate-icons.mjs && npm un sharp
 */
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const SOURCE = fileURLToPath(new URL("./icon-source.png", import.meta.url));
const OUT = fileURLToPath(new URL("../public/icons/", import.meta.url));

await mkdir(OUT, { recursive: true });

const png = (size, name) =>
  sharp(SOURCE)
    .resize(size, size, { kernel: "lanczos3" })
    // iOS dislikes transparency in touch icons; the source is opaque anyway.
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}${name}`);

await Promise.all([
  png(192, "icon-192.png"),
  png(512, "icon-512.png"),
  png(192, "icon-maskable-192.png"),
  png(512, "icon-maskable-512.png"),
  png(180, "apple-touch-icon.png"),
]);

console.log(`Icons written to ${OUT}`);
