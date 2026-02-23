/* log — main.ts — minimal */

(function () {
  'use strict';

  // --- J2000 day number (days since 2000-01-01 12:00 TT) ---
  function j2000(y: number, m: number, d: number): number {
    const a = Math.floor((14 - m) / 12);
    const yy = y + 4800 - a;
    const mm = m + 12 * a - 3;
    const jdn =
      d +
      Math.floor((153 * mm + 2) / 5) +
      365 * yy +
      Math.floor(yy / 4) -
      Math.floor(yy / 100) +
      Math.floor(yy / 400) -
      32045;
    return jdn - 2451545;
  }

  function injectJ2000(): void {
    document.querySelectorAll<HTMLElement>('.ls-date[data-date]').forEach((el) => {
      const p = (el.dataset.date ?? '').split('-');
      const span = document.createElement('span');
      span.className = 'j2000';
      span.textContent = 'J' + j2000(+p[0], +p[1], +p[2]);
      el.appendChild(span);
    });
    document.querySelectorAll<HTMLElement>('.post-meta time[datetime]').forEach((el) => {
      const p = (el.getAttribute('datetime') ?? '').split('-');
      const span = document.createElement('span');
      span.className = 'j2000';
      span.textContent = 'J' + j2000(+p[0], +p[1], +p[2]);
      el.parentNode?.insertBefore(span, el.nextSibling);
    });
  }

  injectJ2000();

  // --- tree count --- (reads DOM so no hardcoding needed)
  function updateTreeCount(): void {
    const pre = document.querySelector<HTMLElement>('.tree-listing');
    const countEl = document.getElementById('tree-count');
    if (!pre || !countEl) return;
    const dirs = pre.querySelectorAll('a.tree-dir').length;
    const lines = (pre.textContent ?? '').split('\n');
    const items = lines.filter(
      (l) => (l.includes('├──') || l.includes('└──')) && !l.trimEnd().endsWith('/'),
    ).length;
    const d = dirs === 1 ? 'directory' : 'directories';
    const i = items === 1 ? 'item' : 'items';
    countEl.textContent = `${dirs} ${d}, ${items} ${i}`;
  }

  updateTreeCount();

  // --- lazy-load editor.js ---
  function loadEditor(fn: () => void): void {
    if (window.__editor) {
      fn();
      return;
    }
    const s = document.createElement('script');
    const isPost = !!document.querySelector('.post-content');
    s.src = (isPost ? '../' : '') + 'assets/js/editor.js';
    s.onload = fn;
    document.head.appendChild(s);
  }

  // --- vim j/k/↑/↓/Enter nav on ls table rows (skips group headers) ---
  const rows = document.querySelectorAll<HTMLTableRowElement>(
    '.ls-table tbody tr:not(.ls-group-year):not(.ls-group-month)',
  );
  let cur = -1;

  // --- tree panel navigation state ---
  const treeLinks = document.querySelectorAll<HTMLAnchorElement>('.tree-listing a');
  let treeCur = -1;
  let treeMode = false;

  function selectTree(i: number): void {
    treeLinks.forEach((a) => a.classList.remove('tree-cursor'));
    if (i >= 0 && i < treeLinks.length) {
      treeLinks[i].classList.add('tree-cursor');
      treeLinks[i].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function enterTreeMode(): void {
    treeMode = true;
    treeCur = 0;
    selectTree(treeCur);
  }

  function exitTreeMode(): void {
    treeMode = false;
    treeLinks.forEach((a) => a.classList.remove('tree-cursor'));
  }

  function select(i: number): void {
    rows.forEach((r) => r.classList.remove('selected'));
    if (i >= 0 && i < rows.length) {
      rows[i].classList.add('selected');
      rows[i].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function getSelectedSlug(): string | null {
    if (cur < 0 || !rows[cur]) return null;
    const link = rows[cur].querySelector('a');
    if (!link) return null;
    const m = link.getAttribute('href')?.match(/posts\/([^.]+)\.html/);
    return m ? m[1] : null;
  }

  function getCurrentSlug(): string | null {
    const m = location.pathname.match(/posts\/([^.]+)\.html/);
    return m ? m[1] : null;
  }

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    if (document.querySelector('.editor-overlay')) return;

    // t — enter tree panel mode
    if (e.key === 't' && !treeMode && !document.querySelector('.post-content')) {
      if (!treeLinks.length) return;
      e.preventDefault();
      enterTreeMode();
      return;
    }

    // Escape / l — exit tree mode
    if ((e.key === 'Escape' || e.key === 'l') && treeMode) {
      e.preventDefault();
      exitTreeMode();
      return;
    }

    // --- tree mode navigation ---
    if (treeMode) {
      // j / ArrowDown — move down in tree
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        treeCur = Math.min(treeCur + 1, treeLinks.length - 1);
        selectTree(treeCur);
      }
      // k / ArrowUp — move up in tree
      else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        treeCur = Math.max(treeCur - 1, 0);
        selectTree(treeCur);
      }
      // Enter — follow tree link href
      else if (e.key === 'Enter' && treeCur >= 0) {
        const href = treeLinks[treeCur].getAttribute('href');
        if (href && href !== '#') {
          window.location.href = href;
        }
      }
      return;
    }

    // j / ArrowDown — move down
    if (e.key === 'j' || e.key === 'ArrowDown') {
      if (!rows.length) return;
      e.preventDefault();
      cur = Math.min(cur + 1, rows.length - 1);
      select(cur);
    }
    // k / ArrowUp — move up
    else if (e.key === 'k' || e.key === 'ArrowUp') {
      if (!rows.length) return;
      e.preventDefault();
      cur = Math.max(cur - 1, 0);
      select(cur);
    }
    // Enter — open selected entry
    else if (e.key === 'Enter' && cur >= 0) {
      const link = rows[cur].querySelector('a');
      if (link) (link as HTMLAnchorElement).click();
    }
    // ArrowLeft — prev (newer) post
    else if (e.key === 'ArrowLeft') {
      const prev = document.querySelector<HTMLAnchorElement>('.post-nav .prev');
      if (prev) {
        e.preventDefault();
        prev.click();
      }
    }
    // ArrowRight — next (older) post
    else if (e.key === 'ArrowRight') {
      const next = document.querySelector<HTMLAnchorElement>('.post-nav .next');
      if (next) {
        e.preventDefault();
        next.click();
      }
    }
    // Backspace — back to ~/log
    else if (e.key === 'Backspace') {
      const back =
        document.querySelector<HTMLAnchorElement>('.post-nav .back') ??
        document.querySelector<HTMLAnchorElement>('nav a[href*="index"]');
      if (back) {
        e.preventDefault();
        back.click();
      }
    }
    // n — new entry (index page only)
    else if (e.key === 'n' && !document.querySelector('.post-content')) {
      e.preventDefault();
      loadEditor(() => window.__editor?.newEntry());
    }
    // e — edit entry (post page or selected index row)
    else if (e.key === 'e') {
      const slug = document.querySelector('.post-content') ? getCurrentSlug() : getSelectedSlug();
      if (slug) {
        e.preventDefault();
        loadEditor(() => window.__editor?.editEntry(slug));
      }
    }
    // d — delete entry (index page, with selection)
    else if (e.key === 'd' && !document.querySelector('.post-content')) {
      const slug = getSelectedSlug();
      if (slug) {
        e.preventDefault();
        loadEditor(() => window.__editor?.deleteEntry(slug));
      }
    }
  });

  // --- viz module registry ---
  window.__vizModules = window.__vizModules || {};
  document.querySelectorAll<HTMLElement>('.viz-embed[data-viz]').forEach((el) => {
    const mod = window.__vizModules[el.dataset.viz ?? ''];
    if (mod) mod(el);
  });
})();
