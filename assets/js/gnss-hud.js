/**
 * gnss-hud.js — HUD manager for GNSS constellation WebGL visualizer
 * Loaded as <script type="module"> from gnss.html.
 * No bundler, no npm deps — plain ES module syntax only.
 */

// ─── module state ────────────────────────────────────────────────────────────

let wasm = null;
let paused = false;
let clockRafId = null;
let scrubberIntervalId = null;

const CHICAGO_LAT = 41.85;
const CHICAGO_LON = -87.65;
const TLE_URL = '/api/tle/gnss';
const TLE_CACHE_KEY = TLE_URL;
const TLE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

const CONSTELLATION_IDS = ['gps', 'glonass', 'galileo', 'beidou', 'qzss', 'navic', 'other'];

// current observer position (readable by getObserverLatLon)
let observerLat = CHICAGO_LAT;
let observerLon = CHICAGO_LON;

// set to true once the user explicitly presses ↵ — prevents geolocation
// from silently overwriting their manual entry
let locationManuallySet = false;

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Call once after `await init()`. Wires all HUD controls to WASM exports.
 * @param {object} wasmModule - the wasm-bindgen module object
 */
export function initHud(wasmModule) {
  wasm = wasmModule;

  wireConstellationToggles();
  wireVisibleOnlyToggle();
  wireElevMaskSlider();
  wireOverlayToggles();
  wireGroundLocation();
  wireTimeControls();
  startClockDisplay();
  startScrubberSync();
  startPrnListUpdater();

  // async work — do not block caller
  fetchAndApplyGeolocation();
  fetchAndInjectTles();
  fetchAndInjectBorders();
}

/**
 * Returns the current observer lat/lon.
 * @returns {{ lat: number, lon: number }}
 */
export function getObserverLatLon() {
  return { lat: observerLat, lon: observerLon };
}

// ─── constellation toggles ───────────────────────────────────────────────────

function wireConstellationToggles() {
  CONSTELLATION_IDS.forEach((name, idx) => {
    const el = document.getElementById(`toggle-${name}`);
    if (!el) return;
    el.addEventListener('change', () => {
      wasm.toggle_constellation(idx, el.checked);
    });
  });
}

// ─── visible-only toggle ─────────────────────────────────────────────────────

function wireVisibleOnlyToggle() {
  const el = document.getElementById('toggle-visible-only');
  if (!el) return;
  el.addEventListener('change', () => {
    wasm.set_visible_only(el.checked);
  });
}

// ─── elevation mask slider ───────────────────────────────────────────────────

function wireElevMaskSlider() {
  const slider = document.getElementById('elev-mask-slider');
  const label = document.getElementById('elev-mask-value');
  if (!slider) return;
  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    if (label) label.textContent = `${v}°`;
    if (wasm.set_elev_mask) wasm.set_elev_mask(v);
  });
}

// ─── overlay toggles ─────────────────────────────────────────────────────────

function wireOverlayToggles() {
  const toggles = [
    { id: 'toggle-inc-rings', fn: 'set_show_inc_rings' },
    { id: 'toggle-ecef-axes', fn: 'set_show_ecef_axes' },
    { id: 'toggle-eci-axes', fn: 'set_show_eci_axes' },
    { id: 'toggle-borders', fn: 'set_show_borders' },
    { id: 'toggle-elev-cone', fn: 'set_show_elev_cone' },
    { id: 'toggle-los-lines', fn: 'set_show_los_lines' },
  ];
  for (const { id, fn } of toggles) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('change', () => {
      if (wasm[fn]) wasm[fn](el.checked);
    });
    // Set initial WASM state
    if (wasm[fn]) wasm[fn](el.checked);
  }
}

