import { css, LitElement, type CSSResultGroup } from "lit";
import { resetStyles, utilityStyles } from "./reset.styles";

export class BaseElement extends LitElement {
  /** A component's own rules. Subclasses set this, never `styles`. */
  static componentStyles: CSSResultGroup = css``;

  /**
   * Rules shared by a *family* of components, between the reset and the
   * component's own — an intermediate base class overrides this, not `styles`.
   *
   * `FormFieldElement` is the one that does, with the hint/error/required rules
   * all three form fields render. Sitting below `componentStyles` is the point:
   * a field can still override a shared rule from its own stylesheet, on later
   * source order at equal specificity, exactly as the utilities below win over
   * the component.
   *
   * The hook exists so the ordering below stays declared in one place. An
   * intermediate class composing its own `[reset, shared, component, utilities]`
   * would be a second copy of that decision, and overriding `styles` naively is
   * worse still — `BaseElement.styles` reads `this.componentStyles`, so calling
   * it with `this` bound to `BaseElement` silently drops every subclass's own
   * styles and nothing type-checks it.
   */
  static sharedStyles: CSSResultGroup = css``;

  // Reset first, utilities last, with the component in between — the same order
  // `main.css` declares for the document, and for the same reason. Inside a
  // shadow root it has to be source order rather than `@layer`: component
  // styles are unlayered, and unlayered wins over every layer.
  static get styles(): CSSResultGroup {
    return [
      resetStyles,
      this.sharedStyles,
      this.componentStyles,
      utilityStyles,
    ];
  }
}

/**
 * Base for the page shells — `app-root` and every `views/*View.ts`. Renders
 * into the element itself instead of a shadow root, so the view stylesheets in
 * `styles/views/` can reach it.
 *
 * Extends `LitElement`, not `BaseElement`: Lit only adopts `static styles` into
 * a shadow root, so inheriting the reset and utilities here would claim
 * something untrue. The document's own `reset` and `utilities` layers cover
 * this DOM instead.
 */
export class LightElement extends LitElement {
  createRenderRoot() {
    return this;
  }
}
