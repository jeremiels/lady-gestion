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
import { initPwa } from './pwa/index.ts';
import type { IconName } from './components/app-icon/icons.ts';
import { appHref } from './commons/base-path.ts';
import './components/navigation/nav-bar.ts';
import './components/navigation/nav-item.ts';
import './components/app-icon/app-icon.ts';
import './components/app-update-toast/app-update-toast.ts';

type Route = {
  /** Matches a full pathname. */
  match: (path: string) => boolean;
  /** Appended before " · Lady Gestion" in `document.title`. */
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
 * `/horse` and `/horse/<id>`. Pulled out of the route's own `match` so the
 * `horse` view-transition type below can reuse the exact same check rather
 * than drifting out of sync with it.
 */
const isHorsePath = (path: string): boolean => path === '/horse' || path.startsWith('/horse/');

/** One of the four destinations the bottom nav offers. */
type Section = {
  id: string;
  /** The nav item's link, and the section's root path. */
  href: string;
  label: string;
  icon: IconName;
  /**
   * Every path that belongs to this section — including its drill-downs, which
   * have no nav item of their own and must not unlight the one they came from.
   */
  matches: (path: string) => boolean;
};

/**
 * The bottom nav, and the app's only definition of what a section contains.
 *
 * The `matches` predicates answer one question — "which section is the user
 * in?" — that two callers need: the nav bar, to decide which item is lit, and
 * the route transition below, to tell a sideways move from a drill-down. Those
 * two used to answer it separately, and a comment on the second claimed the two
 * agreed. They did not: `/horse` counted as `home` for the transition while the
 * Accueil item stayed dark. One table, one answer, no way to drift.
 */
const SECTIONS: Section[] = [
  {
    id: 'home',
    href: appHref('/'),
    label: 'Accueil',
    icon: 'home',
    // `/expenses` and the horse's page are drill-downs from the dashboard, not
    // sections of their own — an unlit bar there would say otherwise.
    matches: (path) => path === '/' || path === '/expenses' || isHorsePath(path),
  },
  {
    id: 'events',
    href: appHref('/events'),
    label: 'Calendrier',
    icon: 'date',
    // A prefix match: an event's own page is still the Calendrier section.
    matches: (path) => path.startsWith('/events'),
  },
  {
    id: 'documents',
    href: appHref('/documents'),
    label: 'Documents',
    icon: 'folder',
    matches: (path) => path === '/documents',
  },
  {
    id: 'profile',
    href: appHref('/profile'),
    label: 'Profil',
    icon: 'user',
    matches: (path) => path === '/profile',
  },
];

/**
 * Where the `+` sits in the bar — between Calendrier and Documents.
 *
 * Named rather than an index into the list above, because it is a composition
 * decision about the bar and not a property of any section. It is not a
 * destination: it opens the event sheet, so it has no route and nothing for the
 * Navigation API to intercept.
 */
const ADD_BUTTON_BEFORE = 'documents';

/** The section a path belongs to, or `undefined` for a path in none (the 404). */
const sectionOf = (path: string): Section | undefined =>
  SECTIONS.find((section) => section.matches(path));

/**
 * A sideways move: out of one section and onto the root of another.
 *
 * The "onto a root" half matters as much as the section comparison. Leaving
 * `/profile` for `/events/<id>` via a deep link changes section but still lands
 * a level down, and should still push.
 */
const isLateral = (from: string, to: string): boolean => {
  const fromSection = sectionOf(from);
  const toSection = sectionOf(to);

  return (
    SECTIONS.some((section) => section.href === to) &&
    fromSection !== undefined &&
    toSection !== undefined &&
    fromSection !== toSection
  );
};

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
    // A drill-down from the dashboard's expenses card, not a section of its
    // own — hence no nav item, and Accueil stays lit while it is open.
    match: (path) => path === '/expenses',
    title: 'Dépenses',
    // The only route pulling `d3-shape` and `app-donut-chart`, and a drill-down
    // most sessions never open — the single most worthwhile split here.
    load: () => import('./views/ExpensesView.ts'),
    render: () => html`<expenses-view></expenses-view>`,
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
    // Tags home↔horse-view navigations so `main.css` can give `--horse-card`
    // its shared-element morph only there, and let it ride the plain route
    // slide like the rest of the page for every other destination.
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

    // The route the app was *opened* on never goes through the Navigation API,
    // so nothing else would load its chunk — a cold deep link to /expenses
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
    document.title = `${route.title} · Lady Gestion`;
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
              href=${section.href}
              label=${section.label}
              icon=${section.icon}
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