// ─── Satellite short-label helper ─────────────────────────────────────────────
// Derives a stable 2-char label from a Celestrak TLE OBJECT_NAME by checking
// the parenthetical designator first (most authoritative), then the base name.
//
// Actual Celestrak formats (verified against live data):
//   GPS:     "GPS BIIF-1  (PRN 25)"     → G25   (PRN is the signal PRN)
//   BeiDou:  "BEIDOU-3 M1 (C19)"        → C19   (CXX is the BDS PRN slot)
//   Galileo: "GSAT0201 (GALILEO 5)"     → E05   (FOC deployment sequence)
//            "GSAT0102 (GALILEO-FM2)"   → E02   (IOV flight model number)
//            "GSAT0101 (GALILEO-PFM)"   → no digit → fallback E01
//   GLONASS: "COSMOS 2433 (720)"        → R33   (last 2 of COSMOS number)
//   QZSS:    "MICHIBIKI-2"              → J02   (Michibiki number)
//   NavIC:   "IRNSS-1A"                → I01   (letter suffix A=1, B=2, …)
// Falls back to prefix + (fallbackN+1) when no number can be extracted.
export function satShortLabel(name, constellation, fallbackN) {
  const PREFIXES = ['G', 'R', 'E', 'C', 'J', 'I', 'A']; // A = Augmentation (SBAS/other)
  const prefix = PREFIXES[constellation] ?? '?';
  if (name) {
    // GPS: "(PRN 25)" → G25
    const prnMatch = name.match(/\(PRN\s*(\d+)\)/i);
    if (prnMatch) return 'G' + prnMatch[1].padStart(2, '0');
    // BeiDou: "(C19)" → C19  (actual BDS PRN slot — ALL BeiDou sats have this)
    const bdsMatch = name.match(/\(C(\d{1,3})\)/);
    if (bdsMatch) return 'C' + bdsMatch[1].padStart(2, '0');
    // Galileo FOC: "(GALILEO 5)" → E05, "(GALILEO-FM2)" → E02
    const galMatch = name.match(/\(GALILEO[- ]*(?:FM)?(\d+)\)/i);
    if (galMatch) return 'E' + galMatch[1].padStart(2, '0');
    // QZSS: "MICHIBIKI-2" → J02, "MICHIBIKI-1R" → J01 (take first digit)
    const qzssMatch = name.match(/MICHIBIKI[-\s]*(\d+)/i);
    if (qzssMatch) return 'J' + qzssMatch[1].padStart(2, '0');
    // NavIC/IRNSS: "IRNSS-1A" → I01, "IRNSS-1B" → I02, … (A=1, B=2, …)
    const navicMatch = name.match(/IRNSS[-\s]*\d+([A-I])/i);
    if (navicMatch) {
      const n = navicMatch[1].toUpperCase().charCodeAt(0) - 64; // A→1, B→2, …
      return 'I' + String(n).padStart(2, '0');
    }
    // Fallback: strip parens, take last number from base name
    // GLONASS "COSMOS 2433" → last 2 of "2433" = "R33"
    const base = name.replace(/\(.*?\)/g, '').trim();
    const numMatch = base.match(/(\d+)\s*$/);
    if (numMatch) return prefix + numMatch[1].slice(-2).padStart(2, '0');
  }
  return prefix + String(fallbackN + 1).padStart(2, '0');
}

// ─── PRN list updater ─────────────────────────────────────────────────────────

// Lazily imported — set by initHud() after the module is loaded.
let _pushDopSample = null;
export function setDopSamplePusher(fn) {
  _pushDopSample = fn;
}

const CONST_COLORS_HEX = ['#39ff14', '#ff4444', '#00ffcc', '#ffaa00', '#a050ff', '#ff50a0', '#808080'];
const CONST_NAMES = ['GPS', 'GLO', 'GAL', 'BDS', 'QZS', 'NAV', 'OTH'];

function startPrnListUpdater() {
  const container = document.getElementById('prn-list');
  if (!container) return;
  setInterval(() => {
    // ── PRN badges ──────────────────────────────────────────────────────────
    let sats;
    try {
      sats = wasm.get_sky_data();
    } catch {
      return;
    }
    if (!Array.isArray(sats)) return;
    // Group by constellation
    const byConst = {};
    for (const sat of sats) {
      const c = sat.constellation;
      if (!byConst[c]) byConst[c] = [];
      byConst[c].push(sat);
    }
    let html = '';
    for (const [c, group] of Object.entries(byConst)) {
      const ci = Number(c);
      const color = CONST_COLORS_HEX[ci] || '#808080';
      // Sort by elevation descending
      group.sort((a, b) => b.el_deg - a.el_deg);
      const boxes = group
        .map((sat, i) => {
          const label = satShortLabel(sat.name, ci, i);
          return `<span style="display:inline-block;background:${color};color:#000;width:18px;height:18px;line-height:18px;text-align:center;font-size:0.6rem;font-weight:600;margin:1px 1px 1px 0;border-radius:2px">${label}</span>`;
        })
        .join('');
      html += `<div style="margin-bottom:2px">${boxes}</div>`;
    }
    container.innerHTML = html || '<span style="color:#3a6a3a">no sats</span>';

    // ── DOP update ──────────────────────────────────────────────────────────
    updateDop();
  }, 1000);
}

