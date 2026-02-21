/* log — editor.ts — lazy-loaded, auth-gated */

// === Interfaces ===

interface GitHubRef {
  object: { sha: string };
}

interface GitHubCommit {
  tree: { sha: string };
  sha: string;
}

interface GitHubTree {
  sha: string;
}

interface GitHubContent {
  content: string;
  sha: string;
}

interface FileEntry {
  path: string;
  content?: string;
  delete?: boolean;
}

interface TreeEntry {
  path: string;
  mode: '100644';
  type: 'blob';
  sha?: string | null;
  content?: string;
}

interface Post {
  slug: string;
  date: string;
  type: PostType;
  content: string;
  tags: string[];
  prevSlug: string | null;
  nextSlug: string | null;
}

type PostGenerateOptions = Post;

interface EditorSaveResult {
  slug: string;
  type: PostType;
  content: string;
  desc: string;
  tags: string[];
}

interface EditorOptions {
  mode: 'new' | 'edit';
  slug?: string;
  type?: PostType;
  content?: string;
  tags?: string[];
  desc?: string;
  onSave: (result: EditorSaveResult) => Promise<void>;
}

type PostType = 'spoken' | 'written';

// === IIFE ===

(function () {
  'use strict';

  const OWNER = 'RexGoliath1';
  const REPO = 'vimsite';
  const BRANCH = 'main';
  const API = 'https://api.github.com/repos/' + OWNER + '/' + REPO;
  const MONTHS = [
    '',
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];

  // ====== Helpers ======

  function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function today(): string {
    const d = new Date();
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  }

  function slugify(t: string): string {
    return t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
  }

  function el(tag: string, cls?: string): HTMLElement {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }
  // ====== Auth ======

  function getToken(): string | null {
    return localStorage.getItem('vimsite_token');
  }

  function setToken(t: string): void {
    localStorage.setItem('vimsite_token', t);
  }

  function requireAuth(): Promise<string> {
    return new Promise((resolve, reject) => {
      const t = getToken();
      if (t) return resolve(t);
      const ov = el('div', 'editor-overlay');
      const box = el('div', 'editor-box');
      box.style.maxWidth = '500px';
      box.innerHTML =
        '<div class="editor-header">github token required</div>' +
        '<div style="padding:1rem">' +
        '<p style="margin-bottom:1rem;color:var(--fg-dim);font-size:0.75rem">' +
        'fine-grained PAT scoped to <strong>' +
        OWNER +
        '/' +
        REPO +
        '</strong> with <strong>contents: read/write</strong></p>' +
        '<input type="password" class="editor-input" id="ed-token" ' +
        'placeholder="github_pat_..." style="width:100%">' +
        '<p style="margin-top:0.75rem;font-size:0.65rem;color:var(--border)">' +
        '<a href="https://github.com/settings/personal-access-tokens/new" ' +
        'target="_blank" rel="noopener">create token</a></p></div>' +
        '<div class="editor-status">enter: save · esc: cancel</div>';
      ov.appendChild(box);
      document.body.appendChild(ov);
      const inp = document.getElementById('ed-token') as HTMLInputElement;
      inp.focus();
      inp.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' && inp.value.trim()) {
          setToken(inp.value.trim());
          document.body.removeChild(ov);
          resolve(inp.value.trim());
        } else if (e.key === 'Escape') {
          document.body.removeChild(ov);
          reject(new Error('cancelled'));
        }
      });
    });
  }
  // ====== GitHub API ======

  function gh<T>(method: string, path: string, token: string, body?: unknown): Promise<T> {
    const opts: RequestInit = {
      method,
      headers: {
        Authorization: 'token ' + token,
        Accept: 'application/vnd.github.v3+json',
      },
    };
    if (body) {
      (opts.headers as Record<string, string>)['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(API + '/' + path, opts).then((r) => {
      if (!r.ok) return r.text().then((t) => Promise.reject(new Error(r.status + ': ' + t)));
      return r.status === 204 ? (null as T) : (r.json() as Promise<T>);
    });
  }

  function getFile(path: string, token: string): Promise<{ content: string; sha: string }> {
    return gh<GitHubContent>('GET', 'contents/' + path + '?ref=' + BRANCH, token).then((d) => {
      const raw = atob(d.content.replace(/\s/g, ''));
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return { content: new TextDecoder().decode(bytes), sha: d.sha };
    });
  }

  function multiCommit(token: string, message: string, files: FileEntry[]): Promise<void> {
    let commitSha: string;
    return gh<GitHubRef>('GET', 'git/ref/heads/' + BRANCH, token)
      .then((ref) => {
        commitSha = ref.object.sha;
        return gh<GitHubCommit>('GET', 'git/commits/' + commitSha, token);
      })
      .then((commit) => {
        const tree: TreeEntry[] = files.map((f) => {
          if (f.delete)
            return { path: f.path, mode: '100644' as const, type: 'blob' as const, sha: null };
          return {
            path: f.path,
            mode: '100644' as const,
            type: 'blob' as const,
            content: f.content,
          };
        });
        return gh<GitHubTree>('POST', 'git/trees', token, { base_tree: commit.tree.sha, tree });
      })
      .then((newTree) => {
        return gh<GitHubCommit>('POST', 'git/commits', token, {
          message,
          tree: newTree.sha,
          parents: [commitSha],
        });
      })
      .then((c) => {
        return gh<null>('PATCH', 'git/refs/heads/' + BRANCH, token, { sha: c.sha }).then(() => {});
      });
  }
  // ====== Post HTML ======

  function generatePost(o: PostGenerateOptions): string {
    const paras = o.content
      .split(/\n\n+/)
      .filter(Boolean)
      .map((p) => {
        return '      <p>\n        ' + esc(p.trim()).replace(/\n/g, '\n        ') + '\n      </p>';
      })
      .join('\n\n');

    let body: string;
    if (o.type === 'spoken') {
      body =
        '    <div class="spoken-transcript">\n' +
        '      <p class="spoken-label">transcribed via spokenly · lightly edited</p>\n\n' +
        paras +
        '\n    </div>';
    } else {
      body = paras;
    }

    const tags = (o.tags || [])
      .map((t) => '      <span class="tag">' + esc(t) + '</span>')
      .join('\n');

    const nav: string[] = [];
    if (o.prevSlug)
      nav.push('    <a class="prev" href="' + o.prevSlug + '.html">\u2190 ' + o.prevSlug + '</a>');
    nav.push(
      '    <a class="back" href="../index.html">' + (o.prevSlug ? '' : '\u2190 ') + '~/log</a>',
    );
    if (o.nextSlug)
      nav.push('    <a class="next" href="' + o.nextSlug + '.html">' + o.nextSlug + ' \u2192</a>');

    return (
      '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
      '  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '  <title>' +
      o.slug +
      ' \u2014 log</title>\n' +
      '  <link rel="stylesheet" href="../assets/css/style.css">\n</head>\n<body>\n' +
      '  <header>\n    <nav style="font-size: 0.8rem; color: var(--fg-dim);">\n' +
      '      <a href="../index.html">~/log</a> / ' +
      o.slug +
      '\n    </nav>\n  </header>\n\n' +
      '  <main class="post-content">\n' +
      '    <div class="post-meta">\n      <time datetime="' +
      o.date +
      '">' +
      o.date +
      '</time>\n' +
      '      <span class="post-type ' +
      o.type +
      '">' +
      o.type +
      '</span>\n    </div>\n' +
      '    <h1>' +
      o.slug +
      '</h1>\n\n' +
      body +
      '\n\n' +
      '    <div class="post-tags">\n' +
      tags +
      '\n    </div>\n  </main>\n\n' +
      '  <nav class="post-nav">\n' +
      nav.join('\n') +
      '\n  </nav>\n\n' +
      '  <footer>\n    <p class="vim-hint">\u2190 \u2192 between posts \u00b7 backspace ~/log \u00b7 e edit</p>\n' +
      '    <p class="footer-eof">EOF</p>\n  </footer>\n\n' +
      '  <script src="../assets/js/main.js"></script>\n</body>\n</html>\n'
    );
  }

  function parsePost(html: string): Post {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let content = '';
    const transcript = doc.querySelector('.spoken-transcript');
    if (transcript) {
      content = Array.from(transcript.querySelectorAll('p:not(.spoken-label)'))
        .map((p) => p.textContent?.trim() ?? '')
        .join('\n\n');
    } else {
      const main = doc.querySelector('.post-content');
      if (main)
        content = Array.from(main.querySelectorAll(':scope > p'))
          .map((p) => p.textContent?.trim() ?? '')
          .join('\n\n');
    }
    const typeEl = doc.querySelector('.post-type');
    const prevEl = doc.querySelector('.post-nav .prev');
    const nextEl = doc.querySelector('.post-nav .next');
    return {
      slug: doc.querySelector('h1')?.textContent ?? '',
      date: doc.querySelector('time')?.getAttribute('datetime') ?? '',
      type: typeEl?.classList.contains('spoken') ? 'spoken' : 'written',
      content,
      tags: Array.from(doc.querySelectorAll('.tag')).map((t) => t.textContent?.trim() ?? ''),
      prevSlug: prevEl ? (prevEl.getAttribute('href')?.replace('.html', '') ?? null) : null,
      nextSlug: nextEl ? (nextEl.getAttribute('href')?.replace('.html', '') ?? null) : null,
    };
  }

  function updatePostNav(html: string, prevSlug: string | null, nextSlug: string | null): string {
    const s = html.indexOf('<nav class="post-nav">');
    const e = html.indexOf('</nav>', s) + 6;
    if (s === -1) return html;
    const nav: string[] = [];
    if (prevSlug)
      nav.push('    <a class="prev" href="' + prevSlug + '.html">\u2190 ' + prevSlug + '</a>');
    nav.push(
      '    <a class="back" href="../index.html">' + (prevSlug ? '' : '\u2190 ') + '~/log</a>',
    );
    if (nextSlug)
      nav.push('    <a class="next" href="' + nextSlug + '.html">' + nextSlug + ' \u2192</a>');
    return (
      html.slice(0, s) +
      '  <nav class="post-nav">\n' +
      nav.join('\n') +
      '\n  </nav>' +
      html.slice(e)
    );
  }
  // ====== Index manipulation ======

  function addToIndex(
    html: string,
    date: string,
    type: PostType,
    slug: string,
    desc: string,
  ): string {
    const day = date.split('-')[2];
    const ts = type === 'spoken' ? 'spkn' : 'writ';
    const month = MONTHS[+date.split('-')[1]];
    const year = date.split('-')[0];

    const row =
      '          <!-- post-row -->\n' +
      '          <tr class="' +
      type +
      '">\n' +
      '            <td class="ls-date" data-date="' +
      date +
      '">' +
      day +
      '</td>\n' +
      '            <td class="ls-type ' +
      type +
      '">' +
      ts +
      '</td>\n' +
      '            <td><a href="posts/' +
      slug +
      '.html">' +
      slug +
      '</a> ' +
      '<span class="ls-desc">\u2014 ' +
      esc(desc) +
      '</span></td>\n' +
      '          </tr>\n          <!-- /post-row -->';

    const hasYear = html.indexOf('ls-group-year"><td colspan="3">' + year + '<') > -1;
    const hasMonth = html.indexOf('ls-group-month"><td colspan="3">' + month + '<') > -1;

    if (hasMonth) {
      const tag = 'ls-group-month"><td colspan="3">' + month + '</td></tr>';
      const pos = html.indexOf(tag) + tag.length;
      html = html.slice(0, pos) + '\n' + row + html.slice(pos);
    } else if (hasYear) {
      const tag = 'ls-group-year"><td colspan="3">' + year + '</td></tr>';
      const pos = html.indexOf(tag) + tag.length;
      html =
        html.slice(0, pos) +
        '\n          <tr class="ls-group-month"><td colspan="3">' +
        month +
        '</td></tr>\n' +
        row +
        html.slice(pos);
    } else {
      const pos = html.indexOf('<tbody>') + 7;
      html =
        html.slice(0, pos) +
        '\n          <tr class="ls-group-year"><td colspan="3">' +
        year +
        '</td></tr>\n          <tr class="ls-group-month"><td colspan="3">' +
        month +
        '</td></tr>\n' +
        row +
        html.slice(pos);
    }
    return updateCount(html);
  }

  function removeFromIndex(html: string, slug: string): string {
    const marker = 'posts/' + slug + '.html';
    const pos = html.indexOf(marker);
    if (pos === -1) return html;
    let s = html.lastIndexOf('<!-- post-row -->', pos);
    const e = html.indexOf('<!-- /post-row -->', pos) + 18;
    while (s > 0 && html[s - 1] === ' ') s--;
    if (s > 0 && html[s - 1] === '\n') s--;
    return updateCount(html.slice(0, s) + html.slice(e));
  }

  function updateCount(html: string): string {
    const m = html.match(/<!-- post-row -->/g);
    const n = m ? m.length : 0;
    return html.replace(
      /<p class="ls-count">[^<]*<\/p>/,
      '<p class="ls-count">' + (n === 1 ? '1 entry' : n + ' entries') + '</p>',
    );
  }

  function getNewestSlug(html: string): string | null {
    const s = html.indexOf('<!-- post-row -->');
    if (s === -1) return null;
    const chunk = html.slice(s, s + 500);
    const m = chunk.match(/posts\/([^.]+)\.html/);
    return m ? m[1] : null;
  }

  function getDescFromIndex(html: string, slug: string): string {
    const re = new RegExp(
      'posts/' + slug + '\\.html">[^<]*</a>\\s*<span class="ls-desc">. ([^<]*)',
    );
    const m = html.match(re);
    return m ? m[1] : '';
  }
  // ====== Editor UI ======

  function showEditor(opts: EditorOptions): void {
    let typeVal: PostType = opts.type || 'spoken';
    const ov = el('div', 'editor-overlay');
    const box = el('div', 'editor-box');
    box.innerHTML =
      '<div class="editor-header">' +
      '<span class="editor-path">~/log/' +
      (opts.mode === 'new' ? 'new' : opts.slug) +
      '</span>' +
      '<span class="editor-type ' +
      typeVal +
      '" id="ed-type">' +
      typeVal +
      '</span></div>' +
      '<div class="editor-fields">' +
      (opts.mode === 'new'
        ? '<input type="text" class="editor-input" id="ed-slug" placeholder="post-slug" value="">'
        : '') +
      '<textarea class="editor-textarea" id="ed-content" placeholder="start typing...">' +
      (opts.content || '') +
      '</textarea>' +
      '<input type="text" class="editor-input" id="ed-desc" placeholder="short description" value="' +
      (opts.desc || '').replace(/"/g, '&quot;') +
      '">' +
      '<input type="text" class="editor-input" id="ed-tags" placeholder="tags (comma separated)" value="' +
      (opts.tags || []).join(', ') +
      '"></div>' +
      '<div class="editor-status" id="ed-status">esc \u2192 command mode \u00b7 :w save \u00b7 :q quit \u00b7 :t toggle type</div>';

    ov.setAttribute('tabindex', '-1');
    ov.appendChild(box);
    document.body.appendChild(ov);

    const ta = document.getElementById('ed-content') as HTMLTextAreaElement;
    const status = document.getElementById('ed-status') as HTMLElement;
    const typeEl = document.getElementById('ed-type') as HTMLElement;
    let cmdMode = false;
    let cmdBuf = '';
    ta.focus();

    // auto-fill description from content
    ta.addEventListener('input', () => {
      const desc = document.getElementById('ed-desc') as HTMLInputElement;
      if (!desc.dataset.manual) {
        const words = ta.value.trim().split(/\s+/).slice(0, 8).join(' ');
        desc.value = words.length > 50 ? words.slice(0, 50) + '...' : words;
      }
    });
    (document.getElementById('ed-desc') as HTMLInputElement).addEventListener('input', function () {
      this.dataset.manual = '1';
    });

    // clickable type toggle
    typeEl.addEventListener('click', () => {
      typeVal = typeVal === 'spoken' ? 'written' : 'spoken';
      typeEl.textContent = typeVal;
      typeEl.className = 'editor-type ' + typeVal;
    });

    function cleanup(): void {
      if (ov.parentNode) document.body.removeChild(ov);
    }

    function execCmd(cmd: string): void {
      cmd = cmd.trim().toLowerCase();
      if (cmd === 'w' || cmd === 'wq') {
        const slug =
          opts.mode === 'new'
            ? slugify(
                (document.getElementById('ed-slug') as HTMLInputElement).value.trim() ||
                  ta.value.slice(0, 40),
              )
            : (opts.slug as string);
        if (!slug) {
          status.textContent = 'error: need a slug';
          return;
        }
        if (!ta.value.trim()) {
          status.textContent = 'error: no content';
          return;
        }
        status.textContent = 'saving...';
        const result: EditorSaveResult = {
          slug,
          type: typeVal,
          content: ta.value,
          desc: (document.getElementById('ed-desc') as HTMLInputElement).value.trim() || slug,
          tags: (document.getElementById('ed-tags') as HTMLInputElement).value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        };
        opts.onSave(result).then(
          () => {
            if (cmd === 'wq') {
              cleanup();
            } else {
              status.textContent = 'committed. reload in ~15s to see changes.';
            }
          },
          (err: Error) => {
            status.textContent = 'error: ' + err.message;
            if (err.message.indexOf('401') > -1 || err.message.indexOf('403') > -1) {
              localStorage.removeItem('vimsite_token');
              status.textContent = 'bad token \u2014 cleared. reload and try again.';
            }
          },
        );
      } else if (cmd === 'q' || cmd === 'q!') {
        cleanup();
      } else if (cmd === 't') {
        typeVal = typeVal === 'spoken' ? 'written' : 'spoken';
        typeEl.textContent = typeVal;
        typeEl.className = 'editor-type ' + typeVal;
        status.textContent = 'type: ' + typeVal;
        cmdMode = false;
        ta.focus();
      } else {
        status.textContent = 'unknown: :' + cmd;
      }
    }

    ov.addEventListener('keydown', (e: KeyboardEvent) => {
      if (cmdMode) {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          execCmd(cmdBuf);
          cmdMode = false;
          cmdBuf = '';
        } else if (e.key === 'Escape') {
          cmdMode = false;
          cmdBuf = '';
          status.textContent = 'esc \u2192 command mode';
          ta.focus();
        } else if (e.key === 'Backspace') {
          cmdBuf = cmdBuf.slice(0, -1);
          status.textContent = ':' + cmdBuf;
          if (!cmdBuf) {
            cmdMode = false;
            status.textContent = 'esc \u2192 command mode';
            ta.focus();
          }
        } else if (e.key.length === 1) {
          cmdBuf += e.key;
          status.textContent = ':' + cmdBuf;
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        cmdMode = true;
        cmdBuf = '';
        status.textContent = ':';
        ta.blur();
        ov.focus();
      }
    });
  }

  function showDeleteConfirm(slug: string, onConfirm: () => Promise<void>): void {
    const ov = el('div', 'editor-overlay');
    const box = el('div', 'editor-box');
    box.style.maxWidth = '450px';
    let stage = 0;
    const msgs = [
      'press d to confirm \u00b7 any other key to cancel',
      'press d again \u00b7 any other key to cancel',
      'FINAL \u2014 press d to delete permanently',
    ];

    function render(): void {
      box.innerHTML =
        '<div class="editor-header delete-header">!! delete ' +
        slug +
        ' !!</div>' +
        '<div style="padding:1.5rem;text-align:center"><p style="font-size:0.8rem">' +
        msgs[stage] +
        '</p>' +
        '<div class="delete-progress">' +
        '<span class="delete-dot ' +
        (stage >= 0 ? 'active' : '') +
        '">d</span>' +
        '<span class="delete-dot ' +
        (stage >= 1 ? 'active' : '') +
        '">d</span>' +
        '<span class="delete-dot ' +
        (stage >= 2 ? 'active' : '') +
        '">d</span>' +
        '</div></div>';
    }

    render();
    ov.appendChild(box);
    document.body.appendChild(ov);

    function handler(e: KeyboardEvent): void {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'd') {
        stage++;
        if (stage >= 3) {
          document.removeEventListener('keydown', handler, true);
          box.innerHTML =
            '<div class="editor-header delete-header">!! deleting !!</div>' +
            '<div style="padding:1.5rem;text-align:center"><p style="font-size:0.8rem">removing...</p></div>';
          onConfirm().then(
            () => {
              const p = box.querySelector('p');
              if (p) p.textContent = 'done. reload to see changes.';
              setTimeout(() => {
                if (ov.parentNode) document.body.removeChild(ov);
              }, 2000);
            },
            (err: Error) => {
              const p = box.querySelector('p');
              if (p) p.textContent = 'error: ' + err.message;
            },
          );
        } else {
          render();
        }
      } else {
        document.removeEventListener('keydown', handler, true);
        document.body.removeChild(ov);
      }
    }

    document.addEventListener('keydown', handler, true);
  }
  // ====== Workflows ======

  function newEntry(token: string): void {
    showEditor({
      mode: 'new',
      type: 'spoken',
      onSave: (r) => {
        return getFile('index.html', token).then((idx) => {
          const newest = getNewestSlug(idx.content);
          const date = today();
          const postHtml = generatePost({
            slug: r.slug,
            date,
            type: r.type,
            content: r.content,
            tags: r.tags,
            prevSlug: null,
            nextSlug: newest,
          });
          const newIndex = addToIndex(idx.content, date, r.type, r.slug, r.desc);
          const files: FileEntry[] = [
            { path: 'posts/' + r.slug + '.html', content: postHtml },
            { path: 'index.html', content: newIndex },
          ];
          if (newest) {
            return getFile('posts/' + newest + '.html', token).then((f) => {
              const parsed = parsePost(f.content);
              files.push({
                path: 'posts/' + newest + '.html',
                content: updatePostNav(f.content, r.slug, parsed.nextSlug),
              });
              return multiCommit(token, 'feat: add post ' + r.slug, files);
            });
          }
          return multiCommit(token, 'feat: add post ' + r.slug, files);
        });
      },
    });
  }

  function editEntry(slug: string, token: string): void {
    getFile('posts/' + slug + '.html', token).then((file) => {
      const post = parsePost(file.content);
      getFile('index.html', token).then((idx) => {
        const desc = getDescFromIndex(idx.content, slug);
        showEditor({
          mode: 'edit',
          slug,
          type: post.type,
          content: post.content,
          tags: post.tags,
          desc,
          onSave: (r) => {
            const postHtml = generatePost({
              slug,
              date: post.date,
              type: r.type,
              content: r.content,
              tags: r.tags,
              prevSlug: post.prevSlug,
              nextSlug: post.nextSlug,
            });
            let newIndex = removeFromIndex(idx.content, slug);
            newIndex = addToIndex(newIndex, post.date, r.type, slug, r.desc);
            return multiCommit(token, 'edit: update ' + slug, [
              { path: 'posts/' + slug + '.html', content: postHtml },
              { path: 'index.html', content: newIndex },
            ]);
          },
        });
      });
    });
  }

  function deleteEntry(slug: string, token: string): void {
    showDeleteConfirm(slug, () => {
      return getFile('posts/' + slug + '.html', token).then((file) => {
        const post = parsePost(file.content);
        return getFile('index.html', token).then((idx) => {
          const newIndex = removeFromIndex(idx.content, slug);
          const files: FileEntry[] = [
            { path: 'posts/' + slug + '.html', delete: true },
            { path: 'index.html', content: newIndex },
          ];
          const adj: Promise<void>[] = [];
          if (post.prevSlug) {
            adj.push(
              getFile('posts/' + post.prevSlug + '.html', token).then((f) => {
                files.push({
                  path: 'posts/' + post.prevSlug + '.html',
                  content: updatePostNav(f.content, parsePost(f.content).prevSlug, post.nextSlug),
                });
              }),
            );
          }
          if (post.nextSlug) {
            adj.push(
              getFile('posts/' + post.nextSlug + '.html', token).then((f) => {
                files.push({
                  path: 'posts/' + post.nextSlug + '.html',
                  content: updatePostNav(f.content, post.prevSlug, parsePost(f.content).nextSlug),
                });
              }),
            );
          }
          return Promise.all(adj).then(() => {
            return multiCommit(token, 'delete: remove ' + slug, files);
          });
        });
      });
    });
  }
  // ====== Public API ======

  window.__editor = {
    newEntry: () => {
      requireAuth()
        .then(newEntry)
        .catch(() => {});
    },
    editEntry: (slug: string) => {
      requireAuth()
        .then((t) => editEntry(slug, t))
        .catch(() => {});
    },
    deleteEntry: (slug: string) => {
      requireAuth()
        .then((t) => deleteEntry(slug, t))
        .catch(() => {});
    },
    clearToken: () => {
      localStorage.removeItem('vimsite_token');
    },
  };
})();
