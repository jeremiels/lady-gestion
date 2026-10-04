/**
 * The shorter edge a cover photo is stored at, at most: the bundled photo's
 * width (`horse-card`), which already covers the widest box the card is drawn
 * in at three device pixels per CSS pixel.
 */
const SHORT_EDGE = 1536;

const QUALITY = 0.9;

/**
 * A picked photo as the cover the app keeps: scaled down to `SHORT_EDGE`,
 * never up, and re-encoded as JPEG.
 *
 * An iPhone original is twelve megapixels and several megabytes, and the card
 * is the dashboard's first large paint: kept as picked, it would be decoded
 * whole on every launch to fill a box a third of its width. Her original stays
 * in her photo library; this is the copy the card draws.
 *
 * Decoded with the photo's EXIF orientation applied, so a portrait taken with
 * the phone upright is stored upright: the canvas keeps no EXIF to say so
 * afterwards.
 */
export const toCoverBlob = async (file: Blob): Promise<Blob> => {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    const scale = Math.min(
      1,
      SHORT_EDGE / Math.min(bitmap.width, bitmap.height),
    );
    const canvas = new OffscreenCanvas(
      Math.round(bitmap.width * scale),
      Math.round(bitmap.height * scale),
    );
    canvas
      .getContext("2d")!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvas.convertToBlob({ type: "image/jpeg", quality: QUALITY });
  } finally {
    bitmap.close();
  }
};
