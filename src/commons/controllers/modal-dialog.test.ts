import { userEvent } from "vitest/browser";
import { html, type TemplateResult } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { fixture, settled } from "../../components/__tests__/fixture.ts";
import { ModalDialog, type DialogHost } from "./modal-dialog.ts";

import "../../components/app-modal/app-modal.ts";
import "../../components/app-bottom-sheet/app-bottom-sheet.ts";

/**
 * `ModalDialog` is a state machine driven entirely by platform events —
 * `showModal()`, the top layer, `cancel`, `close`, and a backdrop click that
 * arrives as a click on the dialog element itself. None of that exists outside
 * a real browser, which is why this lives in the `components` project.
 *
 * Written once and run against both consumers, for the same reason the
 * `FormControl` suite is: the controller exists because the two components had
 * a verbatim copy of this plumbing, and the guarantee worth pinning is that
 * they still behave identically.
 *
 * What is deliberately *not* here is `app-bottom-sheet`'s drag-to-dismiss.
 * That is the sheet's own code rather than the controller's, and driving it
 * needs a real pointer sequence — `setPointerCapture` rejects a synthetic
 * `pointerId`. It stays a manual check.
 */

/** Resolves when `target` next fires `type`. Set up *before* triggering. */
function nextEvent(target: EventTarget, type: string): Promise<Event> {
  return new Promise((resolve) => {
    target.addEventListener(type, resolve, { once: true });
  });
}

type DialogCase = {
  tag: string;
  /** The event name prefix the controller was constructed with. */
  name: string;
  template: (open: boolean, dismissible: boolean) => TemplateResult;
};

const CASES: DialogCase[] = [
  {
    tag: "app-modal",
    name: "modal",
    template: (open, dismissible) => html`
      <app-modal
        heading="Supprimer ?"
        .open=${open}
        .dismissible=${dismissible}
      >
        <p class="body-content">Cette action est définitive.</p>
      </app-modal>
    `,
  },
  {
    tag: "app-bottom-sheet",
    name: "sheet",
    template: (open, dismissible) => html`
      <app-bottom-sheet
        heading="Ration"
        .open=${open}
        .dismissible=${dismissible}
      >
        <p class="body-content">Modifier les quantités.</p>
      </app-bottom-sheet>
    `,
  },
];

