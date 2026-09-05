import { render, type TemplateResult } from "lit";
import type { LitElement } from "lit";
import { afterEach } from "vitest";
import { clearViewState } from "../../commons/controllers/view-state.ts";

const containers = new Set<HTMLElement>();

/**
 * Renders a template into a throwaway container attached to the document and
 * hands back the first element in it, updated and settled.
 *
 * Attached rather than detached on purpose: `connectedCallback` is where every
 * controller in this app subscribes, `showModal()` throws on a disconnected
 * dialog, and `:state()` / `:focus-visible` only mean anything for an element
 * in a rendered tree. A fixture that skipped the document would be testing
 * something the app never does.
 */
export async function fixture<T extends Element>(
  template: TemplateResult,
): Promise<T> {
  const container = document.createElement("div");
  document.body.append(container);
  containers.add(container);

  render(template, container);

  const element = container.firstElementChild as T;
  await settled(element);
  return element;
}

/**
 * Waits until an element has no further update pending.
 *
 * A single `await el.updateComplete` is not enough here. Several of these
 * components legitimately set reactive state from inside `updated()` — a field
 * mirrors its native control's validity there, because the control does not
 * settle until the DOM has caught up — and Lit signals that by resolving
 * `updateComplete` with `false`. Awaiting once lands mid-cascade and reads
 * state that is about to change, which is exactly the kind of flake that makes
 * people stop trusting a suite.
 */
export async function settled(element: Element): Promise<void> {
  const host = element as Partial<LitElement>;
  if (!host.updateComplete) return;

  // Bounded: a component that never settles is a bug this should surface as a
  // failure rather than hang the run.
  for (let i = 0; i < 20; i++) {
    if (await host.updateComplete) return;
  }
  throw new Error(
    `${element.localName} never settled — updateComplete kept resolving false`,
  );
}

/**
 * Waits until `predicate` holds, settling the element between tries.
 *
 * A `LiveQuery`'s first value arrives a settled-promise tick or more after
 * mount — see the gate in `data/ready.ts` — so a single `await settled(el)`
 * right after `fixture()` is too early. Bounded like `settled` itself: a
 * predicate that never turns true is a bug the suite should fail on, not
 * hang on.
 */
export async function waitFor(
  element: Element,
  predicate: () => boolean,
): Promise<void> {
  for (let i = 0; i < 20 && !predicate(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settled(element);
  }
  if (!predicate()) throw new Error("waitFor: condition never became true");
}

afterEach(() => {
  for (const container of containers) container.remove();
  containers.clear();

  // The whole run shares the runner's one history entry, and `ViewState` keeps
  // a view's UI state there deliberately — so without this, a test that
  // switches `EventsView` to list mode leaves that behind for the *next* test's
  // mount to restore, breaking a default-state assertion in another file with
  // nothing pointing at the cause. Here rather than in each view's suite, so a
  // view added later cannot forget it.
  clearViewState();
});
