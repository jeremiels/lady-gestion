import type { ReactiveControllerHost } from "lit";
import { LiveQuery, metaRepo } from "../../data/index.ts";
import type { HorseCover } from "../../data/types.ts";

/**
 * The one object URL of the cover photo, shared by every view for as long as
 * the photo is the same. Shared so the dashboard and the horse page draw one
 * image the browser has already decoded, as they do the bundled photo: a URL
 * per view would be decoded again on every navigation, after the page had
 * slid in. Revoked only when another photo replaces it.
 */
let shared: { pickedAt: string; url: string } | undefined;

const urlOf = (cover: HorseCover): string => {
  if (shared?.pickedAt !== cover.pickedAt) {
    if (shared) URL.revokeObjectURL(shared.url);
    shared = {
      pickedAt: cover.pickedAt,
      url: URL.createObjectURL(cover.blob),
    };
  }
  return shared.url;
};

/**
 * The cover photo she picked, as a URL `horse-card` can draw, for the views
 * that own one.
 *
 *     #cover = new CoverUrl(this);
 *
 *     // <horse-card .horse=${horse} .cover=${this.#cover.for(horse?.id)}>
 *
 * Holds the host only for the `LiveQuery` it reads through, which re-renders
 * it when the photo changes.
 */
export class CoverUrl {
  #cover: LiveQuery<HorseCover | undefined>;

  constructor(host: ReactiveControllerHost) {
    this.#cover = new LiveQuery(host, () => metaRepo.getHorseCover());
  }

  /**
   * `undefined` until the database has answered — draw no photo yet, or the
   * bundled one would show for a tick before hers — then `null` for a horse
   * with no photo of its own.
   */
  for(horseId: string | undefined): string | null | undefined {
    if (this.#cover.loading) return undefined;
    const cover = this.#cover.value;
    return cover && cover.horseId === horseId ? urlOf(cover) : null;
  }
}
