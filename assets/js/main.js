/* steven's log — main.js — minimal */

(function() {
  'use strict';

  // vim j/k/Enter nav on ls table rows
  const rows = document.querySelectorAll('.ls-table tbody tr');
  let cur = -1;

  function select(i) {
    rows.forEach(r => r.classList.remove('selected'));
    if (i >= 0 && i < rows.length) {
      rows[i].classList.add('selected');
      rows[i].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (!rows.length) return;

    if (e.key === 'j') {
      cur = Math.min(cur + 1, rows.length - 1);
      select(cur);
    } else if (e.key === 'k') {
      cur = Math.max(cur - 1, 0);
      select(cur);
    } else if (e.key === 'Enter' && cur >= 0) {
      var link = rows[cur].querySelector('a');
      if (link) link.click();
    }
  });

  // viz module registry — agents register here, containers bind on load
  window.__vizModules = window.__vizModules || {};
  document.querySelectorAll('.viz-embed[data-viz]').forEach(function(el) {
    var mod = window.__vizModules[el.dataset.viz];
    if (mod) mod(el);
  });

})();
