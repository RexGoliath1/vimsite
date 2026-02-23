/**
 * gnss-skyplot.js — 2D sky plot renderer for GNSS constellation visualizer
 *
 * Renders a polar coordinate diagram (sky plot) showing satellite positions
 * as seen from a ground location. Center = zenith, edge = horizon.
 *
 * Exports:
 *   initSkyPlot(wasmModule)     — starts the render loop
 *   renderSkyPlot(ctx, sats, width, height) — pure render function
 */

import { satShortLabel } from '/assets/js/gnss-hud.js';

const COLORS = {
  background: '#000000',
  ring: '#2a5a2a', // was ringDimGreen — brighter rings
  compassLabel: '#6ab86a', // was "#2a6a2a" — clearly readable
  ringLabel: '#5aaa5a', // was "#3a5a3a"
  crosshair: '#1a3a1a', // was "#0f2a0f" — slightly brighter
  panelTitle: '#7acc7a', // was "#2a6a2a"
  zenith: '#3a7a3a', // was "#1a3a1a"
};

const FONT_FAMILY = 'IBM Plex Mono, monospace';

// Trail history: key = `${constellation}-${sat_index}`, value = array of
// {nx, ny, ts, r, g, b} entries. Wall-clock timestamps so trails fade at
// real speed regardless of sim warp.
const _trailHistory = new Map();
const TRAIL_DURATION_MS = 20_000; // 20 seconds wall clock
const TRAIL_MAX_POINTS = 120; // cap to avoid unbounded growth

let _lastRenderTime = 0;
const RENDER_INTERVAL_MS = 500; // ~2 fps

/**
 * initSkyPlot — find #sky-plot-canvas, wire up the WASM module, start render loop.
 * @param {object} wasmModule — WASM module with .get_sky_data() method
 */