function updateDop() {
  if (!wasm.get_dop) return;
  let dopData;
  try {
    dopData = wasm.get_dop();
  } catch {
    return;
  }
  if (!dopData) return;

  const { combined, by_constellation } = dopData;
  if (!combined) return;

  // Combined DOP row in right panel
  const combinedEl = document.getElementById('dop-combined');
  if (combinedEl) {
    combinedEl.innerHTML = renderCombinedDop(combined);
  }

  // Push to DOP history graph
  let simEpoch = 0;
  try {
    simEpoch = wasm.get_sim_epoch ? wasm.get_sim_epoch() : Date.now() / 1000;
  } catch { /* ignore */ }
  if (_pushDopSample) _pushDopSample(simEpoch, combined);

  // Per-constellation DOP badges in left panel
  const constEl = document.getElementById('dop-by-const');
  if (constEl && Array.isArray(by_constellation)) {
    constEl.innerHTML = by_constellation
      .map((d) => {
        const color = CONST_COLORS_HEX[d.idx] || '#808080';
        const name = CONST_NAMES[d.idx] || '???';
        const pdopStr = d.n_sats < 4 ? 'N/A' : d.pdop.toFixed(1);
        return (
          `<span style="display:inline-flex;align-items:center;gap:3px;margin:1px 4px 1px 0;font-size:0.72rem">` +
          `<span style="color:${color}">●</span>` +
          `<span style="color:#7ab87a">${name}</span>` +
          `<span style="color:#9dd49d;font-weight:600">${pdopStr}</span>` +
          `</span>`
        );
      })
      .join('');
  }
}

function renderCombinedDop(d) {
  const fmt = (v) => (v >= 90 ? '<span style="color:#3a6a3a">N/A</span>' : `<span style="color:#9dd49d;font-weight:600">${v.toFixed(1)}</span>`);
  return (
    `<span style="color:#5a9a5a;font-size:0.7rem">GDOP</span>${fmt(d.gdop)} ` +
    `<span style="color:#5a9a5a;font-size:0.7rem">PDOP</span>${fmt(d.pdop)} ` +
    `<span style="color:#5a9a5a;font-size:0.7rem">HDOP</span>${fmt(d.hdop)} ` +
    `<span style="color:#5a9a5a;font-size:0.7rem">VDOP</span>${fmt(d.vdop)}`
  );
}

// ─── ground location ─────────────────────────────────────────────────────────

function wireGroundLocation() {
  const btn = document.getElementById('btn-set-location');
  if (!btn) return;
  btn.addEventListener('click', applyManualLocation);

  // Also trigger on Enter in either lat/lon input
  const latEl = document.getElementById('ground-lat');
  const lonEl = document.getElementById('ground-lon');
  for (const el of [latEl, lonEl]) {
    if (el)
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') applyManualLocation();
      });
  }
}

function applyManualLocation() {
  const latEl = document.getElementById('ground-lat');
  const lonEl = document.getElementById('ground-lon');
  if (!latEl || !lonEl) return;
  const lat = parseFloat(latEl.value);
  const lon = parseFloat(lonEl.value);
  if (!isFinite(lat) || !isFinite(lon)) return;
  locationManuallySet = true;
  setObserverLocation(lat, lon);
}

function setObserverLocation(lat, lon) {
  observerLat = lat;
  observerLon = lon;
  wasm.set_ground_location(lat, lon);
  updateLocationInputs(lat, lon);
}

function updateLocationInputs(lat, lon) {
  const latEl = document.getElementById('ground-lat');
  const lonEl = document.getElementById('ground-lon');
  if (latEl) latEl.value = lat.toFixed(4);
  if (lonEl) lonEl.value = lon.toFixed(4);
}

// ─── time controls ───────────────────────────────────────────────────────────

function wireTimeControls() {
  const btnPause = document.getElementById('btn-pause');
  const btnReset = document.getElementById('btn-reset-time');
  const scrubber = document.getElementById('time-scrubber');

  if (btnPause) {
    btnPause.addEventListener('click', () => {
      paused = !paused;
      wasm.set_paused(paused);
      btnPause.textContent = paused ? '▶' : '⏸';
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      const nowS = Date.now() / 1000;
      wasm.set_sim_epoch(nowS);
      document.dispatchEvent(new CustomEvent('gnss:time-reset'));
    });
  }

  if (scrubber) {
    scrubber.addEventListener('change', () => {
      const epochS = parseDatetimeLocal(scrubber.value);
      if (epochS !== null) wasm.set_sim_epoch(epochS);
    });
  }

  // Auto-pause when the tab is hidden; restore state when visible again.
  let pausedBeforeHide = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pausedBeforeHide = paused;
      if (!paused) {
        paused = true;
        wasm.set_paused(true);
        if (btnPause) btnPause.textContent = '▶';
      }
    } else {
      if (!pausedBeforeHide && paused) {
        paused = false;
        wasm.set_paused(false);
        if (btnPause) btnPause.textContent = '⏸';
      }
    }
  });

  // wire time warp slider (already exists in gnss.html; reinforce in case it loaded after inline script)
  wireTimeWarpSlider();
}

