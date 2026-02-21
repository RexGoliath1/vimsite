/* log — main.js — minimal */

(function() {
  'use strict';

  // vim j/k/↑/↓/Enter nav on ls table rows
  var rows = document.querySelectorAll('.ls-table tbody tr');
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
    // Backspace — go back to ~/log (from post pages)
    else if (e.key === 'Backspace') {
      var back = document.querySelector('.post-nav a[href*="index"]') ||
                 document.querySelector('nav a[href*="index"]');
      if (back) {
        e.preventDefault();
        back.click();
      }
    }
  });

  // viz module registry — agents register here, containers bind on load
  window.__vizModules = window.__vizModules || {};
  document.querySelectorAll('.viz-embed[data-viz]').forEach(function(el) {
    var mod = window.__vizModules[el.dataset.viz];
    if (mod) mod(el);
  });

})();
