/**
 * Stops the page behind a modal dialog from scrolling.
 *
 * `showModal()` puts the dialog in the top layer and makes the rest of the
 * document inert, which blocks clicks and focus — but **not scrolling**. A
 * finger on the backdrop still pans the page underneath, and a flick that
 * starts inside the sheet's own scroller chains out to the document the moment
 * that scroller hits its end. The first is fixed here; the second is fixed in
 * `DialogElement`'s `overscroll-behavior: contain`, because it is a property of
 * the inner scroller rather than of the document.
 *
 * **Holders, not a counter.** Two dialogs can be open at once — `EventDetailView`
 * mounts an edit sheet, a delete modal and a document viewer side by side — so
 * the lock has to survive the inner one closing. A count would do that, until
 * something released twice and drove it negative, or a dialog was torn down
 * while open and never released at all. A `Set` keyed on the holder makes both
 * calls idempotent by construction: releasing twice is the same as releasing
 * once, and the lock lifts exactly when the last real holder lets go.
 *
 * **A class rather than an inline style**, so the rule lives with the rest of
 * the document's CSS (`layers/base.css`) and can carry the `scrollbar-gutter`
 * that stops a desktop page jumping sideways as its scrollbar disappears.
 */

const holders = new Set<object>();

const LOCKED_CLASS = "scroll-locked";

/**
 * Takes the lock on behalf of `holder`.
 *
 * `overflow: hidden` on the root element keeps the current scroll offset — the
 * page stays where the user left it and is still there when the lock lifts,
 * with none of the scroll-position bookkeeping the old `position: fixed` trick
 * needed.
 */
export const lockScroll = (holder: object): void => {
  holders.add(holder);
  document.documentElement.classList.add(LOCKED_CLASS);
};

/** Releases `holder`'s claim, lifting the lock once nothing else holds it. */
export const unlockScroll = (holder: object): void => {
  if (!holders.delete(holder)) return;
  if (holders.size === 0)
    document.documentElement.classList.remove(LOCKED_CLASS);
};
