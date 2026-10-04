import { describe, expect, it } from "vitest";
import { toCoverBlob } from "./cover-image.ts";

/** A picked photo of the given size, as the file input would hand it over. */
const photo = async (width: number, height: number): Promise<Blob> => {
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d")!.fillRect(0, 0, width, height);
  return canvas.convertToBlob({ type: "image/png" });
};

const sizeOf = async (blob: Blob): Promise<[number, number]> => {
  const bitmap = await createImageBitmap(blob);
  return [bitmap.width, bitmap.height];
};

describe("toCoverBlob", () => {
  it("scales a phone photo down to a 1536 px shorter edge, as JPEG", async () => {
    const cover = await toCoverBlob(await photo(4032, 3024));

    expect(cover.type).toBe("image/jpeg");
    expect(await sizeOf(cover)).toEqual([2048, 1536]);
  });

  it("keeps a portrait photo's proportions", async () => {
    expect(await sizeOf(await toCoverBlob(await photo(3024, 4032)))).toEqual([
      1536, 2048,
    ]);
  });

  it("never scales a small photo up", async () => {
    expect(await sizeOf(await toCoverBlob(await photo(800, 600)))).toEqual([
      800, 600,
    ]);
  });

  it("refuses a file that is not an image", async () => {
    await expect(
      toCoverBlob(new Blob(["%PDF-1.4"], { type: "application/pdf" })),
    ).rejects.toBeDefined();
  });
});
