# CLAUDE.md — vimsite (steven's log)

## Quick Start
```bash
# Preview locally
open index.html        # or python3 -m http.server 8080

# No build step. No deps. Edit HTML directly.
```

## Architecture
Static blog. Pure HTML/CSS/JS, no frameworks. Terminal aesthetic (IBM Plex Mono, dark green on black). Designed for GitHub Pages.

```
vimsite/
├── index.html              ← home: tree panel + ls-style post listing
├── posts/                  ← individual post pages
│   └── hello-world.html
├── assets/
│   ├── css/style.css       ← single stylesheet, CSS variables for theming
│   └── js/main.js          ← vim j/k nav + viz module registry
├── README.md               ← project docs + agent guidelines
└── CLAUDE.md               ← this file
```

## Content Workflow
1. Steven dictates entries via **Spokenly** (NVIDIA Parakeet STT) or writes directly
2. Agent scaffolds post HTML from template (`posts/hello-world.html`)
3. Agent adds index row within `<!-- post-row -->` markers (newest first)
4. Steven fills in all prose — **agents never write blog content**

## Post Types
- `spoken` / `spkn` — transcribed from Spokenly, lightly edited (orange accent)
- `written` / `writ` — typed/drafted directly (teal accent)

## Adding a Post
1. Copy `posts/hello-world.html` as template
2. Update: title, date, type (spoken/written), breadcrumb, tags
3. Add `<!-- post-row -->` block to `index.html` tbody (newest first)
4. Update `<p class="ls-count">` entry count
5. Commit the post file + index.html together

## Agent Rules
- **DO**: scaffold post files, add index rows, format transcripts, create viz modules, update tree
- **DON'T**: write blog prose (Steven writes all text content)
- **MAYBE**: label figures, suggest viz ideas as HTML comments

## Viz System
- `window.__vizModules` registry in main.js
- `.viz-embed[data-viz="name"]` containers auto-bind on page load
- Heavy libs (Three.js, D3, WASM) load only on pages that use them — index stays pure text

## Key Design Decisions
- No frameworks, no build step, no React — intentional, not a TODO
- Single font (IBM Plex Mono), single CSS file, single tiny JS file
- Target: feels instant on any connection (~10KB total)
- Lab notebook feel, not polished blog

## Resuming Work
- Check `git status` and `git log --oneline -5`
- Open `index.html` in browser to see current state
- Count posts in index vs files in `posts/` — they should match
