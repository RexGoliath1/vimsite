# CLAUDE.md — vimsite (steven's log)

## Quick Start
```bash
npm run build          # compile TypeScript → assets/js/
npm run lint           # ESLint + Stylelint + tsc --noEmit
npm run format         # Prettier (check only: npm run format:check)
python3 -m http.server 8080  # then open http://localhost:8080 (use open on macOS, xdg-open on Linux)
```

## Boot Checklist
1. `git status` + `git log --oneline -5`
2. Read memory: `~/.claude/projects/*vimsite*/memory/MEMORY.md` (path hash varies by machine)
3. `npm run build && npm run lint` — verify clean state
4. Open `index.html` in browser — verify post count matches `posts/` directory

## Architecture
Static blog with TypeScript build. Terminal aesthetic (IBM Plex Mono, dark green on black).
**Cloudflare Workers** deployment — production at https://vimsite.sgoncia.workers.dev/
GitHub auto-deploy connected — pushes to main deploy automatically.
CI gate (lint/build/typecheck) runs via `.github/workflows/pages.yml` on pushes and PRs.
Lighthouse performance auditing runs via `.github/workflows/lighthouse.yml` on PRs.

```
vimsite/
├── index.html              ← home: tree panel + ls-style post listing
├── posts/                  ← individual post pages (one HTML file per entry)
├── src/                    ← TypeScript source (edit these, not assets/js/)
│   ├── main.ts             ← vim nav, J2000 dates, viz registry, editor loader
│   └── editor.ts           ← in-browser CRUD editor (GitHub API backend)
├── assets/
│   ├── css/style.css       ← single stylesheet, CSS variables for theming
│   └── js/                 ← compiled JS output (DO NOT EDIT DIRECTLY)
│       ├── main.js
│       └── editor.js
├── tsconfig.json
├── package.json            ← devDependencies only (zero runtime deps)
├── .eslintrc.json
├── .stylelintrc.json
├── .prettierrc
├── README.md
└── CLAUDE.md               ← this file
```

**Source of truth:** `src/*.ts` files. `assets/js/*.js` is compiled output.
Always edit `src/`, never edit `assets/js/` directly.

## Content Workflow
1. Steven dictates entries via **Spokenly** or writes directly
2. Agent scaffolds post HTML from template (use any existing post in `posts/`)
3. Agent adds index row within `<!-- post-row -->` markers (newest first)
4. Steven fills in all prose — **agents never write blog content**
5. **Before committing**: `npx prettier --write <post.html> index.html`

## Post Types
- `spoken` / `spkn` — transcribed from Spokenly, lightly edited (orange accent)
- `written` / `writ` — typed/drafted directly (teal accent)

## Two-Tier Workflow (CRITICAL)

### Content (blog posts): push directly to main
- New post HTML + index row update → commit → push to main
- No PR required. Steven reviews the deployed site, not the code.
- This keeps the writing flow fast and unblocked.

### Features (TS, CSS, structural changes): branch + PR
- Any change to `src/*.ts`, `assets/css/style.css`, `index.html` structure, CI config → feature branch + PR
- Steven reviews the deployed site preview, not the diff
- All CI checks must pass before merge

## Agent Rules
- **DO**: scaffold post files, add index rows, format transcripts, create viz modules, update tree
- **DON'T**: write blog prose (Steven writes all text content)
- **MAYBE**: label figures, suggest viz ideas as HTML comments

## TypeScript Guidelines
- **Strict mode** (`"strict": true` in tsconfig.json)
- Use `const` and `let`, never `var`
- Type all function parameters and return values
- Use union types for post type: `type PostType = 'spoken' | 'written'`
- Interface all data shapes (Post, EditorOptions, GitHubResponse, etc.)
- Compiler: **esbuild** for fast builds, `tsc --noEmit` for type checking only
- Build output: `assets/js/*.js` (ES2020 target, no bundling needed)

## Linting & Formatting
- **ESLint**: JS/TS linting — `@typescript-eslint` plugin, strict config
- **Stylelint**: CSS linting — duplicate props, invalid selectors, shorthand conflicts
- **Prettier**: formatting for TS, CSS, HTML — consistent style, no debates
- **Pre-commit**: lint-staged runs all three on staged files
- **CI**: `npm run lint && npm run format:check` — runs on pushes and PRs via GitHub Actions

## Viz System — Rust/WASM (Future)
- Viz modules use **Rust compiled to WebAssembly** — not TypeScript
- Each viz = its own Rust crate in `viz/<name>/`, compiles to `assets/wasm/<name>.wasm`
- JS glue registers via `window.__vizModules` registry (existing pattern)
- Heavy compute (factor graphs, 3D, simulation) → WASM. DOM glue stays in TypeScript.
- **Do NOT use Rust/WASM for DOM manipulation** — bridge overhead makes it slower than JS

## Output Token Management (CRITICAL)
This project hits output token limits because features touch few files with large writes.

**Rules:**
- **Never write >150 lines in a single tool call.** Break large writes into multiple Edit calls.
- **New TS modules >100 lines: write a skeleton first, then fill sections** via Edit.
- **CSS additions: append in focused Edit calls** (one component at a time), not full file rewrites.
- **Prefer Edit over Write** for existing files — always. Write is only for new files.

## Agent Spawning Guidelines
**DO spawn agents for:**
- New standalone TS modules (e.g., a viz loader in its own file)
- Batch post scaffolding (multiple post HTML files are independent)
- Research/exploration (checking API docs, testing patterns)
- New CSS component drafts → agent writes to a scratch file, you merge into style.css
- Rust/WASM viz crate development (each crate is fully independent)

**DON'T spawn agents for:**
- Anything that edits style.css, main.ts, or index.html — serialize these
- Small edits (<30 lines) — just do it inline

**Pattern for large features:**
1. Plan the feature (what files, what sections)
2. Spawn agent for any NEW standalone file (e.g., `src/newmodule.ts`)
3. While agent works: do CSS/HTML changes in main context
4. Merge agent output, commit together

## Key Design Decisions
- No runtime frameworks — TypeScript compiles to vanilla JS, zero runtime deps
- Single font (IBM Plex Mono), single CSS file
- Lab notebook feel, not polished blog
- Editor lazy-loads only when user presses n/e/d
- Viz modules lazy-load only on pages that use them
- WASM for compute-heavy viz only, TypeScript for everything else

## Commit Discipline
- Commit after each discrete feature or fix — don't batch
- Post file + its index row = one commit (push directly to main)
- Feature work = branch + PR
- CSS + TS for a single feature = one commit
- Never let uncommitted changes span multiple features
- Always run `npm run build && npm run lint` before committing
- **Content commits**: run `npx prettier --write <post.html> index.html` before staging — prose breaks Prettier reliably
