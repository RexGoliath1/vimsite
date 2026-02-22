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

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Call once after `await init()`. Wires all HUD controls to WASM exports.
 * @param {object} wasmModule - the wasm-bindgen module object
 */
export function initHud(wasmModule) {
  wasm = wasmModule;

  wireConstellationToggles();
  wireVisibleOnlyToggle();
  wireGroundLocation();
  wireTimeControls();
  startClockDisplay();
  startScrubberSync();

  // async work — do not block caller
  fetchAndApplyGeolocation();
  fetchAndInjectTles();
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

// ─── ground location ─────────────────────────────────────────────────────────

function wireGroundLocation() {
  const btn = document.getElementById('btn-set-location');
  if (!btn) return;
  btn.addEventListener('click', applyManualLocation);
}

function applyManualLocation() {
  const latEl = document.getElementById('ground-lat');
  const lonEl = document.getElementById('ground-lon');
  if (!latEl || !lonEl) return;
  const lat = parseFloat(latEl.value);
  const lon = parseFloat(lonEl.value);
  if (!isFinite(lat) || !isFinite(lon)) return;
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

function wireTimeWarpSlider() {
  const slider = document.getElementById('time-warp-slider');
  const label = document.getElementById('time-warp-value');
  if (!slider) return;
  // sync initial value
  if (typeof window.__gnssTimeWarp === 'number') {
    slider.value = String(window.__gnssTimeWarp);
    if (label) label.textContent = `${window.__gnssTimeWarp}×`;
  }
  // The inline script owns the listener; we only update window.__gnssTimeWarp
  // if it hasn't been set up yet (defensive fallback).
  if (!slider.dataset.hudWired) {
    slider.dataset.hudWired = '1';
    slider.addEventListener('input', () => {
      const v = Number(slider.value);
      window.__gnssTimeWarp = v;
      if (label) label.textContent = `${v}×`;
    });
  }
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
  return d.toUTCString().replace(/:\d{2} gmt$/i, ' utc').toLowerCase();
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

// ─── TLE fetch ───────────────────────────────────────────────────────────────

async function fetchAndInjectTles() {
  const statusEl = document.getElementById('tle-status');

  try {
    const jsonText = await fetchTleWithCache();
    wasm.inject_tles(jsonText);
    if (statusEl) statusEl.textContent = 'live tle';
  } catch (e) {
    console.error('[gnss-hud] TLE fetch failed:', e);
    if (statusEl) statusEl.textContent = 'keplerian (offline)';
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
  const headers = new Headers({ 'content-type': 'application/json', 'x-fetched-at': String(Date.now()) });
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
    setObserverLocation(lat, lon);
  } catch (e) {
    console.error('[gnss-hud] geolocation failed, using chicago default:', e);
    setObserverLocation(CHICAGO_LAT, CHICAGO_LON);
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