export function initSkyPlot(wasmModule) {
  const canvas = document.getElementById('sky-plot-canvas');
  if (!canvas) {
    console.warn('[gnss-skyplot] #sky-plot-canvas not found');
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const logicalSize = 260;

  // Scale canvas backing store for crisp rendering on HiDPI displays
  canvas.width = logicalSize * dpr;
  canvas.height = logicalSize * dpr;
  canvas.style.width = logicalSize + 'px';
  canvas.style.height = logicalSize + 'px';

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.warn('[gnss-skyplot] Could not get 2D context from #sky-plot-canvas');
    return;
  }

  // Scale all drawing commands by dpr so logical coords work naturally
  ctx.scale(dpr, dpr);

  // Clear trail history when simulation time is reset
  document.addEventListener('gnss:time-reset', () => {
    _trailHistory.clear();
  });

  function loop(timestamp) {
    if (timestamp - _lastRenderTime >= RENDER_INTERVAL_MS) {
      _lastRenderTime = timestamp;

      let sats = [];
      try {
        sats = wasmModule.get_sky_data();
      } catch (err) {
        console.error('[gnss-skyplot] get_sky_data() failed:', err);
      }

      // Dynamic trail cap: at high warp each frame covers many sim-seconds of
      // arc. Cap points so total trail spans at most ~1800 sim-seconds, keeping
      // the sky plot legible. Formula: points = 1800 / (interval_s * warp).
      const _sliderEl = document.getElementById('time-warp-slider');
      const _warpMultiplier = _sliderEl
        ? Math.max(1, Math.round(Math.pow(10, (Number(_sliderEl.value) * 9) / 100)))
        : 1;
      const _dynamicMax = Math.max(
        3,
        Math.min(TRAIL_MAX_POINTS, Math.round(1800 / ((RENDER_INTERVAL_MS / 1000) * _warpMultiplier))),
      );

      // Update trail history
      const now = performance.now();
      // Prune old entries across all trails
      for (const [key, trail] of _trailHistory) {
        const pruned = trail.filter((p) => now - p.ts < TRAIL_DURATION_MS);
        if (pruned.length === 0) _trailHistory.delete(key);
        else _trailHistory.set(key, pruned);
      }
      // Record current positions
      // Group sats by constellation to assign stable per-constellation indices
      const constCounts = {};
      for (const sat of sats) {
        const c = sat.constellation;
        if (constCounts[c] === undefined) constCounts[c] = 0;
        const idx = constCounts[c]++;
        const key = `${c}-${idx}`;
        const el = Math.max(0, Math.min(90, sat.el_deg));
        const fraction = (90 - el) / 90;
        // Store normalized polar coords (will be scaled to plotRadius in render)
        const azRad = (sat.az_deg * Math.PI) / 180;
        const nx = fraction * Math.sin(azRad); // normalized x (-1..1)
        const ny = fraction * Math.cos(azRad); // normalized y (-1..1)
        const trail = _trailHistory.get(key) || [];
        trail.push({ nx, ny, ts: now, r: sat.r, g: sat.g, b: sat.b });
        if (trail.length > _dynamicMax) trail.shift();
        _trailHistory.set(key, trail);
      }

      // Read current observer location from DOM inputs for the label
      const latEl = document.getElementById('ground-lat');
      const lonEl = document.getElementById('ground-lon');
      const latVal = latEl ? parseFloat(latEl.value) : NaN;
      const lonVal = lonEl ? parseFloat(lonEl.value) : NaN;
      const locationLabel =
        isFinite(latVal) && isFinite(lonVal)
          ? `${latVal.toFixed(2)}° ${lonVal.toFixed(2)}°`
          : 'sky';

      renderSkyPlot(ctx, sats, logicalSize, logicalSize, locationLabel, _trailHistory);
    }

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

/**
 * renderSkyPlot — pure function, renders one frame of the sky plot.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{name: string, constellation: number, az_deg: number, el_deg: number, r: number, g: number, b: number, c_n0: number}>} sats
 * @param {number} width  — logical canvas width (before dpr scaling)
 * @param {number} height — logical canvas height (before dpr scaling)
 * @param {string} [locationLabel] — observer label shown at top-left
 * @param {Map|null} [trailHistory] — wall-clock trail history from _trailHistory
 */
export function renderSkyPlot(
  ctx,
  sats,
  width,
  height,
  locationLabel = 'sky',
  trailHistory = null,
) {
  const cx = width / 2;
  const cy = height / 2;
  // Leave a small margin so labels at edge aren't clipped
  const margin = 14;
  const plotRadius = Math.min(cx, cy) - margin;

  // --- Background ---
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  // --- Panel title ---
  ctx.font = `10px ${FONT_FAMILY}`;
  ctx.fillStyle = COLORS.panelTitle;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(locationLabel, 4, 3);

  // --- Crosshairs ---
  ctx.save();
  ctx.strokeStyle = COLORS.crosshair;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 4]);

  ctx.beginPath();
  ctx.moveTo(cx, cy - plotRadius);
  ctx.lineTo(cx, cy + plotRadius);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - plotRadius, cy);
  ctx.lineTo(cx + plotRadius, cy);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.restore();

  // --- Elevation rings at 0°, 30°, 60° ---
  // radius_fraction = (90 - el_deg) / 90
  // el=0  → fraction=1.0 → outer edge
  // el=30 → fraction=0.667
  // el=60 → fraction=0.333
  // el=90 → fraction=0   → center
  const ringElevations = [0, 30, 60];

  ctx.strokeStyle = COLORS.ring;
  ctx.lineWidth = 0.75;

  for (const el of ringElevations) {
    const fraction = (90 - el) / 90;
    const r = plotRadius * fraction;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Elevation label — place slightly inside the ring, at the 225° position
    // (lower-left quadrant) to avoid compass labels
    if (el > 0) {
      const labelAngleRad = (225 * Math.PI) / 180;
      const labelX = cx + r * Math.sin(labelAngleRad);
      const labelY = cy - r * Math.cos(labelAngleRad);

      ctx.font = `9px ${FONT_FAMILY}`;
      ctx.fillStyle = COLORS.ringLabel;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(el + '\u00b0', labelX, labelY);
    }
  }

  // Label "0°" at the horizon ring edge (lower-left, just inside)
  {
    const fraction = 1.0;
    const r = plotRadius * fraction;
    const labelAngleRad = (225 * Math.PI) / 180;
    const labelX = cx + r * Math.sin(labelAngleRad) * 0.88;
    const labelY = cy - r * Math.cos(labelAngleRad) * 0.88;

    ctx.font = `9px ${FONT_FAMILY}`;
    ctx.fillStyle = COLORS.ringLabel;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('0\u00b0', labelX, labelY);
  }

  // --- Zenith dot ---
  ctx.fillStyle = COLORS.zenith;
  ctx.beginPath();
  ctx.arc(cx, cy, 2, 0, Math.PI * 2);
  ctx.fill();

  // --- Compass labels N/S/E/W ---
  const compassOffset = plotRadius + 10;
  const compassPositions = [
    { label: 'N', dx: 0, dy: -1 },
    { label: 'S', dx: 0, dy: 1 },
    { label: 'E', dx: 1, dy: 0 },
    { label: 'W', dx: -1, dy: 0 },
  ];

  ctx.font = `10px ${FONT_FAMILY}`;
  ctx.fillStyle = COLORS.compassLabel;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const { label, dx, dy } of compassPositions) {
    ctx.fillText(label, cx + dx * compassOffset, cy + dy * compassOffset);
  }

  // --- Satellite dots ---
  if (!Array.isArray(sats)) return;

  // --- Trails (fading history) ---
  if (trailHistory) {
    const now = performance.now();
    for (const [key, trail] of trailHistory) {
      if (trail.length < 2) continue;
      for (let i = 1; i < trail.length; i++) {
        const p0 = trail[i - 1];
        const p1 = trail[i];
        const age = now - p1.ts;
        const alpha = Math.max(0, 1 - age / TRAIL_DURATION_MS) * 0.6;
        if (alpha <= 0) continue;
        ctx.beginPath();
        ctx.moveTo(cx + p0.nx * plotRadius, cy - p0.ny * plotRadius);
        ctx.lineTo(cx + p1.nx * plotRadius, cy - p1.ny * plotRadius);
        ctx.strokeStyle = `rgba(${p1.r},${p1.g},${p1.b},${alpha.toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  for (let _si = 0; _si < sats.length; _si++) {
    const sat = sats[_si];
    const { name, az_deg, el_deg, r, g, b } = sat;

    // Clamp elevation to valid range
    const el = Math.max(0, Math.min(90, el_deg));
    const az = az_deg;

    const azRad = (az * Math.PI) / 180;
    const fraction = (90 - el) / 90;
    const dist = plotRadius * fraction;

    // Polar → Cartesian (north up, east right)
    const sx = cx + dist * Math.sin(azRad);
    const sy = cy - dist * Math.cos(azRad);

    // C/N0 signal quality factor (0.0 = weakest, 1.0 = strongest)
    const cn0Factor = sat.c_n0 != null ? Math.min(1, Math.max(0, (sat.c_n0 - 20) / 35)) : 1.0;

    // Dot radius scales with signal quality: 3–6px
    const dotRadius = 3 + cn0Factor * 3;
    // Glow ring radius stays proportional
    const glowRadius = dotRadius + 3;

    const satColor = `rgb(${r},${g},${b})`;
    const satColorDim = `rgba(${r},${g},${b},0.4)`;
    const satLabelColor = `rgba(${r},${g},${b},0.65)`;

    // Glow ring
    ctx.beginPath();
    ctx.arc(sx, sy, glowRadius, 0, Math.PI * 2);
    ctx.strokeStyle = satColorDim;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Filled dot
    ctx.beginPath();
    ctx.arc(sx, sy, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = satColor;
    ctx.fill();

    // Satellite name label (right of dot, 7px)
    ctx.font = `7px ${FONT_FAMILY}`;
    ctx.fillStyle = satLabelColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const label = satShortLabel(name, sat.constellation, _si);
    ctx.fillText(label, sx + glowRadius + 2, sy - 3);

    // C/N0 label below the name label
    if (sat.c_n0 != null) {
      const cn0Label = sat.c_n0.toFixed(0) + 'dB';
      ctx.font = `6px ${FONT_FAMILY}`;
      ctx.fillStyle = `rgba(${r},${g},${b},0.5)`;
      ctx.fillText(cn0Label, sx + glowRadius + 2, sy + 5);
    }
  }
}
