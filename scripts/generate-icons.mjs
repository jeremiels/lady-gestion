/**
 * Generates the PWA icon set into `public/icons/`.
 *
 * The artwork is a horseshoe drawn as a single thick stroked arc, so it stays
 * crisp at 48px and needs no tracing tool. Everything is derived from the two
 * brand colors below, which mirror `--color-brown-0` and `--color-brown-8`.
 *
 * Rasterizing needs `sharp`, which is NOT a project dependency — icons are
 * generated once and committed. To regenerate:
 *
 *   npm i -D sharp && node scripts/generate-icons.mjs && npm un sharp
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const OUT = fileURLToPath(new URL('../public/icons/', import.meta.url));

const BACKGROUND = '#4A2C17'; // --color-brown-0
const FOREGROUND = '#F5F1EC'; // --color-brown-8 / --color-page

const SIZE = 512;
const CENTER = { x: 256, y: 242 };
const RADIUS = 130;
const BAND = 60;

const point = (angle, radius = RADIUS) => {
  const rad = (angle * Math.PI) / 180;
  return [CENTER.x + radius * Math.cos(rad), CENTER.y - radius * Math.sin(rad)];
};

const round = (n) => Math.round(n * 100) / 100;

/**
 * A ~296° arc opening at the bottom. `large-arc=1, sweep=0` picks the long way
 * round through the top; round caps turn the two ends into the shoe branches.
 */
function horseshoe() {
  const [ax, ay] = point(-48);
  const [bx, by] = point(228);

  const arc = `M ${round(ax)} ${round(ay)} A ${RADIUS} ${RADIUS} 0 1 0 ${round(bx)} ${round(by)}`;

  // Nail holes sit on the branches, never at the top of the shoe.
  const holes = [-28, 12, 52, 128, 168, 208]
    .map((angle) => {
      const [x, y] = point(angle);
      return `<circle cx="${round(x)}" cy="${round(y)}" r="11" fill="${BACKGROUND}" />`;
    })
    .join('\n      ');

  return `<path d="${arc}" fill="none" stroke="${FOREGROUND}" stroke-width="${BAND}" stroke-linecap="round" />
      ${holes}`;
}

/**
 * @param {{ radius: number, scale: number }} options
 *   `radius` is the background corner radius (0 = full bleed, for masked
 *   icons); `scale` shrinks the glyph to clear a platform's safe zone.
 */
function icon({ radius, scale }) {
  const offset = round((SIZE * (1 - scale)) / 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" rx="${radius}" ry="${radius}" fill="${BACKGROUND}" />
  <g transform="translate(${offset} ${offset}) scale(${scale})">
      ${horseshoe()}
  </g>
</svg>
`;
}

// `any` icons are drawn as-is by the platform, so they carry their own corners.
const standard = icon({ radius: 96, scale: 1 });
// Maskable icons get cropped to an arbitrary shape; the glyph must stay inside
// the 80%-diameter safe circle, so it is full bleed and shrunk.
const maskable = icon({ radius: 0, scale: 0.82 });
// iOS applies its own squircle mask and dislikes transparency or rounded PNGs.
const appleTouch = icon({ radius: 0, scale: 0.86 });

await mkdir(OUT, { recursive: true });

await writeFile(`${OUT}icon.svg`, standard);
await writeFile(`${OUT}icon-maskable.svg`, maskable);

const png = (svg, size, name) =>
  sharp(Buffer.from(svg))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}${name}`);

await Promise.all([
  png(standard, 192, 'icon-192.png'),
  png(standard, 512, 'icon-512.png'),
  png(maskable, 192, 'icon-maskable-192.png'),
  png(maskable, 512, 'icon-maskable-512.png'),
  png(appleTouch, 180, 'apple-touch-icon.png')
]);

console.log(`Icons written to ${OUT}`);
