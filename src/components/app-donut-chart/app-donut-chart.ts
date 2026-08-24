import { arc, pie, type PieArcDatum } from 'd3-shape';
import { css, html, nothing, svg, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { BaseElement } from '../../commons/base-element.ts';
import { MediaQuery } from '../../commons/controllers/media-query.ts';

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

const TAU = Math.PI * 2;

/**
 * All `arc()` reads off a datum. Typing the generator on this rather than on
 * `PieArcDatum` lets the same instance draw both a laid-out wedge and the plain
 * full ring of the empty state, with no cast in either direction.
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
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * The wedge layout, built once at module scope.
 *
 * It was constructed inside the render path, which runs on every animation
 * frame — sixty rebuilds a second of a generator whose configuration is two
 * fixed calls. Nothing about it depends on an instance.
 *
 * `.sort(null)` is load-bearing: d3 sorts by value by default, so a category
 * would move — and take its neighbours with it — the moment one expense was
 * added.
 */
const layout = pie<DonutSlice>()
  .value((slice) => slice.value)
  .sort(null);

/**
 * Compares slices by what is drawn rather than by array identity.
 *
 * The owning view maps its `ExpenseSlice[]` into `DonutSlice[]` inside
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
    return slice.id !== before?.id || slice.value !== before.value || slice.color !== before.color;
  });

/**
 * A donut chart that draws itself once, clockwise from the top.
 *
 * Presentational and domain-free: it takes values and colours and knows nothing
 * about events or money — the caller formats the centre figure through
 * `formatValue`.
 *
 * The geometry is d3-shape's. Only that submodule is a dependency, not `d3`:
 * `pie()` and `arc()` are the whole of what a donut needs, and the full bundle
 * would put scales, axes, geo and force into an offline precache to draw eight
 * wedges.
 */
@customElement('app-donut-chart')
export class AppDonutChart extends BaseElement {
  @property({ attribute: false, hasChanged: slicesChanged }) slices: DonutSlice[] = [];
  /** Small line above the figure, e.g. "Total". */
  @property({ type: String }) caption = '';
  /** Small line below it, e.g. "en janvier". */
  @property({ type: String }) note = '';
  /**
   * Formats the centre figure. Called on every frame with the value reached so
   * far — and on the last frame with the exact total, never a rounding of it.
   */
  @property({ attribute: false }) formatValue: (value: number) => string = String;

  /** 0 → 1 across the sweep. Starts settled so a static render is correct. */
  @state() private progress = 1;

  /**
   * Observed, not sampled: the global reduced-motion block in the reset only
   * reaches CSS transitions, so this animation has to check for itself — and a
   * bare `matchMedia(...).matches` would only ever be re-read when the data
   * happened to change.
   */
  #reducedMotion = new MediaQuery(this, '(prefers-reduced-motion: reduce)');

  #frame = 0;
  #startedAt = 0;
  /**
   * The laid-out wedges, rebuilt when `slices` changes rather than per frame.
   *
   * `layout()` depends only on the data, but it sat in the render path, which
   * the sweep re-enters sixty times a second — so every frame re-ran the pie
   * computation to arrive at the angles it had just discarded. Only the
   * clipping of each wedge to the advancing sweep actually varies per frame.
   */
  #wedges: PieArcDatum<DonutSlice>[] = [];
  /** Where the ring was when the current sweep began — 0 for a fresh draw, the
   *  interrupted position when a sweep was already running. */
  #from = 0;

  get #total(): number {
    return this.slices.reduce((total, slice) => total + slice.value, 0);
  }

  protected willUpdate(changed: PropertyValues<this>) {
    // Ahead of the reduced-motion return below, not after it: this is the cache
    // the render path reads, so a pass that skips it would draw the new totals
    // through the old angles.
    if (changed.has('slices')) this.#wedges = layout(this.slices);

    // Turning reduced motion on mid-sweep has to stop the sweep, not just
    // affect the next one — the controller re-renders us for exactly this.
    if (this.#reducedMotion.matches && this.#frame) {
      this.#cancel();
      this.progress = 1;
      return;
    }

    // Replays whenever the data changes, so switching period redraws the ring
    // rather than snapping to a new shape.
    if (changed.has('slices')) this.#restart();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // A component that starts a frame loop owns stopping it — the same rule
    // document-viewer follows for the object URL it mints.
    this.#cancel();
  }

  #restart() {
    // Read before `#cancel()` clears the frame handle: a running sweep is
    // retargeted from wherever the eye last saw the ring, the same way a CSS
    // transition retargets mid-flight, while a settled ring redraws in full.
    const from = this.#frame ? this.progress : 0;

    this.#cancel();

    if (this.#total <= 0 || this.#reducedMotion.matches) {
      this.progress = 1;
      return;
    }

    this.#from = from;
    this.progress = from;
    this.#startedAt = 0;
    this.#frame = requestAnimationFrame(this.#tick);
  }

  #cancel() {
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  #tick = (now: number) => {
    this.#startedAt ||= now;

    // The remaining distance gets the remaining share of the sweep, so an
    // interrupted ring finishes in proportion instead of spending another full
    // second on the last sliver. `|| 1` guards the divide when a sweep is
    // interrupted on its very last frame.
    const duration = SWEEP_MS * (1 - this.#from) || 1;
    const elapsed = Math.min((now - this.#startedAt) / duration, 1);
    this.progress = this.#from + (1 - this.#from) * easeInOutCubic(elapsed);

    if (elapsed < 1) this.#frame = requestAnimationFrame(this.#tick);
    else this.#frame = 0;
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
    const total = this.#total;
    const wedge = arc<Ring>()
      .innerRadius(RADIUS * INNER_RATIO)
      .outerRadius(RADIUS);

    return html`
      <div class="donut">
        <svg
          viewBox="${-RADIUS} ${-RADIUS} ${RADIUS * 2} ${RADIUS * 2}"
          role="img"
          aria-label=${this.#description(total)}
        >
          <!-- svg\`\`, not html\`\`: a nested template is parsed on its own, and
               in HTML context a path element comes out as an unknown HTML
               element in the wrong namespace. It then has a valid d attribute,
               inherits the right fill, and draws nothing at all. -->
          ${total <= 0
            ? svg`<path class="donut__track" d=${wedge({ startAngle: 0, endAngle: TAU }) ?? ''}></path>`
            : this.#renderWedges(wedge)}
        </svg>

        <div class="donut__center" aria-hidden="true">
          ${this.caption ? html`<span class="donut__caption">${this.caption}</span>` : nothing}
          <span class="donut__value"
            >${this.formatValue(this.progress === 1 ? total : total * this.progress)}</span
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

    return this.#wedges.flatMap((datum) => {
      if (datum.startAngle >= sweep) return [];

      const path = wedge({ ...datum, endAngle: Math.min(datum.endAngle, sweep) });
      if (!path) return [];

      // Inline style, not a fill attribute: the colours are custom properties,
      // and that is where var() resolves reliably inside SVG.
      return [svg`<path d=${path} style=${styleMap({ fill: datum.data.color })}></path>`];
    });
  }

  /** The SVG's accessible name — the legend beside it repeats this as text. */
  #description(total: number): string {
    if (total <= 0) return 'Aucune dépense sur cette période';

    const parts = this.slices.map(
      (slice) => `${slice.label} ${Math.round((slice.value / total) * 100)} %`,
    );
    return `Répartition : ${parts.join(', ')}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-donut-chart': AppDonutChart;
  }
}



