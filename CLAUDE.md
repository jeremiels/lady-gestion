# lady-gestion

Mobile-first web app for managing a horse (care, events, documents, budget).
Lit 3 + TypeScript + Vite + Dexie. French UI copy throughout ("Ration
quotidienne", "Identité", "Accueil").

Reference prose — stack rationale, structure, data layer, component and styling
conventions, PWA/offline notes — lives in `AGENTS.md`. Read the relevant section
there when the task touches it. The rules below apply to every task.

## Git Safety

- This repo often has uncommitted work. NEVER run `git checkout --`,
  `git reset --hard`, `git stash`, `git clean`, or `rm -rf` without explicit
  per-command approval.
- Code reviews and audits are strictly read-only: use `git diff`, `git log`,
  `git show` only.

## Verification Scope

- Do NOT run the full test suite or a production build unless explicitly asked.
  Run only the narrowest relevant check (single test file, `tsc --noEmit`, or
  lint on changed files).
- When the user asks for confirmation, answer in one or two sentences. Never
  dump full test/build output.
- Never claim something "works" or is "done" unless you actually observed it
  working (browser screenshot, test run, or measured value). If unverified, say
  so explicitly.

## Scope Discipline

- Change only what was asked. Do not rename types, restructure adjacent code, or
  "improve" surrounding patterns as a side effect.
- Never modify shared/global design tokens or shared component styles to fix a
  single view — scope the fix to the consuming view.
- If a broader refactor seems necessary, stop and propose it in one short
  paragraph before touching anything.

## Hard Constraints

- **Browser floor: Safari 18.2 / Chrome 134 / Firefox 137.** Everything may
  assume it — guarding what the floor already guarantees is dead code. Anything
  above the floor must be feature-detected with a comment saying why. Notable
  seams: the Navigation API (Safari 26.2, Firefox 147) and CSS anchor
  positioning (Safari 26, Firefox 147) are **above** the floor. See
  "Browser floor" in `AGENTS.md` before reaching for a new platform feature.
- **Dexie / IndexedDB is the only persistence layer** (`src/data/`). No
  `localStorage`, no `fetch`/API calls, no backend.
- **No state management library and no store.** Reactivity comes from
  `LiveQuery` (`src/data/live.ts`), a Lit `ReactiveController` wrapping Dexie's
  `liveQuery`.
- **No React, Vue or other framework.** Lit web components only.

## Local Context First

- Search within the project directory only. Do not scan the home directory,
  Downloads, or Windows mounts for files — ask the user for the path instead.
- Before starting work on an existing feature, read the last few relevant
  commits (`git log -p -- <path>`) to understand recent changes.

## Commands

|                                |                                               |
| ------------------------------ | --------------------------------------------- |
| `npm run dev`                  | Vite dev server                               |
| `npm run typecheck`            | `tsc` over both tsconfigs — the default check |
| `npm run test:data`            | data-layer tests only                         |
| `npm run test:components`      | component tests only                          |
| `npm run lint` / `npm run fmt` | oxlint / oxfmt                                |

`npm test` (full vitest run) and `npm run build` (typecheck + lint + fmt +
vite build) are explicit-request only — see Verification Scope.

## Dev Server

- The app is served under a base path (e.g. `/lady-gestion/`). Before browser
  verification, confirm the running port and base path with `ps`/`lsof` rather
  than assuming; kill stale servers on other base paths.

## Comments

- A comment may say what the code does and **why it has this shape**. It may
  not say what the code used to be — `git log -p` already answers that, and a
  changelog in a docblock rots silently. Several already had: `posts.ts`
  documented a constant nothing used, and `PostDetailView` cited a function
  with no callers.
- Prune on touch, not in a sweep. When you edit a block, drop the historical
  narrative from its docblock; do not open a change that only deletes comments.

## Lit CSS Templates

- Never place a raw backtick inside a ``css`...` `` or ``html`...` `` tagged
  template — including inside comments. Use `/* ... */` without backticks, or
  escape them.
- After editing any ``css` `` block, run typecheck on that file before
  reporting done.
