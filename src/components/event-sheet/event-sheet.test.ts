import { html } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../data/db.ts";
import {
  HORSE_ID,
  makeHorse,
  resetDb,
} from "../../data/__tests__/factories.ts";
import * as activitiesRepo from "../../data/repositories/activities.repo.ts";
import { fixture, settled } from "../__tests__/fixture.ts";
import type { AppCombobox } from "../app-combobox/app-combobox.ts";
import type { AppInput } from "../app-input/app-input.ts";
import type { AppSelect } from "../app-select/app-select.ts";
import "./event-sheet.ts";
import type { EventSheet } from "./event-sheet.ts";

/**
 * The submit path, and specifically what a *failed* submit shows.
 *
 * This form is `novalidate` — it has to be, the reader in `data/forms.ts` owns
 * the rules — so nothing the platform does will reveal anything. For a while
 * nothing else did either: `readForm` produced every message, each reached its
 * field as `error`, and not one was displayed, because a field only shows a
 * message once it is `touched` and only a blur or a native `invalid` event set
 * that. Pressing "Enregistrer" on an empty form appeared to do nothing at all.
 *
 * That failure was invisible to the rest of the suite: `form-control.test.ts`
 * covers a field told it is invalid, and every field here *was* told. What was
 * missing was anyone asking whether the user could see it.
 */

/** Mounts the sheet and waits for its horse — `#onSubmit` bails out without one. */
const openSheet = async () => {
  const el = await fixture<EventSheet>(html`<event-sheet open></event-sheet>`);

  // The horse arrives through a `LiveQuery`, which settles a tick or two after
  // mount. The submit button is disabled until it does, so that is the signal
  // to wait on rather than reaching into the controller.
  const button = () => el.renderRoot.querySelector('button[type="submit"]')!;
  for (let i = 0; i < 20 && button().hasAttribute("disabled"); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settled(el);
  }
  expect(button().hasAttribute("disabled"), "the horse never loaded").toBe(
    false,
  );

  return el;
};

const submit = async (el: EventSheet) => {
  const form = el.renderRoot.querySelector("form")!;
  form.requestSubmit();
  await settled(el);
  // `#onSubmit` is async and the reveal awaits another update after it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await settled(el);
  return form;
};

const fieldNamed = <T extends Element>(form: HTMLFormElement, name: string) =>
  form.querySelector<T>(`[name="${name}"]`)!;

/** Picks a value the way a user does, so the sheet's own state follows. */
const pick = async (el: EventSheet, name: string, value: string) => {
  const field = fieldNamed<AppSelect>(
    el.renderRoot.querySelector("form")!,
    name,
  );
  const select = field.renderRoot.querySelector("select")!;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await settled(el);
};

const fill = async (el: EventSheet, name: string, value: string) => {
  const field = fieldNamed<AppInput>(
    el.renderRoot.querySelector("form")!,
    name,
  );
  const input = field.renderRoot.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(
    new InputEvent("input", { bubbles: true, composed: true }),
  );
  await settled(field);
};

/**
 * Types a suggestion's label into the Nom combobox and leaves the field, the
 * way a user picks one without reaching for the mouse. Blurring is what
 * resolves the typed label back to the option's stored value — see
 * `AppCombobox#commit` — so a built-in's French label ends up submitting its
 * key, exactly as clicking the suggestion would.
 */
const pickActivity = async (el: EventSheet, label: string) => {
  const field = fieldNamed<AppCombobox>(
    el.renderRoot.querySelector("form")!,
    "activity",
  );
  const input = field.renderRoot.querySelector("input")!;
  input.value = label;
  input.dispatchEvent(
    new InputEvent("input", { bubbles: true, composed: true }),
  );
  await settled(field);
  input.dispatchEvent(new Event("blur"));
  await settled(field);
};

/**
 * The saved row, once the repository write has landed — `fixture`'s `waitFor`
 * takes a synchronous predicate and this condition has to await the database.
 */
