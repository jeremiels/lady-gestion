import { html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
// The dashboard is the landing route, so it is imported statically — code
// splitting it would only add a round trip to the first paint. Every other view
// is pulled in by its route's `load()` below.
import './views/HomeView';
import { LightElement } from './commons/base-element.ts';
import { Router } from './commons/controllers/router.ts';
import { initData } from './data/index.ts';
import { initDoubleTapGuard } from './commons/double-tap-guard.ts';
import { initPwa } from './pwa/index.ts';
import { appHref } from './commons/base-path.ts';
import { isHorsePath, isLateral, SECTIONS } from './commons/sections.ts';
import './components/navigation/nav-bar.ts';
import './components/navigation/nav-item.ts';
import './components/app-icon/app-icon.ts';
import './components/app-update-toast/app-update-toast.ts';

type Route = {
  /** Matches a full pathname. */
  match: (path: string) => boolean;
  /** Appended before " · Ladympala.cc" in `document.title`. */
  title: string;
  /**
   * Pulls in the view's module before it is rendered. Omitted where the view is
   * imported statically above.
   *
   * Awaited by `Router` inside the `navigate` intercept handler, which is
   * already an async boundary — so route-level code splitting costs no
   * machinery here beyond this one field. The module registers its own element
   * via `@customElement` as a side effect, exactly as the static imports did.
   *
   * Every chunk is precached by the service worker, so this stays a local cache
   * read offline rather than a network hop.
   */
  load?: () => Promise<unknown>;
  /**
   * Receives the matched pathname, which is how a route with an id in it gets
   * that id to its view — nothing else parses the URL.
   */
  render: (path: string) => TemplateResult;
};

/** `/events/<id>`. Also how the view's id is sliced back off the path. */
const EVENT_DETAIL_PREFIX = '/events/';

/**
 * Where the `+` sits in the bar — between Calendrier and Documents.
 *
 * Named rather than an index into `SECTIONS`, because it is a composition
 * decision about the bar and not a property of any section. It is not a
 * destination: it opens the event sheet, so it has no route and nothing for the
 * Navigation API to intercept.
 */
const ADD_BUTTON_BEFORE = 'budget';

/**
 * The route table.
 *
 * A list rather than a `switch`, so adding `/events/:id` is a new entry with
 * its own matcher instead of another branch in a chain — and so the 404 below
 * can be a real miss rather than the `default:` case silently rendering the
 * dashboard under whatever URL the user actually asked for.
 */
const ROUTES: Route[] = [
  { match: (path) => path === '/', title: 'Accueil', render: () => html`<home-view></home-view>` },
  {
    match: (path) => path === '/events',
    title: 'Évènements',
    load: () => import('./views/EventsView.ts'),
    render: () => html`<events-view></events-view>`,
  },
  {
    // After the exact `/events` above, so the list keeps its own entry.
    match: (path) => path.startsWith(`${EVENT_DETAIL_PREFIX}`),
    title: 'Évènement',
    load: () => import('./views/EventDetailView.ts'),
    // `keyed` is load-bearing, not decoration: `LiveQuery` subscribes once in
    // `hostConnected` and re-runs only when Dexie writes, so going from one
    // event's page straight to another would reuse this element and leave the
    // previous event on screen. Keying by path builds a fresh one instead.
    // Wrapped in a template because `keyed` returns a directive result, and
    // every route here promises a TemplateResult.
    render: (path) => html`
      ${keyed(
        path,
        html`<event-detail-view
          .eventId=${path.slice(EVENT_DETAIL_PREFIX.length)}
        ></event-detail-view>`,
      )}
    `,
  },
  {
    // A drill-down from the dashboard's budget card, not a section of its
    // own — hence no nav item, and Accueil stays lit while it is open.
    match: (path) => path === '/budget',
    title: 'Dépenses',
    // The only route pulling `d3-shape` and `app-donut-chart`, and a drill-down
    // most sessions never open — the single most worthwhile split here.
    load: () => import('./views/BudgetView.ts'),
    render: () => html`<budget-view></budget-view>`,
  },
  {
    match: (path) => path === '/documents',
    title: 'Documents',
    load: () => import('./views/DocumentsView.ts'),
    render: () => html`<documents-view></documents-view>`,
  },
  {
    match: (path) => path === '/profile',
    title: 'Profil',
    load: () => import('./views/ProfileView.ts'),
    render: () => html`<profile-view></profile-view>`,
  },
  {
    // `/horse/<id>` is accepted but the id is deliberately ignored for now: the
    // app is single-horse and `HorseView` reads `horsesRepo.getActive()`. Wire
    // the id through before a second horse can exist.
    match: isHorsePath,
    title: 'Fiche du cheval',
    load: () => import('./views/HorseView.ts'),
    render: () => html`<horse-view></horse-view>`,
  },
];

/**
 * Shown for any path the table doesn't claim.
 *
 * Worth having rather than falling back to the dashboard: the service worker
 * answers every navigation with the cached shell, so a stale or mistyped deep
 * link resolves offline and would otherwise render the dashboard under a URL
 * that means something else entirely.
 */
const NOT_FOUND: Route = {
  match: () => true,
  title: 'Page introuvable',
  render: () => html`
    <section class="not-found">
      <hgroup class="section-group">
        <h1 class="section-title" tabindex="-1">Page introuvable</h1>
        <p class="section-subtitle">Cette page n’existe pas ou a été déplacée.</p>
      </hgroup>
      <a class="not-found__link pressable" href="${appHref('/')}">Retour à l’accueil</a>
    </section>
  `,
};

const matchRoute = (path: string): Route | undefined => ROUTES.find((route) => route.match(path));

@customElement('app-root')
export class AppRoot extends LightElement {
  /** Set when `initData()` rejects; replaces the whole view with an explanation. */
  @state() private dataError = '';

  @state() private eventSheetOpen = false;

  /**
   * False until the `+` is pressed for the first time.
   *
   * `event-sheet` is mounted in the shell so the `+` works from every route,
   * but it pulls in every form field — `app-input`, `app-select`,
   * `app-checkbox` and `FormControl` — roughly 10 kB gzip that no route
   * renders until someone actually opens it. Loading it on first use keeps it
   * off the first paint of every session that never adds an event. The chunk
   * is precached, so the wait is a cache read rather than a network hop.
   */
  @state() private eventSheetLoaded = false;

  /**
   * The Navigation API listener, the path, and the view transition around the
   * DOM swap. The route table stays here; the mechanics live in the controller.
   */
  readonly #router = new Router(this, {
    beforeRender: (path) => this.#prepareRoute(path),
    afterRender: () => this.#focusHeading(),
    // Tags home↔horse-view navigations so `transitions/horse.css` can give
    // `--horse-card` its shared-element morph only there, and let it ride the
    // plain route slide like the rest of the page for every other destination.
    extraTransitionTypes: (from, to) => [
      ...(isHorsePath(from) || isHorsePath(to) ? ['horse'] : []),
      ...(isLateral(from, to) ? ['lateral'] : []),
    ],
  });


  connectedCallback() {
    super.connectedCallback();

    // Opens the database, resolves the owner id and seeds first-run data.
    // Views subscribe through `LiveQuery`, so they fill in on their own once
    // this resolves — nothing here needs to block the first paint.
    //
    // A rejection is not recoverable and not rare: a full storage quota, Safari
    // in private browsing, a corrupted database or a failed schema upgrade all
    // land here. Without a UI the app renders permanently empty with only a
    // console line to explain it — the worst outcome for an app whose only copy
    // of the user's data is IndexedDB.
    initData().catch((error: unknown) => {
      console.error('Impossible d’initialiser la base de données locale', error);
      this.dataError = error instanceof Error ? error.message : String(error);
    });

    // Registers the service worker and asks the browser to stop treating the
    // IndexedDB data as evictable. No-op outside a production build.
    initPwa();

    // Belt and braces for the CSS `touch-action: manipulation` fix (see
    // `double-tap-guard.ts`): Safari doesn't always honour it across a shadow
    // boundary, which is what makes the residual double-tap zoom look random
    // and tied to component edges rather than to any one component.
    initDoubleTapGuard();

    // The route the app was *opened* on never goes through the Navigation API,
    // so nothing else would load its chunk — a cold deep link to /budget
    // would render an undefined element and show an empty page. Static imports
    // used to cover this for free; the split makes it explicit.
    void this.#prepareRoute(this.#router.path).then(() => this.requestUpdate());
  }

  /**
   * Everything that has to be true before a path can be rendered: its chunk
   * loaded, and the tab labelled. Runs inside the navigate handler, so the view
   * transition does not start until the view is defined.
   */
  async #prepareRoute(path: string) {
    const route = matchRoute(path) ?? NOT_FOUND;
    await route.load?.();
    document.title = `${route.title} · Ladympala.cc`;
  }


  render() {
    return html`
      <!-- Rendered from SECTIONS, so which item is lit and which section the
           route transition thinks the user is in are the same predicate. -->
      <nav-bar class="navigation">
        ${SECTIONS.map(
          (section) => html`
            ${section.id === ADD_BUTTON_BEFORE ? this.renderAddButton() : nothing}
            <nav-item
              href=${appHref(section.root)}
              label=${section.label}
              .icon=${section.icon}
              ?active=${section.matches(this.#router.path)}
            ></nav-item>
          `,
        )}
      </nav-bar>

      <main class="main-content">
        ${this.renderView()}
      </main>

      <!-- Mounted in the shell, not in a view: the + is in the nav bar, so the
           sheet has to be reachable from every route. Rendered only once its
           chunk has arrived — see eventSheetLoaded. -->
      ${this.eventSheetLoaded
        ? html`
            <event-sheet
              .open=${this.eventSheetOpen}
              @sheet-close=${this.closeEventSheet}
            ></event-sheet>
          `
        : nothing}

      <app-update-toast></app-update-toast>
    `;
  }

  /**
   * A button, not an anchor: this opens the event sheet rather than navigating,
   * so there is no URL for it and nothing for the Navigation API to intercept.
   * Its place in the bar is `ADD_BUTTON_BEFORE`.
   */
  private renderAddButton() {
    return html`
      <button
        class="nav-button pressable pressable--small"
        type="button"
        aria-label="Ajouter un évènement"
        aria-haspopup="dialog"
        aria-expanded=${this.eventSheetOpen ? 'true' : 'false'}
        @click=${this.openEventSheet}
      >
        <app-icon class="nav-button__icon" icon="plus"></app-icon>
      </button>
    `;
  }

  private openEventSheet = async () => {
    // Both flags land in the same update, so the sheet's first render already
    // has `open` — `ModalDialog.hostUpdated` calls `showModal()` from there and
    // the @starting-style entry animation plays as normal.
    if (!this.eventSheetLoaded) {
      await import('./components/event-sheet/event-sheet.ts');
      this.eventSheetLoaded = true;
    }
    this.eventSheetOpen = true;
  };

  private closeEventSheet = () => {
    this.eventSheetOpen = false;
  };

  /**
   * Moves focus to the new view's heading.
   *
   * A client-side navigation swaps the page's content but leaves focus on the
   * link that was clicked, so a screen reader announces nothing — this is what
   * a real page load would have done for free.
   *
   * Runs as the router's `afterRender`, so never on first render: the browser
   * has just done it itself, and stealing focus there would fight it. It is
   * also still *inside* the intercept handler, which matters — the Navigation
   * API's default `focusReset: "after-transition"` skips its own reset only
   * when focus moved during the navigation. Doing this afterwards would be
   * undone.
   */
  async #focusHeading() {
    // `app-root`'s own update only guarantees the view *element* exists; its
    // template has not rendered yet, so the heading is not in the DOM until the
    // child's own update settles.
    const view = this.querySelector('main')?.firstElementChild;
    // `instanceof` rather than a structural cast to `{ updateComplete?: ... }`:
    // every view here is a LitElement, and saying so lets the compiler check it
    // instead of being told to trust a shape nothing verifies.
    if (view instanceof LitElement) await view.updateComplete;

    this.querySelector<HTMLElement>('h1')?.focus();
  }

  private renderView() {
    if (this.dataError) return this.renderDataError();
    return (matchRoute(this.#router.path) ?? NOT_FOUND).render(this.#router.path);
  }

  /**
   * Shown instead of any view when the database could not be opened.
   *
   * Offers the backup import as the escape hatch, because that is the one
   * action that still works: `readBackupFile` opens its own transaction, so a
   * user whose database is corrupt can restore over it rather than being told
   * to clear their site data and lose everything.
   */
  private renderDataError() {
    return html`
      <section class="data-error">
        <hgroup class="section-group">
          <h1 class="section-title" tabindex="-1">Données inaccessibles</h1>
          <p class="section-subtitle">
            Le stockage local n’a pas pu être ouvert, donc rien ne peut être affiché.
          </p>
        </hgroup>

        <div class="container data-error__body">
          <p>
            Cela arrive quand l’espace de stockage est plein, en navigation privée, ou si la base
            locale a été endommagée.
          </p>
          <p class="data-error__hint">
            Essayez de libérer de l’espace puis de recharger. Si vous avez un fichier de sauvegarde,
            vous pouvez le restaurer depuis le profil une fois l’application rouverte.
          </p>
          <p class="data-error__detail">${this.dataError}</p>
        </div>

        <button class="data-error__button pressable" type="button" @click=${() => location.reload()}>
          Recharger
        </button>
      </section>
    `;
  }
}