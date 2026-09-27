import { beforeAll, describe, expect, it } from "vitest";
import { initDoubleTapGuard } from "./double-tap-guard.ts";

/** A host with two controls in its shadow root, as every component here is. */
const component = () => {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = "<button>A</button><button>B</button>";
  document.body.append(host);
  const [a, b] = root.querySelectorAll("button");
  return { host, a: a!, b: b! };
};

/** A tap's end, composed as the real one is. `true` when the guard ate it. */
const tapEnd = (target: Element) => {
  const event = new Event("touchend", {
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
};

beforeAll(initDoubleTapGuard);

describe("double-tap guard", () => {
  it("eats a second tap on the same control, the one Safari would zoom for", () => {
    const { host, a } = component();

    tapEnd(a);
    expect(tapEnd(a)).toBe(true);
    host.remove();
  });

  it("keeps a quick tap on another control of the same component", () => {
    const { host, a, b } = component();

    tapEnd(a);
    expect(tapEnd(b)).toBe(false);
    host.remove();
  });
});
