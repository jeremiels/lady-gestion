import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
// The dashboard is the landing route, so it is imported statically — code
// splitting it would only add a round trip to the first paint. Every other view
// is pulled in by its route's `load()` below.
import "./views/HomeView";
import { LightElement } from "./commons/base-element.ts";
import { Router } from "./commons/controllers/router.ts";
import {
  horsesRepo,
  initData,
  LiveQuery,
  watchDatabase,
} from "./data/index.ts";
import { BackupActions } from "./commons/backup-actions.ts";
import { initDoubleTapGuard } from "./commons/double-tap-guard.ts";
import { initPwa } from "./pwa/index.ts";
import { appHref } from "./commons/base-path.ts";
import {
  customizeRouteOf,
  customizeTransitionType,
  horsePath,
  horseRouteOf,
  horseTransitionType,
  isLateral,
  SECTIONS,
  type Section,
} from "./commons/sections.ts";
import "./components/navigation/nav-bar.ts";
import "./components/navigation/nav-item.ts";
import "./components/app-icon/app-icon.ts";
import "./components/app-update-toast/app-update-toast.ts";

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

/** `/posts/<id>`. Also how the view's id is sliced back off the path. */
const POST_DETAIL_PREFIX = "/posts/";

/**
 * Where the `+` sits in the bar — between Activités and Budget.
 *
 * Named rather than an index into `SECTIONS`, because it is a composition
 * decision about the bar and not a property of any section. It is not a
 * destination: it opens the event sheet, so it has no route and nothing for the
 * Navigation API to intercept.
 */
const ADD_BUTTON_BEFORE = "budget";

/** The one section whose nav link is per-horse — see `#sectionHref`. */
const HORSE_SECTION = "horses";

/**
 * The route table.
 *
 * A list rather than a `switch`, so adding `/posts/:id` is a new entry with
 * its own matcher instead of another branch in a chain — and so the 404 below
 * can be a real miss rather than the `default:` case silently rendering the
 * dashboard under whatever URL the user actually asked for.
 */
