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
const TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=gnss&FORMAT=json';
const TLE_CACHE_KEY = TLE_URL;
const TLE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

const CONSTELLATION_IDS = ['gps', 'glonass', 'galileo', 'beidou'];

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

// ─── PRN list updater ─────────────────────────────────────────────────────────

function startPrnListUpdater() {
  const container = document.getElementById('prn-list');
  if (!container) return;
  const CONST_PREFIXES = ['G', 'R', 'E', 'C', '?'];
  const CONST_COLORS = ['#39ff14', '#ff4444', '#00ffcc', '#ffaa00', '#808080'];
  setInterval(() => {
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
      const color = CONST_COLORS[ci] || '#808080';
      const prefix = CONST_PREFIXES[ci] || '?';
      // Sort by elevation descending
      group.sort((a, b) => b.el_deg - a.el_deg);
      const boxes = group
        .map((_, i) => {
          const prn = String(i + 1).padStart(2, '0');
          return `<span style="display:inline-block;background:${color};color:#000;width:18px;height:18px;line-height:18px;text-align:center;font-size:0.6rem;font-weight:600;margin:1px 1px 1px 0;border-radius:2px">${prefix}${prn}</span>`;
        })
        .join('');
      html += `<div style="margin-bottom:2px">${boxes}</div>`;
    }
    container.innerHTML = html || '<span style="color:#3a6a3a">no sats</span>';
  }, 1000);
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

async function fetchAndInjectTles() {
  const statusEl = document.getElementById('tle-status');

  // Show fallback state immediately — user sees this during the async fetch
  if (statusEl) {
    statusEl.textContent = 'keplerian (loading…)';
    statusEl.dataset.mode = 'fallback';
  }

  try {
    const jsonText = await fetchTleWithCache();
    wasm.inject_tles(jsonText);
    if (statusEl) {
      statusEl.textContent = 'live tle';
      statusEl.dataset.mode = 'live';
    }
  } catch (e) {
    console.error('[gnss-hud] TLE fetch failed:', e);
    if (statusEl) {
      statusEl.textContent = 'keplerian (offline)';
      statusEl.dataset.mode = 'fallback';
    }
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
      return cached.text();
    }
  }

  const text = await fetchTleDirect();
  const headers = new Headers({
    'content-type': 'application/json',
    'x-fetched-at': String(Date.now()),
  });
  await cache.put(TLE_CACHE_KEY, new Response(text, { headers }));
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
