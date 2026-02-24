/**
 * gnss-dopplot.js — DOP time-history canvas for GNSS constellation visualizer.
 * Loaded as <script type="module"> from gnss.html.
 * No bundler, no npm deps — plain ES module syntax only.
 *
 * Public API:
 *   initDopPlot(canvasId)                    – wire canvas, start render loop
 *   pushDopSample(simEpoch, combined)        – record a DOP snapshot (call at ~1 Hz)
 */

// ─── ring buffer ─────────────────────────────────────────────────────────────

const MAX_SAMPLES = 512;

/** @type {{ epoch: number, gdop: number, pdop: number, hdop: number, vdop: number }[]} */
const samples = [];
let head = 0; // next write index (ring)
let count = 0;

// ─── module state ─────────────────────────────────────────────────────────────

/** @type {HTMLCanvasElement|null} */
let canvas = null;
/** @type {CanvasRenderingContext2D|null} */
let ctx = null;
let rafId = null;
let lastRenderMs = 0;
const RENDER_INTERVAL_MS = 500; // 2 fps

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Initialise the DOP time-history plot.
 * @param {string} canvasId – id of the <canvas> element
 */
export function initDopPlot(canvasId) {
  canvas = document.getElementById(canvasId);
  if (!canvas) return;
  ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Kick off the render loop.
  function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (now - lastRenderMs < RENDER_INTERVAL_MS) return;
    lastRenderMs = now;
    render();
  }
  rafId = requestAnimationFrame(loop);
}

/**
 * Push a DOP snapshot from the 1 Hz HUD updater.
 * @param {number} simEpoch – simulation Unix timestamp (seconds)
 * @param {{ gdop: number, pdop: number, hdop: number, vdop: number, n_sats: number }} combined
 */
export function pushDopSample(simEpoch, combined) {
  const entry = {
    epoch: simEpoch,
    gdop: combined.gdop,
    pdop: combined.pdop,
    hdop: combined.hdop,
    vdop: combined.vdop,
  };

  if (count < MAX_SAMPLES) {
    samples.push(entry);
    count++;
  } else {
    // Ring-buffer overwrite
    samples[head] = entry;
    head = (head + 1) % MAX_SAMPLES;
  }
}

// ─── rendering ────────────────────────────────────────────────────────────────

const COLORS = {
  gdop: '#ffffff',
  pdop: '#39ff14', // neon green
  hdop: '#80cbc4', // teal
  vdop: '#ffab40', // orange
};

const Y_TICKS = [0, 2, 5, 10];
const LABEL_W = 28; // left gutter for Y-axis labels
const MARGIN_R = 6;
const MARGIN_T = 8;
const MARGIN_B = 18; // bottom gutter for X-axis labels

function render() {
  if (!ctx || !canvas) return;

  const W = canvas.width;
  const H = canvas.height;

  // Background
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  // Border
  ctx.strokeStyle = '#1a3a1a';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  const plotW = W - LABEL_W - MARGIN_R;
  const plotH = H - MARGIN_T - MARGIN_B;
  const plotX = LABEL_W;
  const plotY = MARGIN_T;

  // Determine Y range: 0 to max(10, ceil(max_gdop))
  let maxVal = 10;
  for (const s of samples) {
    if (s.gdop < 90) maxVal = Math.max(maxVal, s.gdop);
  }
  maxVal = Math.ceil(maxVal);

  // Grid lines + Y labels
  ctx.font = '9px IBM Plex Mono,monospace';
  ctx.fillStyle = '#3a6a3a';
  ctx.textAlign = 'right';
  for (const tick of Y_TICKS) {
    if (tick > maxVal) continue;
    const py = plotY + plotH - (tick / maxVal) * plotH;
    ctx.fillStyle = '#1a3a1a';
    ctx.fillRect(plotX, py, plotW, 1);
    ctx.fillStyle = '#3a6a3a';
    ctx.fillText(String(tick), LABEL_W - 3, py + 3);
  }

  if (count === 0) {
    // No data yet
    ctx.fillStyle = '#2a4a2a';
    ctx.textAlign = 'center';
    ctx.font = '9px IBM Plex Mono,monospace';
    ctx.fillText('waiting for data…', plotX + plotW / 2, plotY + plotH / 2);
    return;
  }

  // Collect ordered samples (ring buffer → chronological array)
  const ordered = getOrdered();

  // X range: min to max epoch, at least 6 hours wide
  let tMin = ordered[0].epoch;
  let tMax = ordered[ordered.length - 1].epoch;
  if (tMax - tMin < 6 * 3600) {
    tMax = tMin + 6 * 3600;
  }
  const tSpan = tMax - tMin;

  /** Map epoch → canvas X */
  const toX = (e) => plotX + ((e - tMin) / tSpan) * plotW;
  /** Map DOP value → canvas Y */
  const toY = (v) => plotY + plotH - Math.min(v / maxVal, 1) * plotH;

  // X-axis time labels (start and end)
  ctx.fillStyle = '#3a6a3a';
  ctx.font = '9px IBM Plex Mono,monospace';
  ctx.textAlign = 'left';
  ctx.fillText(fmtTime(ordered[0].epoch), plotX, H - 4);
  ctx.textAlign = 'right';
  ctx.fillText(fmtTime(ordered[ordered.length - 1].epoch), plotX + plotW, H - 4);

  // Draw each DOP line
  for (const [key, color] of Object.entries(COLORS)) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (const s of ordered) {
      const v = s[key];
      if (v >= 90) { started = false; continue; } // N/A sentinel
      const x = toX(s.epoch);
      const y = toY(v);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else           { ctx.lineTo(x, y); }
    }
    ctx.stroke();
  }

  // N/A label if current combined DOP is unavailable
  const last = ordered[ordered.length - 1];
  if (last.gdop >= 90) {
    ctx.fillStyle = 'rgba(90,90,90,0.6)';
    ctx.textAlign = 'center';
    ctx.font = '9px IBM Plex Mono,monospace';
    ctx.fillText('< 4 sats', plotX + plotW / 2, plotY + plotH / 2);
  }

  // Legend — bottom right inside the plot
  const legendItems = [
    ['GDOP', COLORS.gdop],
    ['PDOP', COLORS.pdop],
    ['HDOP', COLORS.hdop],
    ['VDOP', COLORS.vdop],
  ];
  ctx.font = '8px IBM Plex Mono,monospace';
  ctx.textAlign = 'right';
  let lx = plotX + plotW - 2;
  const ly = plotY + 10;
  for (const [label, color] of legendItems) {
    ctx.fillStyle = color;
    ctx.fillText(label, lx, ly);
    lx -= 32;
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Return samples in chronological order from the ring buffer. */
function getOrdered() {
  if (count < MAX_SAMPLES) {
    return samples.slice(); // simple slice when buffer isn't full
  }
  // head points to oldest entry
  return [...samples.slice(head), ...samples.slice(0, head)];
}

/** Format a Unix timestamp as HH:MM UTC. */
function fmtTime(epochS) {
  const d = new Date(epochS * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