describe.each(CASES)("ModalDialog on $tag", (dialogCase) => {
  const mount = async (open = false, dismissible = true) => {
    const el = await fixture<DialogHost>(
      dialogCase.template(open, dismissible),
    );
    const dialog = el.renderRoot.querySelector("dialog")!;
    return { el, dialog };
  };

  /** Opens and waits for the open event, so tests start from a settled state. */
  const open = async (el: DialogHost) => {
    const opened = nextEvent(el, `${dialogCase.name}-open`);
    el.open = true;
    await settled(el);
    await opened;
  };

  describe("opening", () => {
    it("drives the native dialog into the top layer from the `open` property", async () => {
      const { el, dialog } = await mount();
      expect(dialog.open).toBe(false);

      await open(el);

      expect(dialog.open).toBe(true);
      // `:modal` is true only for a dialog shown with `showModal()` — this is
      // what puts it in the top layer, above every z-index there is, and it is
      // the whole reason both primitives are built on <dialog>.
      expect(dialog.matches(":modal")).toBe(true);
    });

    it("announces itself across the shadow boundary", async () => {
      const { el } = await mount();

      // Listening on the host, outside the shadow root: the controller
      // dispatches composed events precisely so a consumer's binding fires.
      const opened = nextEvent(el, `${dialogCase.name}-open`);
      el.open = true;
      await settled(el);

      await expect(opened).resolves.toBeInstanceOf(CustomEvent);
    });

    it("is idempotent across unrelated re-renders", async () => {
      const { el } = await mount();

      let opens = 0;
      el.addEventListener(`${dialogCase.name}-open`, () => (opens += 1));

      await open(el);

      // `sync()` runs from `hostUpdated` on *every* update rather than behind a
      // `changed.has('open')` check, so it has to no-op when the dialog is
      // already in the requested state — `showModal()` on an open dialog
      // throws.
      (el as unknown as { heading: string }).heading = "Autre titre";
      await settled(el);
      el.open = true;
      await settled(el);

      expect(opens).toBe(1);
      expect(el.renderRoot.querySelector("dialog")!.open).toBe(true);
    });
  });

  describe("closing", () => {
    it("closes on a close button press", async () => {
      const { el } = await mount();
      await open(el);

      const closed = nextEvent(el, `${dialogCase.name}-close`);
      el.renderRoot
        .querySelector<HTMLButtonElement>('[part="close-button"]')!
        .click();

      await closed;
      expect(el.open).toBe(false);
    });

    it("closes on Esc", async () => {
      // A real key press, not a synthetic `cancel`. It is the browser's own Esc
      // handling that closes the dialog, so dispatching `cancel` by hand leaves
      // it open and proves nothing. This is exactly the kind of thing a DOM
      // shim would have happily faked.
      const { el, dialog } = await mount();
      await open(el);

      const closed = nextEvent(el, `${dialogCase.name}-close`);
      await userEvent.keyboard("{Escape}");

      await closed;
      expect(el.open).toBe(false);
      expect(dialog.open).toBe(false);
    });

    it("closes on a backdrop click", async () => {
      const { el, dialog } = await mount();
      await open(el);

      // Clicking the ::backdrop dispatches on the dialog element itself, which
      // is the only way to tell it apart from a click on the content.
      const closed = nextEvent(el, `${dialogCase.name}-close`);
      dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      await closed;
      expect(el.open).toBe(false);
    });

    it("ignores a click on the content", async () => {
      const { el } = await mount();
      await open(el);

      // Bubbles up to the dialog's own handler, but `event.target` is the
      // paragraph, so it is not the backdrop and must not dismiss.
      const content = el.querySelector(".body-content")!;
      content.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true }),
      );
      await settled(el);

      expect(el.open).toBe(true);
    });

    it("closes programmatically", async () => {
      const { el } = await mount();
      await open(el);

      const closed = nextEvent(el, `${dialogCase.name}-close`);
      (el as unknown as { close: () => void }).close();

      await closed;
      expect(el.open).toBe(false);
    });

    it("closes when `open` is set back to false", async () => {
      const { el, dialog } = await mount();
      await open(el);

      const closed = nextEvent(el, `${dialogCase.name}-close`);
      el.open = false;
      await settled(el);

      await closed;
      expect(dialog.open).toBe(false);
    });
  });

  describe("dismissible=false", () => {
    it("blocks Esc", async () => {
      const { el, dialog } = await mount(false, false);
      await open(el);

      // Again a real press: `preventDefault()` on the `cancel` event is only
      // meaningful against the browser's own Esc handling, so asserting it
      // against a synthetic event would assert nothing about what a user sees.
      await userEvent.keyboard("{Escape}");
      await settled(el);

      expect(el.open).toBe(true);
      expect(dialog.open).toBe(true);
    });

    it("blocks a backdrop click", async () => {
      const { el, dialog } = await mount(false, false);
      await open(el);

      dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await settled(el);

      expect(el.open).toBe(true);
    });

    it("offers no close button", async () => {
      const { el } = await mount(false, false);
      await open(el);

      expect(el.renderRoot.querySelector('[part="close-button"]')).toBeNull();
    });

    it("still closes programmatically", async () => {
      const { el } = await mount(false, false);
      await open(el);

      // Not an escape hatch for the user — for the owning view, which may need
      // to take the dialog away once the task behind it is done.
      const closed = nextEvent(el, `${dialogCase.name}-close`);
      (el as unknown as { close: () => void }).close();

      await closed;
      expect(el.open).toBe(false);
    });
  });

  describe("teardown", () => {
    it("survives being closed while already closed", async () => {
      const { el } = await mount();

      // A consumer is invited to call this defensively, so it has to be a
      // no-op rather than throw on a dialog that was never opened.
      expect(() =>
        (el as unknown as { close: () => void }).close(),
      ).not.toThrow();
      expect(el.open).toBe(false);
    });
  });
});

