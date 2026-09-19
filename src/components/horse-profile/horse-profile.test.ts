import { html } from "lit";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { makeHorse } from "../../data/__tests__/factories.ts";
import { fixture, settled } from "../__tests__/fixture.ts";
import "./horse-profile.ts";
import type { HorseProfile } from "./horse-profile.ts";

const SIRE = "2139236F";

/**
 * `navigator.clipboard` is genuinely there — this suite runs in Chromium over
 * localhost, a secure context — but `writeText` also wants the document
 * focused, and the runner's frame is not reliably focused. Letting the real one
 * run would buy a flake, not coverage. Spying on the instance method rather
 * than replacing `navigator.clipboard` keeps `restoreAllMocks` able to put the
 * platform back.
 */
let writeText: MockInstance<Clipboard["writeText"]>;

beforeEach(() => {
  writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const mount = (sireNumber: string | null) =>
  fixture<HorseProfile>(
    html`<horse-profile .horse=${makeHorse({ sireNumber })}></horse-profile>`,
  );

const button = (el: HorseProfile) =>
  el.renderRoot.querySelector<HTMLButtonElement>(".copy");
const state = (el: HorseProfile) => button(el)?.dataset.state;
const announcement = (el: HorseProfile) =>
  el.renderRoot.querySelector('[role="status"]')?.textContent?.trim();
const identityValues = (el: HorseProfile) =>
  [
    ...el.renderRoot
      .querySelectorAll(".section")[0]!
      .querySelectorAll(".item__value"),
  ].map((node) => node.textContent?.trim());

const tap = async (el: HorseProfile) => {
  button(el)!.click();
  await settled(el);
};

describe("horse-profile", () => {
  it("keeps .item__value holding the value and nothing else", async () => {
    const el = await mount(SIRE);

    // The local half of the contract `views/HorseView.test.ts` reads the
    // identity card through: "Copié !" is the reel's sibling, never its child,
    // so wrapping the row in a button must not change what this says.
    // Sexe, Âge, Race, N° Sire, in that order — the age is derived from today
    // and is the one value that cannot be pinned to a literal.
    const values = identityValues(el);
    expect(values).toHaveLength(4);
    expect(values[0]).toBe("Jument");
    expect(values[2]).toBe("—");
    expect(values[3]).toBe(SIRE);
  });

  it("leaves the row inert when there is no number to copy", async () => {
    const el = await mount(null);

    expect(button(el)).toBeNull();
    expect(identityValues(el)[3]).toBe("—");
  });

  it("copies the number and confirms it", async () => {
    const el = await mount(SIRE);
    await tap(el);

    expect(writeText).toHaveBeenCalledWith(SIRE);
    expect(state(el)).toBe("copied");
    expect(announcement(el)).toBe("Numéro SIRE copié.");
  });

  it("carries the value on both ends of the reel, so the cycle can keep descending", async () => {
    const el = await mount(SIRE);
    const rows = [...el.renderRoot.querySelectorAll(".copy__row")].map(
      (node) => ({
        icon: node.querySelector("app-icon")!.getAttribute("icon"),
        text: node.querySelector(".copy__text")!.textContent?.trim(),
      }),
    );

    // Each row owns its glyph, which is what lets the icon travel with the
    // words it belongs to instead of cutting under them mid-slide. The value
    // appears at both ends so the reel can keep descending rather than rewind.
    expect(rows).toEqual([
      { icon: "copy", text: SIRE },
      { icon: "check", text: "Copié !" },
      { icon: "copy", text: SIRE },
    ]);
  });

  it("claims nothing when the write is refused", async () => {
    writeText.mockRejectedValue(new DOMException("denied", "NotAllowedError"));

    const el = await mount(SIRE);
    await tap(el);

    expect(state(el)).toBe("idle");
    expect(announcement(el)).toBe("");
  });

  it("ends the confirmation once the hold runs out", async () => {
    vi.useFakeTimers();
    const el = await mount(SIRE);
    await tap(el);

    vi.advanceTimersByTime(3000);
    await settled(el);

    // Not "idle": that last step waits on the reel's own `transitionend`, which
    // needs a real transition and real time. What is asserted here is the part
    // the timer owns — the confirmation is over.
    expect(state(el)).not.toBe("copied");
    expect(announcement(el)).toBe("");
  });

  it("extends the hold on a second tap instead of replaying the reel", async () => {
    vi.useFakeTimers();
    const el = await mount(SIRE);
    await tap(el);

    vi.advanceTimersByTime(2000);
    await tap(el);
    vi.advanceTimersByTime(2000);
    await settled(el);

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(state(el)).toBe("copied");

    vi.advanceTimersByTime(1500);
    await settled(el);
    expect(state(el)).not.toBe("copied");
  });
});
