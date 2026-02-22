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

const CONSTELLATION_NAMES = ["GPS", "GLONASS", "Galileo", "BeiDou"];

const COLORS = {
  background: "#000000",
  ringDimGreen: "#1a3a1a",
  compassLabel: "#2a6a2a",
  ringLabel: "#3a5a3a",
  crosshair: "#0f2a0f",
  panelTitle: "#2a6a2a",
  zenith: "#1a3a1a",
};

const FONT_FAMILY = "IBM Plex Mono, monospace";

let _lastRenderTime = 0;
const RENDER_INTERVAL_MS = 500; // ~2 fps

/**
 * initSkyPlot — find #sky-plot-canvas, wire up the WASM module, start render loop.
 * @param {object} wasmModule — WASM module with .get_sky_data() method
 */
export function initSkyPlot(wasmModule) {
  const canvas = document.getElementById("sky-plot-canvas");
  if (!canvas) {
    console.warn("[gnss-skyplot] #sky-plot-canvas not found");
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const logicalSize = 200;

  // Scale canvas backing store for crisp rendering on HiDPI displays
  canvas.width = logicalSize * dpr;
  canvas.height = logicalSize * dpr;
  canvas.style.width = logicalSize + "px";
  canvas.style.height = logicalSize + "px";

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    console.warn("[gnss-skyplot] Could not get 2D context from #sky-plot-canvas");
    return;
  }

  // Scale all drawing commands by dpr so logical coords work naturally
  ctx.scale(dpr, dpr);

  function loop(timestamp) {
    if (timestamp - _lastRenderTime >= RENDER_INTERVAL_MS) {
      _lastRenderTime = timestamp;

      let sats = [];
      try {
        sats = wasmModule.get_sky_data();
      } catch (err) {
        console.error("[gnss-skyplot] get_sky_data() failed:", err);
      }

      renderSkyPlot(ctx, sats, logicalSize, logicalSize);
    }

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

/**
 * renderSkyPlot — pure function, renders one frame of the sky plot.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{name: string, constellation: number, az_deg: number, el_deg: number, r: number, g: number, b: number}>} sats
 * @param {number} width  — logical canvas width (before dpr scaling)
 * @param {number} height — logical canvas height (before dpr scaling)
 */
export function renderSkyPlot(ctx, sats, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  // Leave a small margin so labels at edge aren't clipped
  const margin = 14;
  const plotRadius = Math.min(cx, cy) - margin;

  // --- Background ---
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  // --- Panel title ---
  ctx.font = `9px ${FONT_FAMILY}`;
  ctx.fillStyle = COLORS.panelTitle;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("sky / chicago", 4, 3);

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

  ctx.strokeStyle = COLORS.ringDimGreen;
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

      ctx.font = `8px ${FONT_FAMILY}`;
      ctx.fillStyle = COLORS.ringLabel;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(el + "\u00b0", labelX, labelY);
    }
  }

  // Label "0°" at the horizon ring edge (lower-left, just inside)
  {
    const fraction = 1.0;
    const r = plotRadius * fraction;
    const labelAngleRad = (225 * Math.PI) / 180;
    const labelX = cx + r * Math.sin(labelAngleRad) * 0.88;
    const labelY = cy - r * Math.cos(labelAngleRad) * 0.88;

    ctx.font = `8px ${FONT_FAMILY}`;
    ctx.fillStyle = COLORS.ringLabel;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("0\u00b0", labelX, labelY);
  }

  // --- Zenith dot ---
  ctx.fillStyle = COLORS.zenith;
  ctx.beginPath();
  ctx.arc(cx, cy, 2, 0, Math.PI * 2);
  ctx.fill();

  // --- Compass labels N/S/E/W ---
  const compassOffset = plotRadius + 10;
  const compassPositions = [
    { label: "N", dx: 0, dy: -1 },
    { label: "S", dx: 0, dy: 1 },
    { label: "E", dx: 1, dy: 0 },
    { label: "W", dx: -1, dy: 0 },
  ];

  ctx.font = `9px ${FONT_FAMILY}`;
  ctx.fillStyle = COLORS.compassLabel;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const { label, dx, dy } of compassPositions) {
    ctx.fillText(label, cx + dx * compassOffset, cy + dy * compassOffset);
  }

  // --- Satellite dots ---
  if (!Array.isArray(sats)) return;

  for (const sat of sats) {
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

    const satColor = `rgb(${r},${g},${b})`;
    const satColorDim = `rgba(${r},${g},${b},0.4)`;
    const satLabelColor = `rgba(${r},${g},${b},0.65)`;

    // Glow ring
    ctx.beginPath();
    ctx.arc(sx, sy, 7, 0, Math.PI * 2);
    ctx.strokeStyle = satColorDim;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Filled dot
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fillStyle = satColor;
    ctx.fill();

    // Satellite name label (right of dot, 6px)
    ctx.font = `6px ${FONT_FAMILY}`;
    ctx.fillStyle = satLabelColor;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const label = name || CONSTELLATION_NAMES[sat.constellation] || "?";
    ctx.fillText(label, sx + 6, sy);
  }
}