const savedEvent = async () => {
  for (let i = 0; i < 20 && (await db.events.count()) === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const [stored] = await db.events.toArray();
  return stored;
};

/** What the user can actually read under a field, or `''` if nothing is shown. */
const errorTextOf = (field: AppCombobox | AppInput | AppSelect) => {
  const node = field.renderRoot.querySelector('[part="error"]');
  return node?.hasAttribute("hidden") ? "" : (node?.textContent?.trim() ?? "");
};

beforeEach(async () => {
  await resetDb();
  await db.horses.add(makeHorse());
});

describe("event-sheet submit", () => {
  it("shows a message on every required field left empty", async () => {
    const el = await openSheet();
    const form = await submit(el);

    // `type` and `title` are the required fields with nothing in them — `date`
    // is prefilled with today, so it parses.
    for (const name of ["type", "title"]) {
      const field = fieldNamed<AppInput | AppSelect>(form, name);
      expect(errorTextOf(field), `${name} should show its message`).not.toBe(
        "",
      );
    }
  });

  it("moves focus to the first field at fault", async () => {
    const el = await openSheet();
    const form = await submit(el);

    // `activeElement` is per-tree — at document level it reports the outermost
    // host — so the sheet's own root is where the focused field shows up.
    expect(el.shadowRoot!.activeElement).toBe(fieldNamed(form, "type"));
  });

  it("shows an error native validity could never have produced", async () => {
    const el = await openSheet();
    let form = el.renderRoot.querySelector("form")!;

    // Pick a type the way a user does, so the sheet's variant state follows.
    const type = fieldNamed<AppSelect>(form, "type");
    const select = type.renderRoot.querySelector("select")!;
    select.value = "veto";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settled(el);

    const title = fieldNamed<AppInput>(
      el.renderRoot.querySelector("form")!,
      "title",
    );
    const input = title.renderRoot.querySelector("input")!;
    input.value = "x".repeat(121);
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, composed: true }),
    );
    await settled(title);

    // The point of the case: `text({ maxLength: 120 })` is a rule only
    // `forms.ts` knows. The input carries no `maxlength` attribute, so the
    // browser considers this field perfectly valid and would have fired no
    // `invalid` event for anything to hang a reveal on.
    expect(input.validity.valid).toBe(true);

    form = await submit(el);
    expect(errorTextOf(fieldNamed<AppInput>(form, "title"))).toContain("120");
  });

  it("focuses the first field at fault in document order, not schema order", async () => {
    const el = await openSheet();
    let form = el.renderRoot.querySelector("form")!;

    // The care variant renders `counterparty` between `date` and `amountCents`,
    // but the submit schema declares `amountCents` first — so schema order and
    // document order disagree here, which is exactly the case that matters.
    const type = fieldNamed<AppSelect>(form, "type");
    const select = type.renderRoot.querySelector("select")!;
    select.value = "veto";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settled(el);

    form = el.renderRoot.querySelector("form")!;
    const title = fieldNamed<AppInput>(form, "title");
    const titleInput = title.renderRoot.querySelector("input")!;
    titleInput.value = "Vaccin";
    titleInput.dispatchEvent(
      new InputEvent("input", { bubbles: true, composed: true }),
    );
    await settled(title);

    // Both of these fail `readForm`: `counterparty` on length, `amountCents` on
    // shape — so both end up in `errors`, and only their position on screen
    // should decide which one gets focus.
    const counterparty = fieldNamed<AppInput>(form, "counterparty");
    const counterpartyInput = counterparty.renderRoot.querySelector("input")!;
    counterpartyInput.value = "x".repeat(121);
    counterpartyInput.dispatchEvent(
      new InputEvent("input", { bubbles: true, composed: true }),
    );
    await settled(counterparty);

    const amount = fieldNamed<AppInput>(form, "amountCents");
    const amountInput = amount.renderRoot.querySelector("input")!;
    amountInput.value = "abc";
    amountInput.dispatchEvent(
      new InputEvent("input", { bubbles: true, composed: true }),
    );
    await settled(amount);

    form = await submit(el);

    expect(el.shadowRoot!.activeElement).toBe(fieldNamed(form, "counterparty"));
  });

  it("keeps the sheet-level alert region mounted before it has anything to say", async () => {
    const el = await openSheet();

    // A live region has to be in the accessibility tree before its contents
    // change, so this one is never conditional and never hidden — only what is
    // inside it changes. Rendering it into existence alongside its message is
    // the shape screen readers announce as nothing.
    const region = el.renderRoot.querySelector(".event-form__error-region")!;
    expect(region).not.toBeNull();
    expect(region.getAttribute("role")).toBe("alert");
    expect(region.hasAttribute("hidden")).toBe(false);
    expect(region.textContent?.trim()).toBe("");
  });
});

