# steven's log — blog structure

## Overview
Static blog. Pure HTML/CSS/JS — no frameworks, no build step, no React.
Designed for GitHub Pages deployment. Loads fast, stays lean.

## Directory Layout
```
blog/
├── index.html            ← home: tree + ls listing
├── posts/                ← individual post pages
│   ├── hello-world.html
│   └── ...
├── assets/
│   ├── css/style.css     ← single stylesheet
│   └── js/main.js        ← vim nav + viz hooks only
└── viz.html              ← (TODO) standalone viz playground
```

## How It Looks
The index is split into two panels:
- **Left**: `tree` view of active projects (ground-nav-drone, mtg-rl-bot, etc.)
- **Right**: `ls -lt` table of blog entries (date, type, linked title + description)

This should feel like a terminal listing, not a blog.

## Adding a New Post

### 1. Create the post file in `posts/`
Use `posts/hello-world.html` as template. Key structure:
- Breadcrumb nav: `~/log / post-name`
- `.post-meta` with date + type (spoken/written)
- Content in `.post-content`
- For spoken posts: wrap in `.spoken-transcript` with `.spoken-label`
- Tags at bottom in `.post-tags`

### 2. Add a row to `index.html`
Insert a new `<!-- post-row -->` block in the `ls-table tbody`.
**Newest first.** Agents scan for these markers.

```html
<!-- post-row -->
<tr>
  <td class="ls-date">YYYY-MM-DD</td>
  <td class="ls-type spoken">spkn</td>   <!-- or: written / writ -->
  <td><a href="posts/FILENAME.html">slug-name</a> <span class="ls-desc">— short description</span></td>
</tr>
<!-- /post-row -->
```

### 3. Update the project tree (if applicable)
If a post relates to a new sub-project, add a node to the `tree-listing` pre block.

## Post Types
- `spoken` / `spkn` — transcribed from Spokenly, lightly edited
- `written` / `writ` — typed/drafted directly

## Visualization Embeds
Viz containers load nothing by default. To add one inside a post:

```html
<div class="viz-embed" data-viz="viz-name">
  <span class="viz-label">LIVE VIZ</span>
</div>
```

Register the module (in a separate JS file or inline script):
```js
window.__vizModules['viz-name'] = function(container) {
  // Init Three.js, D3, WASM, etc.
  // Heavy stuff — user opts in by visiting the post
};
```

The wasm/heavy viz stuff is **opt-in per page** — nothing loads on index.

## Agent Guidelines
- **DO**: Add post rows to index, create post HTML files, add figure captions,
  create viz modules, update tree listing
- **DON'T**: Write blog prose (Steven speaks or writes all text content)
- **MAYBE**: Label figures, format/clean transcripts, suggest viz ideas as
  HTML comments

## Performance Notes
- No frameworks, no build step, no React
- Single CSS file, single tiny JS file
- Fonts: IBM Plex Mono (single import)
- Viz loads only on pages that use it — index is pure text
- Target: feels instant on any connection
