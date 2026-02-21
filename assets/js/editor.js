/* log — editor.js — lazy-loaded, auth-gated */
(function() {
  'use strict';

  var OWNER = 'RexGoliath1';
  var REPO = 'vimsite';
  var BRANCH = 'main';
  var API = 'https://api.github.com/repos/' + OWNER + '/' + REPO;
  var MONTHS = ['','january','february','march','april','may','june',
    'july','august','september','october','november','december'];

  // ====== Helpers ======

  function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function slugify(t) { return t.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50); }
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }

  // ====== Auth ======

  function getToken() { return localStorage.getItem('vimsite_token'); }
  function setToken(t) { localStorage.setItem('vimsite_token', t); }

  function requireAuth() {
    return new Promise(function(resolve, reject) {
      var t = getToken();
      if (t) return resolve(t);
      var ov = el('div','editor-overlay');
      var box = el('div','editor-box');
      box.style.maxWidth = '500px';
      box.innerHTML =
        '<div class="editor-header">github token required</div>' +
        '<div style="padding:1rem">' +
        '<p style="margin-bottom:1rem;color:var(--fg-dim);font-size:0.75rem">' +
        'fine-grained PAT scoped to <strong>' + OWNER + '/' + REPO +
        '</strong> with <strong>contents: read/write</strong></p>' +
        '<input type="password" class="editor-input" id="ed-token" ' +
        'placeholder="github_pat_..." style="width:100%">' +
        '<p style="margin-top:0.75rem;font-size:0.65rem;color:var(--border)">' +
        '<a href="https://github.com/settings/personal-access-tokens/new" ' +
        'target="_blank" rel="noopener">create token</a></p></div>' +
        '<div class="editor-status">enter: save · esc: cancel</div>';
      ov.appendChild(box);
      document.body.appendChild(ov);
      var inp = document.getElementById('ed-token');
      inp.focus();
      inp.addEventListener('keydown', function(e) {
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

  function gh(method, path, token, body) {
    var opts = {
      method: method,
      headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json' }
    };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(API + '/' + path, opts).then(function(r) {
      if (!r.ok) return r.text().then(function(t) { throw new Error(r.status + ': ' + t); });
      return r.status === 204 ? null : r.json();
    });
  }

  function getFile(path, token) {
    return gh('GET', 'contents/' + path + '?ref=' + BRANCH, token).then(function(d) {
      var raw = atob(d.content.replace(/\s/g, ''));
      var bytes = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return { content: new TextDecoder().decode(bytes), sha: d.sha };
    });
  }

  function multiCommit(token, message, files) {
    var commitSha;
    return gh('GET', 'git/ref/heads/' + BRANCH, token).then(function(ref) {
      commitSha = ref.object.sha;
      return gh('GET', 'git/commits/' + commitSha, token);
    }).then(function(commit) {
      var tree = files.map(function(f) {
        if (f.delete) return { path: f.path, mode: '100644', type: 'blob', sha: null };
        return { path: f.path, mode: '100644', type: 'blob', content: f.content };
      });
      return gh('POST', 'git/trees', token, { base_tree: commit.tree.sha, tree: tree });
    }).then(function(newTree) {
      return gh('POST', 'git/commits', token, { message: message, tree: newTree.sha, parents: [commitSha] });
    }).then(function(c) {
      return gh('PATCH', 'git/refs/heads/' + BRANCH, token, { sha: c.sha });
    });
  }

  // ====== Post HTML ======

  function generatePost(o) {
    var paras = o.content.split(/\n\n+/).filter(Boolean).map(function(p) {
      return '      <p>\n        ' + esc(p.trim()).replace(/\n/g, '\n        ') + '\n      </p>';
    }).join('\n\n');

    var body;
    if (o.type === 'spoken') {
      body = '    <div class="spoken-transcript">\n' +
        '      <p class="spoken-label">transcribed via spokenly · lightly edited</p>\n\n' +
        paras + '\n    </div>';
    } else {
      body = paras;
    }

    var tags = (o.tags || []).map(function(t) {
      return '      <span class="tag">' + esc(t) + '</span>';
    }).join('\n');

    var nav = [];
    if (o.prevSlug) nav.push('    <a class="prev" href="' + o.prevSlug + '.html">\u2190 ' + o.prevSlug + '</a>');
    nav.push('    <a class="back" href="../index.html">' + (o.prevSlug ? '' : '\u2190 ') + '~/log</a>');
    if (o.nextSlug) nav.push('    <a class="next" href="' + o.nextSlug + '.html">' + o.nextSlug + ' \u2192</a>');

    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
      '  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '  <title>' + o.slug + ' \u2014 log</title>\n' +
      '  <link rel="stylesheet" href="../assets/css/style.css">\n</head>\n<body>\n' +
      '  <header>\n    <nav style="font-size: 0.8rem; color: var(--fg-dim);">\n' +
      '      <a href="../index.html">~/log</a> / ' + o.slug + '\n    </nav>\n  </header>\n\n' +
      '  <main class="post-content">\n' +
      '    <div class="post-meta">\n      <time datetime="' + o.date + '">' + o.date + '</time>\n' +
      '      <span class="post-type ' + o.type + '">' + o.type + '</span>\n    </div>\n' +
      '    <h1>' + o.slug + '</h1>\n\n' + body + '\n\n' +
      '    <div class="post-tags">\n' + tags + '\n    </div>\n  </main>\n\n' +
      '  <nav class="post-nav">\n' + nav.join('\n') + '\n  </nav>\n\n' +
      '  <footer>\n    <p class="vim-hint">\u2190 \u2192 between posts \u00b7 backspace ~/log \u00b7 e edit</p>\n' +
      '    <p class="footer-eof">EOF</p>\n  </footer>\n\n' +
      '  <script src="../assets/js/main.js"></script>\n</body>\n</html>\n';
  }

  function parsePost(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var content = '';
    var transcript = doc.querySelector('.spoken-transcript');
    if (transcript) {
      content = Array.from(transcript.querySelectorAll('p:not(.spoken-label)'))
        .map(function(p) { return p.textContent.trim(); }).join('\n\n');
    } else {
      var main = doc.querySelector('.post-content');
      if (main) content = Array.from(main.querySelectorAll(':scope > p'))
        .map(function(p) { return p.textContent.trim(); }).join('\n\n');
    }
    var typeEl = doc.querySelector('.post-type');
    var prevEl = doc.querySelector('.post-nav .prev');
    var nextEl = doc.querySelector('.post-nav .next');
    return {
      slug: (doc.querySelector('h1') || {}).textContent || '',
      date: (doc.querySelector('time') || {}).getAttribute('datetime') || '',
      type: typeEl && typeEl.classList.contains('spoken') ? 'spoken' : 'written',
      content: content,
      tags: Array.from(doc.querySelectorAll('.tag')).map(function(t) { return t.textContent.trim(); }),
      prevSlug: prevEl ? prevEl.getAttribute('href').replace('.html','') : null,
      nextSlug: nextEl ? nextEl.getAttribute('href').replace('.html','') : null
    };
  }

  // Update only the nav section of a post (preserves all other HTML)
  function updatePostNav(html, prevSlug, nextSlug) {
    var s = html.indexOf('<nav class="post-nav">');
    var e = html.indexOf('</nav>', s) + 6;
    if (s === -1) return html;
    var nav = [];
    if (prevSlug) nav.push('    <a class="prev" href="' + prevSlug + '.html">\u2190 ' + prevSlug + '</a>');
    nav.push('    <a class="back" href="../index.html">' + (prevSlug ? '' : '\u2190 ') + '~/log</a>');
    if (nextSlug) nav.push('    <a class="next" href="' + nextSlug + '.html">' + nextSlug + ' \u2192</a>');
    return html.slice(0, s) + '  <nav class="post-nav">\n' + nav.join('\n') + '\n  </nav>' + html.slice(e);
  }

  // ====== Index manipulation ======

  function addToIndex(html, date, type, slug, desc) {
    var day = date.split('-')[2];
    var ts = type === 'spoken' ? 'spkn' : 'writ';
    var month = MONTHS[+date.split('-')[1]];
    var year = date.split('-')[0];

    var row = '          <!-- post-row -->\n' +
      '          <tr class="' + type + '">\n' +
      '            <td class="ls-date" data-date="' + date + '">' + day + '</td>\n' +
      '            <td class="ls-type ' + type + '">' + ts + '</td>\n' +
      '            <td><a href="posts/' + slug + '.html">' + slug + '</a> ' +
      '<span class="ls-desc">\u2014 ' + esc(desc) + '</span></td>\n' +
      '          </tr>\n          <!-- /post-row -->';

    var hasYear = html.indexOf('ls-group-year"><td colspan="3">' + year + '<') > -1;
    var hasMonth = html.indexOf('ls-group-month"><td colspan="3">' + month + '<') > -1;

    if (hasMonth) {
      var tag = 'ls-group-month"><td colspan="3">' + month + '</td></tr>';
      var pos = html.indexOf(tag) + tag.length;
      html = html.slice(0, pos) + '\n' + row + html.slice(pos);
    } else if (hasYear) {
      var tag = 'ls-group-year"><td colspan="3">' + year + '</td></tr>';
      var pos = html.indexOf(tag) + tag.length;
      html = html.slice(0, pos) + '\n          <tr class="ls-group-month"><td colspan="3">' +
        month + '</td></tr>\n' + row + html.slice(pos);
    } else {
      var pos = html.indexOf('<tbody>') + 7;
      html = html.slice(0, pos) + '\n          <tr class="ls-group-year"><td colspan="3">' +
        year + '</td></tr>\n          <tr class="ls-group-month"><td colspan="3">' +
        month + '</td></tr>\n' + row + html.slice(pos);
    }
    return updateCount(html);
  }

  function removeFromIndex(html, slug) {
    var marker = 'posts/' + slug + '.html';
    var pos = html.indexOf(marker);
    if (pos === -1) return html;
    var s = html.lastIndexOf('<!-- post-row -->', pos);
    var e = html.indexOf('<!-- /post-row -->', pos) + 18;
    while (s > 0 && html[s-1] === ' ') s--;
    if (s > 0 && html[s-1] === '\n') s--;
    return updateCount(html.slice(0, s) + html.slice(e));
  }

  function updateCount(html) {
    var m = html.match(/<!-- post-row -->/g);
    var n = m ? m.length : 0;
    return html.replace(/<p class="ls-count">[^<]*<\/p>/,
      '<p class="ls-count">' + (n === 1 ? '1 entry' : n + ' entries') + '</p>');
  }

  function getNewestSlug(html) {
    var s = html.indexOf('<!-- post-row -->');
    if (s === -1) return null;
    var chunk = html.slice(s, s + 500);
    var m = chunk.match(/posts\/([^.]+)\.html/);
    return m ? m[1] : null;
  }

  function getDescFromIndex(html, slug) {
    var re = new RegExp('posts/' + slug + '\\.html">[^<]*</a>\\s*<span class="ls-desc">. ([^<]*)');
    var m = html.match(re);
    return m ? m[1] : '';
  }

  // ====== Editor UI ======

  function showEditor(opts) {
    var typeVal = opts.type || 'spoken';
    var ov = el('div', 'editor-overlay');
    var box = el('div', 'editor-box');
    box.innerHTML =
      '<div class="editor-header">' +
      '<span class="editor-path">~/log/' + (opts.mode === 'new' ? 'new' : opts.slug) + '</span>' +
      '<span class="editor-type ' + typeVal + '" id="ed-type">' + typeVal + '</span></div>' +
      '<div class="editor-fields">' +
      (opts.mode === 'new' ? '<input type="text" class="editor-input" id="ed-slug" placeholder="post-slug" value="">' : '') +
      '<textarea class="editor-textarea" id="ed-content" placeholder="start typing...">' +
      (opts.content || '') + '</textarea>' +
      '<input type="text" class="editor-input" id="ed-desc" placeholder="short description" value="' +
      (opts.desc || '').replace(/"/g, '&quot;') + '">' +
      '<input type="text" class="editor-input" id="ed-tags" placeholder="tags (comma separated)" value="' +
      (opts.tags || []).join(', ') + '"></div>' +
      '<div class="editor-status" id="ed-status">esc \u2192 command mode \u00b7 :w save \u00b7 :q quit \u00b7 :t toggle type</div>';

    ov.appendChild(box);
    document.body.appendChild(ov);

    var ta = document.getElementById('ed-content');
    var status = document.getElementById('ed-status');
    var typeEl = document.getElementById('ed-type');
    var cmdMode = false, cmdBuf = '';
    ta.focus();

    // auto-fill description from content
    ta.addEventListener('input', function() {
      var desc = document.getElementById('ed-desc');
      if (!desc.dataset.manual) {
        var words = ta.value.trim().split(/\s+/).slice(0, 8).join(' ');
        desc.value = words.length > 50 ? words.slice(0, 50) + '...' : words;
      }
    });
    document.getElementById('ed-desc').addEventListener('input', function() { this.dataset.manual = '1'; });

    // clickable type toggle
    typeEl.addEventListener('click', function() {
      typeVal = typeVal === 'spoken' ? 'written' : 'spoken';
      typeEl.textContent = typeVal;
      typeEl.className = 'editor-type ' + typeVal;
    });

    function cleanup() { if (ov.parentNode) document.body.removeChild(ov); }

    function execCmd(cmd) {
      cmd = cmd.trim().toLowerCase();
      if (cmd === 'w' || cmd === 'wq') {
        var slug = opts.mode === 'new'
          ? slugify(document.getElementById('ed-slug').value.trim() || ta.value.slice(0, 40))
          : opts.slug;
        if (!slug) { status.textContent = 'error: need a slug'; return; }
        if (!ta.value.trim()) { status.textContent = 'error: no content'; return; }
        status.textContent = 'saving...';
        var result = {
          slug: slug, type: typeVal, content: ta.value,
          desc: document.getElementById('ed-desc').value.trim() || slug,
          tags: document.getElementById('ed-tags').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean)
        };
        opts.onSave(result).then(function() {
          status.textContent = 'committed. reload in ~15s to see changes.';
          if (cmd === 'wq') setTimeout(function() { cleanup(); }, 2000);
        }).catch(function(err) {
          status.textContent = 'error: ' + err.message;
          if (err.message.indexOf('401') > -1 || err.message.indexOf('403') > -1) {
            localStorage.removeItem('vimsite_token');
            status.textContent = 'bad token \u2014 cleared. reload and try again.';
          }
        });
      } else if (cmd === 'q' || cmd === 'q!') {
        cleanup();
      } else if (cmd === 't') {
        typeVal = typeVal === 'spoken' ? 'written' : 'spoken';
        typeEl.textContent = typeVal;
        typeEl.className = 'editor-type ' + typeVal;
        status.textContent = 'type: ' + typeVal;
        cmdMode = false; ta.focus();
      } else {
        status.textContent = 'unknown: :' + cmd;
      }
    }

    ov.addEventListener('keydown', function(e) {
      if (cmdMode) {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); execCmd(cmdBuf); cmdMode = false; cmdBuf = ''; }
        else if (e.key === 'Escape') { cmdMode = false; cmdBuf = ''; status.textContent = 'esc \u2192 command mode'; ta.focus(); }
        else if (e.key === 'Backspace') { cmdBuf = cmdBuf.slice(0,-1); status.textContent = ':' + cmdBuf; if (!cmdBuf) { cmdMode = false; status.textContent = 'esc \u2192 command mode'; ta.focus(); } }
        else if (e.key.length === 1) { cmdBuf += e.key; status.textContent = ':' + cmdBuf; }
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); cmdMode = true; cmdBuf = ''; status.textContent = ':'; ta.blur(); }
    });
  }

  function showDeleteConfirm(slug, onConfirm) {
    var ov = el('div', 'editor-overlay');
    var box = el('div', 'editor-box');
    box.style.maxWidth = '450px';
    var stage = 0;
    var msgs = [
      'press d to confirm \u00b7 any other key to cancel',
      'press d again \u00b7 any other key to cancel',
      'FINAL \u2014 press d to delete permanently'
    ];
    function render() {
      box.innerHTML = '<div class="editor-header delete-header">!! delete ' + slug + ' !!</div>' +
        '<div style="padding:1.5rem;text-align:center"><p style="font-size:0.8rem">' + msgs[stage] + '</p>' +
        '<div class="delete-progress">' +
        '<span class="delete-dot ' + (stage >= 0 ? 'active' : '') + '">d</span>' +
        '<span class="delete-dot ' + (stage >= 1 ? 'active' : '') + '">d</span>' +
        '<span class="delete-dot ' + (stage >= 2 ? 'active' : '') + '">d</span>' +
        '</div></div>';
    }
    render();
    ov.appendChild(box);
    document.body.appendChild(ov);

    function handler(e) {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'd') {
        stage++;
        if (stage >= 3) {
          document.removeEventListener('keydown', handler, true);
          box.innerHTML = '<div class="editor-header delete-header">!! deleting !!</div>' +
            '<div style="padding:1.5rem;text-align:center"><p style="font-size:0.8rem">removing...</p></div>';
          onConfirm().then(function() {
            box.querySelector('p').textContent = 'done. reload to see changes.';
            setTimeout(function() { document.body.removeChild(ov); }, 2000);
          }).catch(function(err) {
            box.querySelector('p').textContent = 'error: ' + err.message;
          });
        } else { render(); }
      } else {
        document.removeEventListener('keydown', handler, true);
        document.body.removeChild(ov);
      }
    }
    document.addEventListener('keydown', handler, true);
  }

  // ====== Workflows ======

  function newEntry(token) {
    showEditor({
      mode: 'new', type: 'spoken',
      onSave: function(r) {
        return getFile('index.html', token).then(function(idx) {
          var newest = getNewestSlug(idx.content);
          var date = today();
          var postHtml = generatePost({
            slug: r.slug, date: date, type: r.type, content: r.content,
            tags: r.tags, prevSlug: null, nextSlug: newest
          });
          var newIndex = addToIndex(idx.content, date, r.type, r.slug, r.desc);
          var files = [
            { path: 'posts/' + r.slug + '.html', content: postHtml },
            { path: 'index.html', content: newIndex }
          ];
          if (newest) {
            return getFile('posts/' + newest + '.html', token).then(function(f) {
              files.push({ path: 'posts/' + newest + '.html', content: updatePostNav(f.content, r.slug, parsePost(f.content).nextSlug) });
              return multiCommit(token, 'feat: add post ' + r.slug, files);
            });
          }
          return multiCommit(token, 'feat: add post ' + r.slug, files);
        });
      }
    });
  }

  function editEntry(slug, token) {
    return getFile('posts/' + slug + '.html', token).then(function(file) {
      var post = parsePost(file.content);
      return getFile('index.html', token).then(function(idx) {
        var desc = getDescFromIndex(idx.content, slug);
        showEditor({
          mode: 'edit', slug: slug, type: post.type,
          content: post.content, tags: post.tags, desc: desc,
          onSave: function(r) {
            var postHtml = generatePost({
              slug: slug, date: post.date, type: r.type, content: r.content,
              tags: r.tags, prevSlug: post.prevSlug, nextSlug: post.nextSlug
            });
            var newIndex = removeFromIndex(idx.content, slug);
            newIndex = addToIndex(newIndex, post.date, r.type, slug, r.desc);
            return multiCommit(token, 'edit: update ' + slug, [
              { path: 'posts/' + slug + '.html', content: postHtml },
              { path: 'index.html', content: newIndex }
            ]);
          }
        });
      });
    });
  }

  function deleteEntry(slug, token) {
    showDeleteConfirm(slug, function() {
      return getFile('posts/' + slug + '.html', token).then(function(file) {
        var post = parsePost(file.content);
        return getFile('index.html', token).then(function(idx) {
          var newIndex = removeFromIndex(idx.content, slug);
          var files = [
            { path: 'posts/' + slug + '.html', delete: true },
            { path: 'index.html', content: newIndex }
          ];
          var adj = [];
          if (post.prevSlug) {
            adj.push(getFile('posts/' + post.prevSlug + '.html', token).then(function(f) {
              files.push({ path: 'posts/' + post.prevSlug + '.html',
                content: updatePostNav(f.content, parsePost(f.content).prevSlug, post.nextSlug) });
            }));
          }
          if (post.nextSlug) {
            adj.push(getFile('posts/' + post.nextSlug + '.html', token).then(function(f) {
              files.push({ path: 'posts/' + post.nextSlug + '.html',
                content: updatePostNav(f.content, post.prevSlug, parsePost(f.content).nextSlug) });
            }));
          }
          return Promise.all(adj).then(function() {
            return multiCommit(token, 'delete: remove ' + slug, files);
          });
        });
      });
    });
  }

  // ====== Public API ======

  window.__editor = {
    newEntry: function() { requireAuth().then(newEntry).catch(function(){}); },
    editEntry: function(slug) { requireAuth().then(function(t) { editEntry(slug, t); }).catch(function(){}); },
    deleteEntry: function(slug) { requireAuth().then(function(t) { deleteEntry(slug, t); }).catch(function(){}); },
    clearToken: function() { localStorage.removeItem('vimsite_token'); }
  };
})();