/**
 * The page behind a modal must not scroll.
 *
 * `showModal()` makes the rest of the document inert — clicks and focus are
 * blocked — but leaves it scrollable, so a finger on the backdrop still pans
 * the page underneath. `ModalDialog` takes the lock because it is the only
 * thing that knows a real `<dialog>` is showing: `event-sheet` and
 * `document-viewer` both nest theirs inside a shadow root, out of reach of any
 * `html:has(app-modal[open])` rule the document could write.
 *
 * Not part of the `describe.each` above because the interesting cases need two
 * dialogs at once, which is the state a single-case fixture cannot reach.
 */
describe("ModalDialog scroll lock", () => {
  const isLocked = () =>
    document.documentElement.classList.contains("scroll-locked");

  const openSheet = async (heading: string) => {
    const el = await fixture<DialogHost>(
      html`<app-bottom-sheet heading=${heading}></app-bottom-sheet>`,
    );
    const opened = nextEvent(el, "sheet-open");
    el.open = true;
    await settled(el);
    await opened;
    return el;
  };

  it("locks the page while open and releases it on close", async () => {
    expect(isLocked()).toBe(false);

    const el = await openSheet("Ration");
    expect(isLocked()).toBe(true);

    const closed = nextEvent(el, "sheet-close");
    el.open = false;
    await settled(el);
    await closed;

    expect(isLocked()).toBe(false);
  });

  it("stays locked until the last of two dialogs closes", async () => {
    // The case a plain boolean gets wrong: `EventDetailView` mounts an edit
    // sheet, a delete modal and a document viewer side by side, and the inner
    // one closing must not hand the page back while another is still up.
    const first = await openSheet("Ration");
    const second = await openSheet("Confirmer");
    expect(isLocked()).toBe(true);

    const secondClosed = nextEvent(second, "sheet-close");
    second.open = false;
    await settled(second);
    await secondClosed;

    expect(isLocked()).toBe(true);

    const firstClosed = nextEvent(first, "sheet-close");
    first.open = false;
    await settled(first);
    await firstClosed;

    expect(isLocked()).toBe(false);
  });

  it("releases the lock when an open dialog is torn down", async () => {
    // A dialog removed while open never fires `close`, so without the release
    // in `hostDisconnected` the page would stay locked with nothing left on
    // screen to explain why — a navigation away from a view with an open sheet
    // does exactly this.
    const el = await openSheet("Ration");
    expect(isLocked()).toBe(true);

    el.remove();
    await settled(el);

    expect(isLocked()).toBe(false);
  });

  it("is idempotent when the same dialog closes twice", async () => {
    const el = await openSheet("Ration");
    const closed = nextEvent(el, "sheet-close");
    el.open = false;
    await settled(el);
    await closed;

    // Releasing a holder that no longer holds anything must not lift a lock
    // some other dialog is relying on.
    const other = await openSheet("Confirmer");
    el.remove();
    await settled(el);

    expect(isLocked()).toBe(true);

    other.remove();
    await settled(other);
    expect(isLocked()).toBe(false);
  });
});

/*
 * The self-driven exit.
 *
 * `overlay` is Chromium-only — no Safari has it at any version — so the
 * declarative exit both components describe in CSS never plays on iOS: a
 * closing dialog leaves the top layer the instant `close()` runs, and a sheet
 * that slides up snaps shut. Where the property is missing the controller holds
 * the dialog open under `data-closing` and closes it once the transitions have
 * finished.
 *
 * The runner is Chromium, which *does* support `overlay`, so these flip the
 * static the controller reads. Without that the branch every iPhone runs would
 * have no coverage at all.
 */
