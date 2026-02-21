# CLAUDE.md — vimsite (steven's log)

## Quick Start
```bash
open index.html        # or python3 -m http.server 8080
# No build step. No deps. Edit HTML directly.
```

## Boot Checklist
1. `git status` + `git log --oneline -5`
2. Open `index.html` in browser — verify post count matches `posts/` directory
3. Read memory file: `~/.claude/projects/-Users-stevengonciar-git-vimsite/memory/MEMORY.md`

## Architecture
Static blog. Pure HTML/CSS/JS, no frameworks. Terminal aesthetic (IBM Plex Mono, dark green on black). GitHub Pages via `.github/workflows/pages.yml`.

```
vimsite/
├── index.html              ← home: tree panel + ls-style post listing
├── posts/                  ← individual post pages (one HTML file per entry)
├── assets/
│   ├── css/style.css       ← single stylesheet, CSS variables for theming
│   └── js/
│       ├── main.js         ← vim nav, J2000 dates, viz registry, editor loader
│       └── editor.js       ← in-browser CRUD editor (GitHub API backend)
├── README.md               ← project docs + agent guidelines
└── CLAUDE.md               ← this file
```

## Content Workflow
1. Steven dictates entries via **Spokenly** or writes directly
2. Agent scaffolds post HTML from template (use any existing post in `posts/`)
3. Agent adds index row within `<!-- post-row -->` markers (newest first)
4. Steven fills in all prose — **agents never write blog content**

## Post Types
- `spoken` / `spkn` — transcribed from Spokenly, lightly edited (orange accent)
- `written` / `writ` — typed/drafted directly (teal accent)

## Agent Rules
- **DO**: scaffold post files, add index rows, format transcripts, create viz modules, update tree
- **DON'T**: write blog prose (Steven writes all text content)
- **MAYBE**: label figures, suggest viz ideas as HTML comments

## Output Token Management (CRITICAL)
This project hits output token limits because features touch few files with large writes.

**Rules:**
- **Never write >150 lines in a single tool call.** Break large writes into multiple Edit calls.
- **New JS modules >100 lines: write a skeleton first, then fill sections** via Edit.
- **CSS additions: append in focused Edit calls** (one component at a time), not full file rewrites.
- **Prefer Edit over Write** for existing files — always. Write is only for new files.

## Agent Spawning Guidelines
Most features touch the same 3 files (index.html, style.css, main.js), so parallel agents conflict.

**DO spawn agents for:**
- New standalone JS modules (e.g., a viz module in its own file)
- Batch post scaffolding (multiple post HTML files are independent)
- Research/exploration (checking GitHub API docs, testing patterns)
- New CSS component drafts → agent writes to a scratch file, you merge into style.css

**DON'T spawn agents for:**
- Anything that edits style.css, main.js, or index.html — serialize these
- Small edits (<30 lines) — just do it inline

**Pattern for large features:**
1. Plan the feature (what files, what sections)
2. Spawn agent for any NEW standalone file (e.g., `assets/js/newmodule.js`)
3. While agent works: do CSS/HTML changes in main context
4. Merge agent output, commit together

## Key Design Decisions
- No frameworks, no build step — intentional, not a TODO
- Single font (IBM Plex Mono), single CSS file
- Lab notebook feel, not polished blog
- Editor (editor.js) lazy-loads only when user presses n/e/d
- Viz modules lazy-load only on pages that use them

## Commit Discipline
- Commit after each discrete feature or fix — don't batch
- Post file + its index row = one commit
- CSS + JS for a single feature = one commit
- Never let uncommitted changes span multiple features