const ROUTES: Route[] = [
  {
    match: (path) => path === "/",
    title: "Accueil",
    render: () => html`<home-view></home-view>`,
  },
  {
    match: (path) => path === "/posts",
    title: "Évènements",
    load: () => import("./views/PostsView.ts"),
    render: () => html`<posts-view></posts-view>`,
  },
  {
    // After the exact `/posts` above, so the list keeps its own entry.
    match: (path) => path.startsWith(`${POST_DETAIL_PREFIX}`),
    title: "Évènement",
    load: () => import("./views/PostDetailView.ts"),
    // `keyed` is load-bearing, not decoration: `LiveQuery` subscribes once in
    // `hostConnected` and re-runs only when Dexie writes, so going from one
    // event's page straight to another would reuse this element and leave the
    // previous event on screen. Keying by path builds a fresh one instead.
    // Wrapped in a template because `keyed` returns a directive result, and
    // every route here promises a TemplateResult.
    render: (path) => html`
      ${keyed(
        path,
        html`<post-detail-view
          .postId=${path.slice(POST_DETAIL_PREFIX.length)}
        ></post-detail-view>`,
      )}
    `,
  },
  {
    // Its own section in the bar; the dashboard's budget card is a second way
    // in.
    match: (path) => path === "/budget",
    title: "Dépenses",
    // The only route pulling `d3-shape` and `app-donut-chart`, and a page most
    // sessions never open — the single most worthwhile split here.
    load: () => import("./views/BudgetView.ts"),
    render: () => html`<budget-view></budget-view>`,
  },
  {
    match: (path) => path === "/documents",
    title: "Documents",
    load: () => import("./views/DocumentsView.ts"),
    render: () => html`<documents-view></documents-view>`,
  },
  {
    match: (path) => path === "/profile",
    title: "Profil",
    load: () => import("./views/ProfileView.ts"),
    render: () => html`<profile-view></profile-view>`,
  },
  {
    // `/profile/interface` and `/profile/interface/<tab>`; an unknown tab falls
    // through to the 404. Not `keyed`, like the horse page: switching tabs
    // keeps the same element and its queries.
    match: (path) => customizeRouteOf(path) !== null,
    title: "Personnaliser mon interface",
    load: () => import("./views/CustomizeView.ts"),
    render: (path) =>
      html`<customize-view
        .tab=${customizeRouteOf(path)!.tab}
      ></customize-view>`,
  },
  {
    // `/horse`, `/horse/<id>` and `/horse/<id>/<tab>`; an unknown tab falls
    // through to the 404. The bare `/horse` is reachable because the nav item
    // renders it until the active horse has resolved. The id only builds the
    // sub-nav's links for now: the app is single-horse and `HorseView` reads
    // `horsesRepo.getActive()`. Wire it through to the data before a second
    // horse can exist.
    //
    // Deliberately not `keyed`: switching tabs keeps the same element, so its
    // `LiveQuery`s stay subscribed and the cover is not rebuilt. Key on the id
    // alone once it selects the horse.
    match: (path) => horseRouteOf(path) !== null,
    title: "Fiche du cheval",
    load: () => import("./views/HorseView.ts"),
    render: (path) => {
      const route = horseRouteOf(path)!;
      return html`<horse-view
        .horseId=${route.horseId}
        .tab=${route.tab}
      ></horse-view>`;
    },
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
  title: "Page introuvable",
  render: () => html`
    <section class="not-found">
      <hgroup class="section-group">
        <h1 class="section-title" tabindex="-1">Page introuvable</h1>
        <p class="section-subtitle">
          Cette page n’existe pas ou a été déplacée.
        </p>
      </hgroup>
      <a class="not-found__link pressable" href="${appHref("/")}"
        >Retour à l’accueil</a
      >
    </section>
  `,
};

const matchRoute = (path: string): Route | undefined =>
  ROUTES.find((route) => route.match(path));

@customElement("app-root")
export class AppRoot extends LightElement {
  /** Set when `initData()` rejects; replaces the whole view with an explanation. */
  @state() private dataError = "";

  /**
   * Another tab or window holds this database across a schema bump — see
   * `watchDatabase`. `superseded` is terminal; `blocked` clears once
   * `initData()` gets past `db.open()`.
   */
  @state() private databaseNotice: "blocked" | "superseded" | null = null;

  /**
   * Export and restore on the data-error screen. It stays up after a restore,
   * and the app behind it only reopens on a reload — hence the extra line.
   */
  #recovery = new BackupActions(this, {
    afterRestore: "Rechargez pour rouvrir l’application.",
  });

  @state() private postSheetOpen = false;

  /**
   * False until the `+` is pressed for the first time.
   *
   * `post-sheet` is mounted in the shell so the `+` works from every route,
   * but it pulls in every form field — `app-input`, `app-select`,
   * `app-checkbox` and `FormControl` — roughly 10 kB gzip that no route
   * renders until someone actually opens it. Loading it on first use keeps it
   * off the first paint of every session that never adds an event. The chunk
   * is precached, so the wait is a cache read rather than a network hop.
   */
  @state() private postSheetLoaded = false;

  /**
   * The active horse, for the Cheval nav item's link alone — the shell renders
   * nothing else of it. See `#sectionHref`.
   */
  #activeHorse = new LiveQuery(this, () => horsesRepo.getActive());

  /**
   * The Navigation API listener, the path, and the view transition around the
   * DOM swap. The route table stays here; the mechanics live in the controller.
   */
  readonly #router = new Router(this, {
    beforeRender: (path) => this.#prepareRoute(path),
    afterRender: () => this.#focusHeading(),
    // `horse` on home↔horse-view, so `transitions/horse.css` can give
    // `--horse-card` its shared-element morph only there; `horse-subpage`
    // between two of its tabs, where the cover and sub-nav stay put.
    extraTransitionTypes: (from, to) => {
      const horse = horseTransitionType(from, to);
      const customize = customizeTransitionType(from, to);
      return [
        ...(horse ? [horse] : []),
        ...(customize ? [customize] : []),
        ...(isLateral(from, to) ? ["lateral"] : []),
      ];
    },
  });

  connectedCallback() {
    super.connectedCallback();

    // Before `initData()`, whose `db.open()` is where a block is reported.
    watchDatabase({
      blocked: () => {
        this.databaseNotice ??= "blocked";
      },
      superseded: () => {
        this.databaseNotice = "superseded";
      },
    });

    // Opens the database, resolves the owner id and seeds first-run data.
    // Views subscribe through `LiveQuery`, so they fill in on their own once
    // this resolves — nothing here needs to block the first paint.
    //
    // A rejection is not recoverable and not rare: a full storage quota, Safari
    // in private browsing, a corrupted database or a failed schema upgrade all
    // land here. Without a UI the app renders permanently empty with only a
    // console line to explain it — the worst outcome for an app whose only copy
    // of the user's data is IndexedDB.
    initData()
      .then(() => {
        if (this.databaseNotice === "blocked") this.databaseNotice = null;
      })
      .catch((error: unknown) => {
        console.error(
          "Impossible d’initialiser la base de données locale",
          error,
        );
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
              href=${appHref(this.#sectionHref(section))}
              label=${section.label}
              .icon=${section.icon}
              ?active=${section.matches(this.#router.path)}
            ></nav-item>
          `,
        )}
      </nav-bar>

      <main class="main-content">${this.renderView()}</main>

      <!-- Mounted in the shell, not in a view: the + is in the nav bar, so the
           sheet has to be reachable from every route. Rendered only once its
           chunk has arrived — see postSheetLoaded. -->
      ${
        this.postSheetLoaded
          ? html`
              <post-sheet
                .open=${this.postSheetOpen}
                @sheet-close=${this.closePostSheet}
              ></post-sheet>
            `
          : nothing
      }

      <app-update-toast></app-update-toast>
    `;
  }

  /**
   * Where a nav item points: `root`, except for Cheval.
   *
   * That page is per-horse — `/horse/<id>`, the same link `horse-card` renders
   * — so its item needs the active horse, which is why the shell queries for
   * one at all. Until that resolves, one tick on a cold start, the bare
   * `/horse` stands in: the route accepts it and `HorseView` falls back to the
   * active horse itself, so the link is never broken, only less specific.
   */
  #sectionHref(section: Section): string {
    const horseId = this.#activeHorse.value?.id;
    return section.id === HORSE_SECTION && horseId
      ? horsePath(horseId)
      : section.root;
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
        aria-expanded=${this.postSheetOpen ? "true" : "false"}
        @click=${this.openPostSheet}
      >
        <app-icon class="nav-button__icon" icon="plus"></app-icon>
      </button>
    `;
  }

  private openPostSheet = async () => {
    // Both flags land in the same update, so the sheet's first render already
    // has `open` — `ModalDialog.hostUpdated` calls `showModal()` from there and
    // the @starting-style entry animation plays as normal.
    if (!this.postSheetLoaded) {
      await import("./components/post-sheet/post-sheet.ts");
      this.postSheetLoaded = true;
    }
    this.postSheetOpen = true;
  };

  private closePostSheet = () => {
    this.postSheetOpen = false;
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
    const view = this.querySelector("main")?.firstElementChild;
    // `instanceof` rather than a structural cast to `{ updateComplete?: ... }`:
    // every view here is a LitElement, and saying so lets the compiler check it
    // instead of being told to trust a shape nothing verifies.
    if (view instanceof LitElement) await view.updateComplete;

    this.querySelector<HTMLElement>("h1")?.focus();
  }

  private renderView() {
    if (this.dataError) return this.renderDataError();
    if (this.databaseNotice) return this.renderDatabaseNotice();
    return (matchRoute(this.#router.path) ?? NOT_FOUND).render(
      this.#router.path,
    );
  }

  /**
   * Shown instead of any view when `initData()` rejected.
   *
   * Carries its own export and restore because every route renders this
   * screen, so the profile page's are out of reach. `initData()` can fail
   * after `db.open()` succeeded — in `reconcileCategories`, say — and then the
   * data is intact and the export still works; it is worth trying before
   * anything else. `readBackupFile` opens its own transaction, so a restore
   * can also be attempted over a database that would not initialise.
   */
  private renderDataError() {
    return html`
      <section class="data-error">
        <hgroup class="section-group">
          <h1 class="section-title" tabindex="-1">Données inaccessibles</h1>
          <p class="section-subtitle">
            Le stockage local n’a pas pu être ouvert, donc rien ne peut être
            affiché.
          </p>
        </hgroup>

        <div class="container data-error__body">
          <p>
            Cela arrive quand l’espace de stockage est plein, en navigation
            privée, ou si la base locale a été endommagée.
          </p>
          <p class="data-error__hint">
            Essayez de libérer de l’espace puis de recharger. Exportez d’abord
            vos données si c’est encore possible ; si vous avez un fichier de
            sauvegarde, vous pouvez aussi le restaurer ici.
          </p>
          <p class="data-error__detail">${this.dataError}</p>
        </div>

        <div class="data-error__actions">
          <button
            class="data-error__button pressable"
            type="button"
            @click=${() => location.reload()}
          >
            Recharger
          </button>
          <button
            class="data-error__button pressable"
            type="button"
            @click=${this.#recovery.export}
          >
            Exporter les données
          </button>
          <button
            class="data-error__button pressable"
            type="button"
            @click=${this.#recovery.restore}
          >
            Restaurer un fichier
          </button>
        </div>
        ${this.#recovery.renderMessage({
          region: "data-error__message-region",
          status: "data-error__status",
          error: "data-error__detail",
        })}
      </section>
    `;
  }

  /**
   * Shown instead of any view while another tab or window holds the database
   * across a schema bump. Styled as the data-error screen, but it is not one:
   * the data is intact, and the way out is a reload or closing the other tab.
   */
  private renderDatabaseNotice() {
    const superseded = this.databaseNotice === "superseded";
    return html`
      <section class="data-error">
        <hgroup class="section-group">
          <h1 class="section-title" tabindex="-1">
            ${superseded ? "Nouvelle version ouverte" : "Mise à jour en attente"}
          </h1>
          <p class="section-subtitle">
            ${
              superseded
                ? "L’application a été mise à jour dans un autre onglet ou une autre fenêtre."
                : "L’application est encore ouverte dans un autre onglet ou une autre fenêtre."
            }
          </p>
        </hgroup>

        <div class="container data-error__body">
          <p>
            ${
              superseded
                ? "Rechargez cette page pour continuer. Tout ce qui a été enregistré est conservé."
                : "Fermez-la : la mise à jour se terminera d’elle-même."
            }
          </p>
        </div>

        ${
          superseded
            ? html`<div class="data-error__actions">
                <button
                  class="data-error__button pressable"
                  type="button"
                  @click=${() => location.reload()}
                >
                  Recharger
                </button>
              </div>`
            : nothing
        }
      </section>
    `;
  }
}