/**
 * Convert log-scale slider position (0–100) to warp multiplier.
 * 0 → 1×, 100 → 10^9 (~31.7 years/sec). Formula: 10^(v * 9 / 100).
 */
function sliderToWarp(v) {
  return Math.max(1, Math.round(Math.pow(10, (v * 9) / 100)));
}

/** Human-readable time-rate label for a given warp multiplier. */
function warpLabel(w) {
  if (w < 60) return `${w}×`;
  if (w < 3_600) return `${w}× (${(w / 60).toFixed(0)}m/s)`;
  if (w < 86_400) return `${w}× (${(w / 3_600).toFixed(1)}h/s)`;
  if (w < 604_800) return `${(w / 86_400).toFixed(1)}d/s`;
  if (w < 31_536_000) return `${(w / 604_800).toFixed(1)}wk/s`;
  return `${(w / 31_536_000).toFixed(1)}yr/s`;
}

function wireTimeWarpSlider() {
  const slider = document.getElementById('time-warp-slider');
  const label = document.getElementById('time-warp-value');
  if (!slider) return;
  // Push the slider's current HTML default into WASM state immediately
  const initial = sliderToWarp(Number(slider.value));
  wasm.set_time_warp(initial);
  if (label) label.textContent = warpLabel(initial);
  // Update WASM state on every slider change
  slider.addEventListener('input', () => {
    const w = sliderToWarp(Number(slider.value));
    wasm.set_time_warp(w);
    if (label) label.textContent = warpLabel(w);
  });
}

// ─── clock display ───────────────────────────────────────────────────────────

function startClockDisplay() {
  const clockEl = document.getElementById('hud-clock');
  if (!clockEl) return;

  let lastTick = 0;

  function tick(now) {
    clockRafId = requestAnimationFrame(tick);
    if (now - lastTick < 500) return;
    lastTick = now;

    try {
      const epochS = wasm.get_sim_epoch();
      clockEl.textContent = formatUtcClock(epochS);
    } catch (e) {
      console.error('[gnss-hud] clock read failed:', e);
    }
  }

  clockRafId = requestAnimationFrame(tick);
}

function formatUtcClock(epochS) {
  const d = new Date(epochS * 1000);
  // toUTCString → "Thu, 20 Feb 2026 14:30:00 GMT" — strip seconds
  return d
    .toUTCString()
    .replace(/:\d{2} gmt$/i, ' utc')
    .toLowerCase();
}

// ─── scrubber sync ───────────────────────────────────────────────────────────

function startScrubberSync() {
  const scrubber = document.getElementById('time-scrubber');
  if (!scrubber) return;

  scrubberIntervalId = setInterval(() => {
    // only update when user isn't actively interacting
    if (document.activeElement === scrubber) return;
    try {
      const epochS = wasm.get_sim_epoch();
      scrubber.value = epochToDatetimeLocal(epochS);
    } catch (e) {
      console.error('[gnss-hud] scrubber sync failed:', e);
    }
  }, 2000);
}

// ─── Country borders fetch ────────────────────────────────────────────────────

const BORDERS_LOCAL_URL = '/assets/data/borders-110m.json';
const BORDERS_CDN_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

async function fetchAndInjectBorders() {
  if (!wasm.inject_borders) return; // WASM export not available
  try {
    let res = await fetch(BORDERS_LOCAL_URL);
    if (!res.ok) throw new Error(`local borders HTTP ${res.status}`);
    const json = await res.text();
    wasm.inject_borders(json);
  } catch (e) {
    console.warn('[gnss-hud] local borders failed, trying CDN:', e);
    try {
      // CDN fallback — world-atlas TopoJSON, but our WASM expects the pre-processed
      // segments format. The CDN file is a different format, so only the local copy
      // is usable. Log and give up gracefully.
      console.warn('[gnss-hud] CDN borders not compatible — borders disabled');
    } catch (_) {
      /* silent */
    }
  }
}