describe.each(CASES)("ModalDialog exit animation on $tag", (dialogCase) => {
  afterEach(() => {
    ModalDialog.supportsOverlay = true;
  });

  /**
   * Duration for the exit, long enough to assert against.
   *
   * This project's suite loads no document stylesheet, so every motion token the
   * two components transition on is undefined here. The *easings* matter as much
   * as the durations: one unresolved `var()` anywhere in a `transition`
   * shorthand throws the whole declaration out, so leaving them off means no
   * transition runs at all, the controller has nothing to wait for, and the exit
   * is over within a frame — which is exactly the behaviour these tests exist to
   * tell apart from a real one. Set on the host, so they inherit through
   * `:host` into both shadow roots.
   */
  const EXIT_MS = 400;

  const mountOpen = async () => {
    const el = await fixture<DialogHost>(dialogCase.template(false, true));
    const dialog = el.renderRoot.querySelector("dialog")!;

    el.style.setProperty("--duration-medium", `${EXIT_MS}ms`);
    el.style.setProperty("--duration-slow", `${EXIT_MS}ms`);
    el.style.setProperty("--easing-out", "ease");
    el.style.setProperty("--easing-sheet", "ease");

    const opened = nextEvent(el, `${dialogCase.name}-open`);
    el.open = true;
    await settled(el);
    await opened;

    // Flipped after opening, so the entry half is untouched — it rides
    // @starting-style, which Safari has had since 17.5.
    ModalDialog.supportsOverlay = false;
    return { el, dialog };
  };

  it("keeps the dialog in the top layer while the exit plays", async () => {
    const { el, dialog } = await mountOpen();

    const closed = nextEvent(el, `${dialogCase.name}-close`);
    el.open = false;
    await settled(el);

    // The whole point: still open, so still in the top layer and still
    // painting, with the exit state applied. Calling close() here — which is
    // what the platform does for us on Chromium — is what made the animation
    // invisible on Safari.
    expect(dialog.open).toBe(true);
    expect(dialog.matches(":modal")).toBe(true);
    expect(dialog.hasAttribute("data-closing")).toBe(true);

    await closed;

    expect(dialog.open).toBe(false);
    // Cleared before the close, so re-opening does not land in the exit state.
    expect(dialog.hasAttribute("data-closing")).toBe(false);
  });

  it("still announces the close, once there is nothing left to look at", async () => {
    const { el } = await mountOpen();

    const closed = nextEvent(el, `${dialogCase.name}-close`);
    el.open = false;

    await expect(closed).resolves.toBeInstanceOf(CustomEvent);
    // The host property follows the real dialog, as it does on either path.
    expect(el.open).toBe(false);
  });

  it("takes Esc through the same exit", async () => {
    const { el, dialog } = await mountOpen();

    // Recorded as it happens rather than sampled afterwards. Every other test
    // here reaches its assertion in microtasks, but `userEvent` presses a real
    // key and takes an unpredictable slice of the exit with it — reading the
    // state after that await passes alone and fails under a loaded full run.
    // What actually has to hold is that the dialog was held open in the exit
    // state at all, which is a thing to observe, not a moment to catch.
    let heldOpenWhileClosing = false;
    const observer = new MutationObserver(() => {
      if (dialog.open && dialog.hasAttribute("data-closing"))
        heldOpenWhileClosing = true;
    });
    observer.observe(dialog, {
      attributes: true,
      attributeFilter: ["data-closing"],
    });

    const closed = nextEvent(el, `${dialogCase.name}-close`);
    await userEvent.keyboard("{Escape}");
    await closed;
    observer.disconnect();

    // Esc is the one close the platform performs itself, so without taking the
    // cancel event over it would be the single way out that still snapped shut.
    expect(heldOpenWhileClosing).toBe(true);
    expect(dialog.open).toBe(false);
  });

  it("calls the exit off if the dialog is re-opened while it plays", async () => {
    const { el, dialog } = await mountOpen();

    el.open = false;
    await settled(el);
    expect(dialog.hasAttribute("data-closing")).toBe(true);

    el.open = true;
    await settled(el);

    expect(dialog.open).toBe(true);
    expect(dialog.hasAttribute("data-closing")).toBe(false);

    // And it stays: the exit that was already in flight must not close the
    // dialog out from under the re-open when its wait finally resolves.
    await new Promise((resolve) => setTimeout(resolve, EXIT_MS * 2));
    expect(dialog.open).toBe(true);
  });

  it("closes immediately where the platform can animate it itself", async () => {
    const { el, dialog } = await mountOpen();
    // Back to the Chromium path, which must stay exactly what it was: the
    // native `overlay` transition is the better mechanism where it exists.
    ModalDialog.supportsOverlay = true;

    el.open = false;
    await settled(el);

    expect(dialog.open).toBe(false);
    expect(dialog.hasAttribute("data-closing")).toBe(false);
  });
});