/**
 * The `work` layout — the one whose Nom field is a combobox over the
 * activity rather than free text, whose Budget field is dropped entirely, and
 * whose activity (and the title derived from it) has to be dropped again on
 * the way out when the user changes their mind about the type.
 */
describe("event-sheet — the travail layout", () => {
  it("shows the Nom combobox and hides Nom’s text field and Budget for Travail", async () => {
    const el = await openSheet();
    await pick(el, "type", "travail");

    const form = el.renderRoot.querySelector("form")!;
    const activity = fieldNamed<AppCombobox>(form, "activity");
    expect(activity).not.toBeNull();
    expect(activity.label).toBe("Nom");
    expect(form.querySelector('[name="title"]')).toBeNull();
    expect(form.querySelector('[name="amountCents"]')).toBeNull();
    expect(form.querySelector('[name="counterparty"]')).toBeNull();
    expect(form.querySelector('[name="planFollowUp"]')).toBeNull();

    // And it leaves with the layout: a care event has its own Nom field and a
    // Budget again, and no more activity to record.
    await pick(el, "type", "veto");
    const restored = el.renderRoot.querySelector("form")!;
    expect(restored.querySelector('[name="activity"]')).toBeNull();
    expect(restored.querySelector('[name="title"]')).not.toBeNull();
    expect(restored.querySelector('[name="amountCents"]')).not.toBeNull();
  });

  it("refuses to save a Travail with no name picked", async () => {
    const el = await openSheet();
    await pick(el, "type", "travail");

    const form = await submit(el);

    // The message comes from `forms.ts`, not from a copy in the sheet — the
    // parser is simply the required overload on this layout.
    expect(errorTextOf(fieldNamed<AppCombobox>(form, "activity"))).not.toBe("");
    expect(await db.events.count()).toBe(0);
  });

  it("stores the activity key and derives the record’s Nom from its label", async () => {
    const el = await openSheet();
    await pick(el, "type", "travail");
    await pickActivity(el, "Longe");

    await submit(el);

    expect(await savedEvent()).toMatchObject({
      type: "travail",
      activity: "longe",
      title: "Longe",
    });
  });

  it("offers a custom activity from the day sheet’s catalogue alongside the built-ins", async () => {
    await activitiesRepo.add({ horseId: HORSE_ID, label: "Carrière" });

    const el = await openSheet();
    await pick(el, "type", "travail");

    const combobox = fieldNamed<AppCombobox>(
      el.renderRoot.querySelector("form")!,
      "activity",
    );
    expect(combobox.options.map((option) => option.label)).toContain(
      "Carrière",
    );
  });

  it("drops the activity and its derived title when the type is changed away from Travail", async () => {
    const el = await openSheet();
    await pick(el, "type", "travail");
    await pickActivity(el, "Longe");

    // Changing the type takes the field off screen, but a value the layout no
    // longer shows must not reach the record either — and it brings back the
    // Nom text field, which a create now has to fill in from scratch.
    await pick(el, "type", "cours");
    await fill(el, "title", "Séance du matin");

    await submit(el);

    expect(await savedEvent()).toMatchObject({ type: "cours", activity: null });
  });
});
