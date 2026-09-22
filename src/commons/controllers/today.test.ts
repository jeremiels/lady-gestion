import type { ReactiveController, ReactiveControllerHost } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Today } from "./today.ts";

/** Just enough host to drive the controller's lifecycle by hand. */
const makeHost = () => {
  const controllers: ReactiveController[] = [];
  const host = {
    addController: (controller: ReactiveController) =>
      controllers.push(controller),
    removeController: () => {},
    requestUpdate: vi.fn(),
    updateComplete: Promise.resolve(true),
    connect: () => controllers.forEach((c) => c.hostConnected?.()),
    disconnect: () => controllers.forEach((c) => c.hostDisconnected?.()),
  };
  return host satisfies ReactiveControllerHost & Record<string, unknown>;
};

describe("Today", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 23, 23, 59, 0));
  });

  afterEach(() => vi.useRealTimers());

  it("turns over at local midnight", () => {
    const host = makeHost();
    const onChange = vi.fn();
    const today = new Today(host, onChange);
    host.connect();

    expect(today.value).toBe("2026-09-23");
    vi.advanceTimersByTime(60_000);

    expect(today.value).toBe("2026-09-24");
    expect(onChange).toHaveBeenCalledOnce();
    expect(host.requestUpdate).toHaveBeenCalledOnce();
    host.disconnect();
  });

  it("catches up when the page becomes visible again", () => {
    const host = makeHost();
    const onChange = vi.fn();
    const today = new Today(host, onChange);
    host.connect();

    // A suspended app runs no timers: the clock moves, nothing fires.
    vi.setSystemTime(new Date(2026, 8, 24, 8, 0, 0));
    document.dispatchEvent(new Event("visibilitychange"));

    expect(today.value).toBe("2026-09-24");
    expect(onChange).toHaveBeenCalledOnce();
    host.disconnect();
  });

  it("stays quiet while the day has not changed, and after disconnect", () => {
    const host = makeHost();
    const onChange = vi.fn();
    const today = new Today(host, onChange);
    host.connect();

    document.dispatchEvent(new Event("visibilitychange"));
    expect(onChange).not.toHaveBeenCalled();
    expect(today.value).toBe("2026-09-23");

    host.disconnect();
    vi.advanceTimersByTime(60_000);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
