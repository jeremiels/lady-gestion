import { arc, pie } from "d3-shape";
import { css, html, nothing, svg, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { BaseElement } from "../../commons/base-element.ts";
import { MediaQuery } from "../../commons/controllers/media-query.ts";

export type DonutSlice = {
  id: string;
  /** Read out in the chart's accessible description. */
  label: string;
  value: number;
  /** Any CSS colour, including a `var(--token)`. */
  color: string;
};

/** Radius in user units. The SVG scales to its box; only the ratio matters. */
const RADIUS = 100;
/** The design's ring thickness — a little over a third of the radius. */
const INNER_RATIO = 0.64;

/**
 * How long the ring takes to draw itself.
 *
 * A module const rather than a motion token: the tokens in `tokens/motion.css`
 * are all sub-400ms interaction feedback (a chip filling, a thumb sliding), and
 * an entrance animation sharing that scale would be over before it was seen.
 */
const SWEEP_MS = 1000;

/**
 * How long the ring takes to redistribute itself when a slice is hidden or
 * shown again.
 *
 * Much shorter than the sweep, because this one *is* interaction feedback — it
 * answers a tap and has to feel like it. Still above the token scale: the
 * wedges travel a long way round the ring, and 200ms of that reads as a jump
 * rather than as a redistribution.
 */
const TOGGLE_MS = 420;

const TAU = Math.PI * 2;

/**
 * Below this, a wedge is not worth a DOM node.
 *
 * The ring renders at roughly 272px across, so one device pixel at the outer
 * edge is about 0.007rad — two orders of magnitude above this. Anything under
 * it is a wedge that a toggle has closed, or one d3 laid out at zero width.
 */
const EPSILON = 1e-4;

/**
 * All `arc()` reads off a datum. Typing the generator on this rather than on
 * `PieArcDatum` lets the same instance draw a laid-out wedge, an interpolated
 * one and the plain full ring of the empty state, with no cast in any
 * direction.
 */
type Ring = { startAngle: number; endAngle: number };

/**
 * Accelerates in, coasts, decelerates out — a hand sweeping round a dial.
 *
 * Deliberately not a plain ease-out, which spends a third of the ring in its
 * first eighth of the time: the segments the sweep passes early would flash by
 * while the last one crawled. The near-linear middle here is what gives each
 * segment roughly its own share of the second.
 */
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

/**
 * Decelerates only — the shape of `--easing-out`, which is what the rest of the
 * app uses for a direct response to a press.
 *
 * The toggle morph should leave under the finger and settle, not wind up first:
 * an ease-in-out here reads as the ring hesitating before it obeys.
 */
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/**
 * The wedge layout, built once at module scope.
 *
 * It was constructed inside the render path, which runs on every animation
 * frame — sixty rebuilds a second of a generator whose configuration is two
 * fixed calls. Nothing about it depends on an instance.
 *
 * Laid out over plain numbers rather than over slices: a hidden slice is laid
 * out at a value of zero, so what goes in is a masked copy of the values and
 * never the slices themselves. The colours are read back by index instead.
 *
 * `.sort(null)` is load-bearing: d3 sorts by value by default, so a category
 * would move — and take its neighbours with it — the moment one budget was
 * added, or the moment one was hidden and its value went to zero.
 */
const layout = pie<number>()
  .value((value) => value)
  .sort(null);

/**
 * Compares slices by what is drawn rather than by array identity.
 *
 * The owning view maps its `BudgetSlice[]` into `DonutSlice[]` inside
 * `render()`, so the property receives a freshly built array every time the
 * view updates for any reason at all. Under Lit's default `!==` check that
 * counted as a data change and replayed the whole one-second sweep — on
 * switching period and back, and on any unrelated write that re-fired the
 * view's `LiveQuery`. The ring should redraw when the numbers move, which is
 * what this compares.
 */
const slicesChanged = (next: DonutSlice[] = [], previous: DonutSlice[] = []) =>
  next.length !== previous.length ||
  next.some((slice, index) => {
    const before = previous[index];
    return (
      slice.id !== before?.id ||
      slice.value !== before.value ||
      slice.color !== before.color
    );
  });

/**
 * The same problem for the hidden set, and the same answer.
 *
 * Order-insensitive on purpose: this is a set that happens to be carried in an
 * array, and the caller toggling ids in and out of it has no reason to keep a
 * stable order. At nine categories the quadratic scan is free.
 */
const hiddenChanged = (next: string[] = [], previous: string[] = []) =>
  next.length !== previous.length || next.some((id) => !previous.includes(id));

/**
 * A donut chart that draws itself once, clockwise from the top, and
 * redistributes itself when slices are hidden or shown again.
 *
 * Presentational and domain-free: it takes values, colours and a set of ids to
 * leave out, and knows nothing about events or money — the caller formats the
 * centre figure through `formatValue` and owns what "hidden" means.
 *
 * The geometry is d3-shape's. Only that submodule is a dependency, not `d3`:
 * `pie()` and `arc()` are the whole of what a donut needs, and the full bundle
 * would put scales, axes, geo and force into an offline precache to draw eight
 * wedges.
 */
@customElement("app-donut-chart")
export class AppDonutChart extends BaseElement {
  @property({ attribute: false, hasChanged: slicesChanged })
  slices: DonutSlice[] = [];
  /**
   * Slice ids left out of the ring and out of the centre total.
   *
   * The hidden slices stay in `slices` rather than being filtered out by the
   * caller — the chart needs them to animate their own collapse, and to grow
   * them back from where they will end up.
   */
  @property({ attribute: false, hasChanged: hiddenChanged })
  hiddenIds: string[] = [];
  /** Small line above the figure, e.g. "Total". */
  @property({ type: String }) caption = "";
  /** Small line below it, e.g. "en janvier". */
  @property({ type: String }) note = "";
  /**
   * Formats the centre figure. Called on every frame with the value reached so
   * far — and on the last frame with the exact total, never a rounding of it.
   */
  @property({ attribute: false }) formatValue: (value: number) => string =
    String;

  /** 0 → 1 across the entrance sweep. Starts settled so a static render is correct. */
  @state() private progress = 1;
  /** 0 → 1 across a hide/show redistribution. Settled for the same reason. */
  @state() private morph = 1;

  /**
   * Observed, not sampled: the global reduced-motion block in the reset only
   * reaches CSS transitions, so this animation has to check for itself — and a
   * bare `matchMedia(...).matches` would only ever be re-read when the data
   * happened to change.
   */
  #reducedMotion = new MediaQuery(this, "(prefers-reduced-motion: reduce)");

  /**
   * One frame handle for both clocks.
   *
   * The sweep clips every wedge against an advancing angle; the morph moves the
   * angles themselves. They are orthogonal and can legitimately overlap — a tap
   * on the legend while the ring is still drawing itself — so they share a loop
   * rather than racing two of them.
   */
  #frame = 0;

  #sweepStartedAt = 0;
  /** Where the ring was when the current sweep began — 0 for a fresh draw, the
   *  interrupted position when a sweep was already running. */
  #sweepFrom = 0;

  #morphStartedAt = 0;
  /**
   * The wedge angles the current morph runs between, one entry per slice —
   * hidden ones included, at zero width, so the two arrays and `slices` share
   * an index.
   *
   * Rebuilt when the data or the hidden set changes rather than per frame:
   * `layout()` depends only on those, but it sat in the render path, which the
   * animation re-enters sixty times a second.
   */
  #fromAngles: Ring[] = [];
  #toAngles: Ring[] = [];
  #fromTotal = 0;
  #toTotal = 0;

  #isHidden(id: string): boolean {
    return this.hiddenIds.includes(id);
  }

  /** What the ring adds up to once everything has settled. */
  get #total(): number {
    return this.slices.reduce(
      (total, slice) => total + (this.#isHidden(slice.id) ? 0 : slice.value),
      0,
    );
  }

  /**
   * Where every wedge is at this instant.
   *
   * Interpolating the *boundaries* is what makes the whole thing work. A ring is
   * a partition of the circle, so each boundary belongs to two neighbours at
   * once; because `end` of one wedge and `start` of the next hold the same
   * number in both layouts, lerping them separately still yields the same
   * number — the ring stays exactly contiguous on every frame, with no gap to
   * show through and no overlap to darken a seam.
   *
   * It also gives the motion the caller asked for, for free. A wedge being
   * hidden closes onto the boundary its neighbours form once it is gone, and
   * that point always falls *inside* the wedge's own span: for a wedge of value
   * `v` after a prefix `P` of a total `S`, it spans `[τP/S, τ(P+v)/S]` and closes
   * on `τP/(S−v)`, which sits between them because `P + v ≤ S`. So both edges
   * travel inwards — the wedge shrinks onto itself rather than being wiped from
   * one side — and, run backwards, a wedge being shown grows outwards from a
   * point inside where it is about to land.
   */
  #currentAngles(): Ring[] {
    if (this.morph === 1) return this.#toAngles;

    const t = easeOutCubic(this.morph);
    return this.#toAngles.map((to, index) => {
      const from = this.#fromAngles[index] ?? to;
      return {
        startAngle: lerp(from.startAngle, to.startAngle, t),
        endAngle: lerp(from.endAngle, to.endAngle, t),
      };
    });
  }

  /** The centre figure's value at this instant, counting between two totals. */
  #currentTotal(): number {
    return this.morph === 1
      ? this.#toTotal
      : lerp(this.#fromTotal, this.#toTotal, easeOutCubic(this.morph));
  }

  /**
   * Points the morph at the layout the current data and hidden set imply.
   *
   * @param dataChanged The slices themselves moved, so there is nothing to morph
   *   between — the sweep is about to redraw the ring from nothing.
   */
  #relayout(dataChanged: boolean) {
    const values = this.slices.map((slice) =>
      this.#isHidden(slice.id) ? 0 : slice.value,
    );
    const total = values.reduce((sum, value) => sum + value, 0);

    // Both read before the targets move under them: a morph interrupted halfway
    // restarts from what the eye can actually see, the same way the sweep
    // retargets, rather than snapping back to where the last one began.
    const from = dataChanged ? [] : this.#currentAngles();
    const fromTotal = dataChanged ? total : this.#currentTotal();

    this.#toAngles = layout(values);

    // d3 scales its angles by `1 / sum` and guards a sum of zero with a factor
    // of zero, so every wedge of an all-hidden ring is laid out at angle 0 —
    // and the last category standing would unwind anticlockwise to twelve
    // o'clock instead of closing where it sits. Nothing is drawn in that state,
    // so contiguity has nothing left to protect: close each wedge onto its own
    // midpoint instead, which is the same motion as every other collapse.
    if (total <= 0 && from.length === this.slices.length) {
      this.#toAngles = from.map(({ startAngle, endAngle }) => {
        const middle = (startAngle + endAngle) / 2;
        return { startAngle: middle, endAngle: middle };
      });
    }

    // A length mismatch means there is nothing to morph from — a first render,
    // or a data change that replaced every wedge.
    this.#fromAngles =
      from.length === this.#toAngles.length ? from : this.#toAngles;
    this.#fromTotal = fromTotal;
    this.#toTotal = total;
  }

  protected willUpdate(changed: PropertyValues<this>) {
    const dataChanged = changed.has("slices");
    const hiddenSetChanged = changed.has("hiddenIds");

    // Ahead of the reduced-motion return below, not after it: this is the cache
    // the render path reads, so a pass that skips it would draw the new totals
    // through the old angles.
    if (dataChanged || hiddenSetChanged) this.#relayout(dataChanged);

    // Turning reduced motion on mid-animation has to stop it, not just affect
    // the next one — the controller re-renders us for exactly this.
    if (this.#reducedMotion.matches) {
      this.#cancel();
      this.progress = 1;
      this.morph = 1;
      return;
    }

    if (dataChanged) {
      // The sweep redraws every wedge from nothing, so a morph underneath it
      // would be an animation nobody can see. `#relayout` has already settled
      // the angles on the new layout.
      this.morph = 1;
      this.#restartSweep();
      return;
    }

    if (hiddenSetChanged) this.#restartMorph();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // A component that starts a frame loop owns stopping it — the same rule
    // document-viewer follows for the object URL it mints.
    this.#cancel();
  }

  /**
   * Replays the sweep, so switching period redraws the ring rather than
   * snapping to a new shape.
   */
  #restartSweep() {
    // `progress`, not the frame handle: the handle is shared with the morph
    // now that both clocks run off one loop, so a morph in flight would
    // otherwise look like an interrupted sweep. A running sweep is retargeted
    // from wherever the eye last saw the ring, the way a CSS transition
    // retargets mid-flight; a settled ring redraws in full.
    const from = this.progress < 1 ? this.progress : 0;

    if (this.#total <= 0) {
      this.progress = 1;
      return;
    }

    this.#sweepFrom = from;
    this.progress = from;
    this.#sweepStartedAt = 0;
    this.#schedule();
  }

  /**
   * Runs the redistribution `#relayout` has just set up.
   *
   * Not gated on the total the way the sweep is: hiding the last visible
   * category leaves nothing to draw, and watching it close is the whole point.
   */
  #restartMorph() {
    this.#morphStartedAt = 0;
    this.morph = 0;
    this.#schedule();
  }

  /** Starts the shared loop unless it is already running. */
  #schedule() {
    if (!this.#frame) this.#frame = requestAnimationFrame(this.#tick);
  }

  #cancel() {
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  #tick = (now: number) => {
    this.#frame = 0;

    if (this.progress < 1) {
      this.#sweepStartedAt ||= now;

      // The remaining distance gets the remaining share of the sweep, so an
      // interrupted ring finishes in proportion instead of spending another full
      // second on the last sliver. `|| 1` guards the divide when a sweep is
      // interrupted on its very last frame.
      const duration = SWEEP_MS * (1 - this.#sweepFrom) || 1;
      const elapsed = Math.min((now - this.#sweepStartedAt) / duration, 1);

      // Assigned rather than computed on the last frame: `from + (1 - from)` is
      // not reliably 1 in binary floating point, and both the loop's exit test
      // and the exact-total guard in `render()` compare against exactly 1.
      this.progress =
        elapsed < 1
          ? this.#sweepFrom + (1 - this.#sweepFrom) * easeInOutCubic(elapsed)
          : 1;
    }

    if (this.morph < 1) {
      this.#morphStartedAt ||= now;
      this.morph = Math.min((now - this.#morphStartedAt) / TOGGLE_MS, 1);
    }

    if (this.progress < 1 || this.morph < 1) this.#schedule();
  };

  static componentStyles = css`
    :host {
      display: block;
    }

    .donut {
      position: relative;
      width: 100%;
      max-width: 17rem;
      margin-inline: auto;
      aspect-ratio: 1;
    }

    svg {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
    }

    /* Centred on the hole rather than on the box, so an odd number of text
       lines still reads as balanced inside the ring. */
    .donut__center {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2);
      pointer-events: none;
      text-align: center;
    }

    .donut__caption,
    .donut__note {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-brown-light);
    }

    .donut__value {
      font-size: 1.5rem;
      line-height: 1.75rem;
      font-weight: 700;
      color: var(--color-dark);
      /* The count-up changes width every frame; tabular figures keep it from
         jittering the two lines around it. */
      font-variant-numeric: tabular-nums;
    }

    .donut__track {
      fill: var(--color-brown-light-bg);
    }
  `;

  render() {
    const shown = this.#currentTotal();
    const wedge = arc<Ring>()
      .innerRadius(RADIUS * INNER_RATIO)
      .outerRadius(RADIUS);

    // The track sits *behind* the wedges rather than instead of them. While one
    // category is still visible `pie()` normalises over what is left, so the
    // wedges cover the whole ring and the track never shows; it is revealed as
    // the last one closes, which is what keeps that transition from cutting
    // between two unrelated pictures. Held back during the entrance sweep so
    // the ring still draws itself onto nothing, the way it always has.
    const track = this.progress === 1 || this.#total <= 0;

    return html`
      <div class="donut">
        <svg
          viewBox="${-RADIUS} ${-RADIUS} ${RADIUS * 2} ${RADIUS * 2}"
          role="img"
          aria-label=${this.#description()}
        >
          <!-- svg\`\`, not html\`\`: a nested template is parsed on its own, and
               in HTML context a path element comes out as an unknown HTML
               element in the wrong namespace. It then has a valid d attribute,
               inherits the right fill, and draws nothing at all. -->
          ${
            track
              ? svg`<path class="donut__track" d=${wedge({ startAngle: 0, endAngle: TAU }) ?? ""}></path>`
              : nothing
          }
          ${this.#renderWedges(wedge)}
        </svg>

        <div class="donut__center" aria-hidden="true">
          ${this.caption ? html`<span class="donut__caption">${this.caption}</span>` : nothing}
          <span class="donut__value"
            >${this.formatValue(this.progress === 1 ? shown : shown * this.progress)}</span
          >
          ${this.note ? html`<span class="donut__note">${this.note}</span>` : nothing}
        </div>
      </div>
    `;
  }

  /**
   * One continuous sweep rather than a stagger per segment.
   *
   * Every wedge is clipped to the same advancing angle, so a segment appears as
   * the sweep reaches it and the next one starts from exactly where it stopped.
   * Animating each segment on its own delay gives the same rough effect with a
   * visible seam wherever two timings meet.
   */
  #renderWedges(wedge: ReturnType<typeof arc<Ring>>) {
    const sweep = this.progress * TAU;
    const angles = this.#currentAngles();

    return this.slices.flatMap((slice, index) => {
      const ring = angles[index];
      if (!ring) return [];

      // Closed by a toggle, or laid out at zero width to begin with. Dropped
      // rather than drawn, so a hidden category leaves no degenerate path node
      // behind for a hit test or a screenshot to find.
      if (ring.endAngle - ring.startAngle < EPSILON) return [];
      // Not yet reached by the entrance sweep.
      if (ring.startAngle >= sweep) return [];

      const path = wedge({
        startAngle: ring.startAngle,
        endAngle: Math.min(ring.endAngle, sweep),
      });
      if (!path) return [];

      // Inline style, not a fill attribute: the colours are custom properties,
      // and that is where var() resolves reliably inside SVG.
      return [
        svg`<path d=${path} style=${styleMap({ fill: slice.color })}></path>`,
      ];
    });
  }

  /** The SVG's accessible name — the legend beside it repeats this as text. */
  #description(): string {
    const total = this.#total;

    if (total <= 0) {
      // Told apart on purpose: a period with nothing in it and a period whose
      // every category has been switched off read the same to a screen reader
      // otherwise, and only one of them is fixed by tapping the legend.
      return this.slices.length > 0
        ? "Aucune catégorie affichée"
        : "Aucune dépense sur cette période";
    }

    const parts = this.slices
      .filter((slice) => !this.#isHidden(slice.id))
      .map(
        (slice) =>
          `${slice.label} ${Math.round((slice.value / total) * 100)} %`,
      );
    return `Répartition : ${parts.join(", ")}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-donut-chart": AppDonutChart;
  }
}