// ─── TLE fetch ───────────────────────────────────────────────────────────────

function setPropMode(mode, hudText, bannerText) {
  const statusEl = document.getElementById('tle-status');
  const banner = document.getElementById('prop-mode');
  const bannerText_ = document.getElementById('prop-mode-text');
  if (statusEl) {
    statusEl.textContent = hudText;
    statusEl.dataset.mode = mode;
  }
  if (banner) banner.dataset.mode = mode;
  if (bannerText_) bannerText_.textContent = bannerText;
}

async function fetchAndInjectTles() {
  setPropMode('loading', 'keplerian (loading…)', '⚠ keplerian fallback — loading TLE data…');

  try {
    const jsonText = await fetchTleWithCache();
    wasm.inject_tles(jsonText);
    // Verify the WASM actually parsed the records (get_tle_count() returns 0 on
    // JSON parse failure, which inject_tles() silently swallows).
    const loaded = wasm.get_tle_count ? wasm.get_tle_count() : -1;
    if (loaded === 0) {
      throw new Error('TLE JSON parsed to 0 records — likely a bad cache entry');
    }
    const countStr = loaded > 0 ? ` · ${loaded} sats` : '';
    setPropMode('live', 'live tle', `● SGP4 · live TLE${countStr}`);
  } catch (e) {
    console.error('[gnss-hud] TLE fetch failed:', e);
    setPropMode(
      'fallback',
      'keplerian (offline)',
      '⚠ keplerian fallback — TLE unavailable · approximate orbits',
    );
  }
}

async function fetchTleWithCache() {
  if (!('caches' in window)) {
    // Cache API not available — fetch directly
    return fetchTleDirect();
  }

  const cache = await caches.open('gnss-tle-v1');
  const cached = await cache.match(TLE_CACHE_KEY);

  if (cached) {
    const fetchedAt = Number(cached.headers.get('x-fetched-at') ?? 0);
    if (Date.now() - fetchedAt < TLE_TTL_MS) {
      const text = await cached.text();
      // Validate the cached response is a non-empty JSON array.
      // If it's an HTML error page or empty, delete it and fetch fresh.
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return text;
        }
      } catch {
        /* fall through */
      }
      console.warn('[gnss-hud] cached TLE response is invalid — deleting and re-fetching');
      await cache.delete(TLE_CACHE_KEY);
    }
  }

  const text = await fetchTleDirect();
  // Only cache valid JSON arrays so a bad Celestrak response doesn't get stuck.
  let validToCache = false;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.length > 0) validToCache = true;
  } catch {
    /* leave validToCache = false */
  }
  if (validToCache) {
    const headers = new Headers({
      'content-type': 'application/json',
      'x-fetched-at': String(Date.now()),
    });
    await cache.put(TLE_CACHE_KEY, new Response(text, { headers }));
  }
  return text;
}

async function fetchTleDirect() {
  const res = await fetch(TLE_URL);
  if (!res.ok) throw new Error(`TLE fetch HTTP ${res.status}`);
  return res.text();
}

// ─── IP geolocation ──────────────────────────────────────────────────────────

async function fetchAndApplyGeolocation() {
  try {
    const res = await fetch('https://ipapi.co/json/');
    if (!res.ok) throw new Error(`ipapi HTTP ${res.status}`);
    const data = await res.json();
    const lat = Number(data.latitude);
    const lon = Number(data.longitude);
    if (!isFinite(lat) || !isFinite(lon)) throw new Error('invalid coords');
    // Don't override a location the user already set manually
    if (locationManuallySet) return;
    setObserverLocation(lat, lon);
  } catch (e) {
    console.error('[gnss-hud] geolocation failed, using chicago default:', e);
    if (!locationManuallySet) setObserverLocation(CHICAGO_LAT, CHICAGO_LON);
  }
}

// ─── datetime helpers ────────────────────────────────────────────────────────

/**
 * Parse a datetime-local string ("YYYY-MM-DDTHH:MM") as UTC → Unix seconds.
 * @param {string} value
 * @returns {number|null}
 */
function parseDatetimeLocal(value) {
  if (!value) return null;
  const ms = Date.parse(value + 'Z'); // treat as UTC
  return isNaN(ms) ? null : ms / 1000;
}

/**
 * Convert Unix seconds → datetime-local string ("YYYY-MM-DDTHH:MM") in UTC.
 * @param {number} epochS
 * @returns {string}
 */
function epochToDatetimeLocal(epochS) {
  const d = new Date(epochS * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}
