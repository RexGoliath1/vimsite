/* log — main.js — minimal */

(function() {
  'use strict';

  // --- J2000 day number (days since 2000-01-01 12:00 TT) ---
  function j2000(y, m, d) {
    var a = Math.floor((14 - m) / 12);
    var yy = y + 4800 - a;
    var mm = m + 12 * a - 3;
    var jdn = d + Math.floor((153 * mm + 2) / 5) + 365 * yy +
              Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
    return jdn - 2451545;
  }

  function injectJ2000() {
    // index page: .ls-date[data-date]
    document.querySelectorAll('.ls-date[data-date]').forEach(function(el) {
      var p = el.dataset.date.split('-');
      var jd = j2000(+p[0], +p[1], +p[2]);
      var span = document.createElement('span');
      span.className = 'j2000';
      span.textContent = 'J' + jd;
      el.appendChild(span);
    });
    // post pages: time[datetime]
    document.querySelectorAll('.post-meta time[datetime]').forEach(function(el) {
      var p = el.getAttribute('datetime').split('-');
      var jd = j2000(+p[0], +p[1], +p[2]);
      var span = document.createElement('span');
      span.className = 'j2000';
      span.textContent = 'J' + jd;
      el.parentNode.insertBefore(span, el.nextSibling);
    });
  }

  injectJ2000();

  // --- vim j/k/↑/↓/Enter nav on ls table rows (skips group headers) ---
  var rows = document.querySelectorAll('.ls-table tbody tr:not(.ls-group-year):not(.ls-group-month)');
  var cur = -1;

  function select(i) {
    rows.forEach(function(r) { r.classList.remove('selected'); });
    if (i >= 0 && i < rows.length) {
      rows[i].classList.add('selected');
      rows[i].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

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
      var link = rows[cur].querySelector('a');
      if (link) link.click();
    }
    // ArrowLeft — prev (newer) post
    else if (e.key === 'ArrowLeft') {
      var prev = document.querySelector('.post-nav .prev');
      if (prev) { e.preventDefault(); prev.click(); }
    }
    // ArrowRight — next (older) post
    else if (e.key === 'ArrowRight') {
      var next = document.querySelector('.post-nav .next');
      if (next) { e.preventDefault(); next.click(); }
    }
    // Backspace — back to ~/log
    else if (e.key === 'Backspace') {
      var back = document.querySelector('.post-nav .back') ||
                 document.querySelector('nav a[href*="index"]');
      if (back) { e.preventDefault(); back.click(); }
    }
  });

  // --- viz module registry ---
  window.__vizModules = window.__vizModules || {};
  document.querySelectorAll('.viz-embed[data-viz]').forEach(function(el) {
    var mod = window.__vizModules[el.dataset.viz];
    if (mod) mod(el);
  });

})();
