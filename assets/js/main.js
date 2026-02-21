"use strict";
(() => {
  (function() {
    "use strict";
    function j2000(y, m, d) {
      const a = Math.floor((14 - m) / 12);
      const yy = y + 4800 - a;
      const mm = m + 12 * a - 3;
      const jdn = d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
      return jdn - 2451545;
    }
    function injectJ2000() {
      document.querySelectorAll(".ls-date[data-date]").forEach((el) => {
        const p = (el.dataset.date ?? "").split("-");
        const span = document.createElement("span");
        span.className = "j2000";
        span.textContent = "J" + j2000(+p[0], +p[1], +p[2]);
        el.appendChild(span);
      });
      document.querySelectorAll(".post-meta time[datetime]").forEach((el) => {
        const p = (el.getAttribute("datetime") ?? "").split("-");
        const span = document.createElement("span");
        span.className = "j2000";
        span.textContent = "J" + j2000(+p[0], +p[1], +p[2]);
        el.parentNode?.insertBefore(span, el.nextSibling);
      });
    }
    injectJ2000();
    function loadEditor(fn) {
      if (window.__editor) {
        fn();
        return;
      }
      const s = document.createElement("script");
      const isPost = !!document.querySelector(".post-content");
      s.src = (isPost ? "../" : "") + "assets/js/editor.js";
      s.onload = fn;
      document.head.appendChild(s);
    }
    const rows = document.querySelectorAll(
      ".ls-table tbody tr:not(.ls-group-year):not(.ls-group-month)"
    );
    let cur = -1;
    function select(i) {
      rows.forEach((r) => r.classList.remove("selected"));
      if (i >= 0 && i < rows.length) {
        rows[i].classList.add("selected");
        rows[i].scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
    function getSelectedSlug() {
      if (cur < 0 || !rows[cur]) return null;
      const link = rows[cur].querySelector("a");
      if (!link) return null;
      const m = link.getAttribute("href")?.match(/posts\/([^.]+)\.html/);
      return m ? m[1] : null;
    }
    function getCurrentSlug() {
      const m = location.pathname.match(/posts\/([^.]+)\.html/);
      return m ? m[1] : null;
    }
    document.addEventListener("keydown", (e) => {
      const target = e.target;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (document.querySelector(".editor-overlay")) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        if (!rows.length) return;
        e.preventDefault();
        cur = Math.min(cur + 1, rows.length - 1);
        select(cur);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        if (!rows.length) return;
        e.preventDefault();
        cur = Math.max(cur - 1, 0);
        select(cur);
      } else if (e.key === "Enter" && cur >= 0) {
        const link = rows[cur].querySelector("a");
        if (link) link.click();
      } else if (e.key === "ArrowLeft") {
        const prev = document.querySelector(".post-nav .prev");
        if (prev) {
          e.preventDefault();
          prev.click();
        }
      } else if (e.key === "ArrowRight") {
        const next = document.querySelector(".post-nav .next");
        if (next) {
          e.preventDefault();
          next.click();
        }
      } else if (e.key === "Backspace") {
        const back = document.querySelector(".post-nav .back") ?? document.querySelector('nav a[href*="index"]');
        if (back) {
          e.preventDefault();
          back.click();
        }
      } else if (e.key === "n" && !document.querySelector(".post-content")) {
        e.preventDefault();
        loadEditor(() => window.__editor?.newEntry());
      } else if (e.key === "e") {
        const slug = document.querySelector(".post-content") ? getCurrentSlug() : getSelectedSlug();
        if (slug) {
          e.preventDefault();
          loadEditor(() => window.__editor?.editEntry(slug));
        }
      } else if (e.key === "d" && !document.querySelector(".post-content")) {
        const slug = getSelectedSlug();
        if (slug) {
          e.preventDefault();
          loadEditor(() => window.__editor?.deleteEntry(slug));
        }
      }
    });
    window.__vizModules = window.__vizModules || {};
    document.querySelectorAll(".viz-embed[data-viz]").forEach((el) => {
      const mod = window.__vizModules[el.dataset.viz ?? ""];
      if (mod) mod(el);
    });
  })();
})();
