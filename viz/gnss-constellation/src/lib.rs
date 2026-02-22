use std::f64::consts::PI;

use wasm_bindgen::prelude::*;

// ---------------------------------------------------------------------------
// Entry point — Phase 0 stub: 2D canvas with fake satellite positions
// Replace with three-d WebGL2 render loop in Phase 1.
// ---------------------------------------------------------------------------

/// Called from gnss.html <script type="module"> after wasm-pack init().
#[wasm_bindgen(start)]
pub fn start() {
    let window = web_sys::window().expect("no window");
    let document = window.document().expect("no document");
    let canvas = document
        .get_element_by_id("gnss-canvas")
        .expect("no #gnss-canvas")
        .dyn_into::<web_sys::HtmlCanvasElement>()
        .expect("not a canvas");

    // Sync backing buffer to CSS display size
    let w = canvas.client_width() as f64;
    let h = canvas.client_height() as f64;
    canvas.set_width(canvas.client_width() as u32);
    canvas.set_height(canvas.client_height() as u32);

    let ctx = canvas
        .get_context("2d")
        .unwrap()
        .unwrap()
        .dyn_into::<web_sys::CanvasRenderingContext2d>()
        .expect("no 2d context");

    let cx = w / 2.0;
    let cy = h / 2.0;
    let scale = w.min(h);

    // Background
    ctx.set_fill_style(&JsValue::from_str("#000000"));
    ctx.fill_rect(0.0, 0.0, w, h);

    // Earth
    ctx.begin_path();
    ctx.arc(cx, cy, scale * 0.10, 0.0, 2.0 * PI).unwrap();
    ctx.set_fill_style(&JsValue::from_str("#071207"));
    ctx.fill();
    ctx.set_stroke_style(&JsValue::from_str("#39ff14"));
    ctx.set_line_width(1.5);
    ctx.stroke();

    // Fake constellation planes: (color, rx_frac, ry_frac, tilt_offset, n_sats)
    let planes: &[(&str, f64, f64, f64, u32)] = &[
        ("#39ff14", 0.43, 0.20, 0.0, 32),        // GPS — neon green
        ("#ffab40", 0.38, 0.17, PI / 5.0, 28),   // GLONASS — orange
        ("#80cbc4", 0.48, 0.22, PI / 3.0, 28),   // Galileo — teal
        ("#b0bec5", 0.41, 0.19, PI * 2.0 / 5.0, 46), // BeiDou — grey-blue
    ];

    for (color, rx_f, ry_f, tilt, n) in planes {
        let rx = scale * rx_f;
        let ry = scale * ry_f;
        let cos_t = tilt.cos();
        let sin_t = tilt.sin();

        // Orbit ellipse (dim)
        ctx.set_stroke_style(&JsValue::from_str(color));
        ctx.set_line_width(0.5);
        ctx.set_global_alpha(0.25);
        ctx.begin_path();
        let steps = 64u32;
        for k in 0..=steps {
            let a = k as f64 * 2.0 * PI / steps as f64;
            let x = cx + rx * a.cos() * cos_t - ry * a.sin() * sin_t;
            let y = cy + rx * a.cos() * sin_t + ry * a.sin() * cos_t;
            if k == 0 {
                ctx.move_to(x, y);
            } else {
                ctx.line_to(x, y);
            }
        }
        ctx.close_path();
        ctx.stroke();

        // Satellite dots (full brightness)
        ctx.set_fill_style(&JsValue::from_str(color));
        ctx.set_global_alpha(1.0);
        for j in 0..*n {
            let a = j as f64 * 2.0 * PI / *n as f64;
            let x = cx + rx * a.cos() * cos_t - ry * a.sin() * sin_t;
            let y = cy + rx * a.cos() * sin_t + ry * a.sin() * cos_t;
            ctx.begin_path();
            ctx.arc(x, y, 2.5, 0.0, 2.0 * PI).unwrap();
            ctx.fill();
        }
    }

    // Status overlay
    ctx.set_global_alpha(1.0);
    ctx.set_font("11px 'IBM Plex Mono', monospace");
    ctx.set_fill_style(&JsValue::from_str("#39ff14"));
    ctx.fill_text("TLE: 134 satellites (simulated)", 14.0, h - 28.0)
        .unwrap();
    ctx.set_fill_style(&JsValue::from_str("#3a5a3a"));
    ctx.fill_text("phase-1: three-d WebGL2 pending", 14.0, h - 12.0)
        .unwrap();
}

// ---------------------------------------------------------------------------
// TLE fetch
// ---------------------------------------------------------------------------

const TLE_URL: &str =
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=gnss&FORMAT=json";

/// Fetch GNSS TLE JSON from Celestrak.
/// Caches result in the browser Cache API (12 h TTL) via JS interop.
/// Returns the raw JSON string on success.
async fn fetch_tles() -> Result<String, JsValue> {
    // TODO: check Cache API for fresh entry (< 12 h old)
    // TODO: if stale/missing, fetch TLE_URL via gloo_net::http::Request
    // TODO: store response in Cache API with x-fetched-at timestamp header
    // TODO: return JSON string
    todo!("fetch_tles not yet implemented")
}

// ---------------------------------------------------------------------------
// SGP4 propagation
// ---------------------------------------------------------------------------

/// Parse Celestrak OMM JSON and propagate all satellites to current time.
/// Returns a JsValue array of {name, x, y, z} objects (TEME frame, km).
///
/// Note: TEME ≈ ECI at GNSS altitudes — GMST rotation skipped for Phase 1.
#[wasm_bindgen]
pub fn propagate(tle_json: &str) -> Result<JsValue, JsValue> {
    // TODO: deserialise tle_json into Vec<sgp4::Elements>
    // TODO: compute minutes_since_epoch for each element (current UTC time)
    // TODO: for each element: Constants::from_elements() + constants.propagate()
    // TODO: collect [name, x, y, z] into a JS-friendly array
    // TODO: return via serde_wasm_bindgen::to_value()
    let _ = tle_json;
    todo!("propagate not yet implemented")
}

// ---------------------------------------------------------------------------
// Scene rendering
// ---------------------------------------------------------------------------

/// Initialise the three-d scene: Earth sphere + satellite PointCloud.
/// Called once after the wasm module is ready and canvas is in the DOM.
fn render_scene() {
    // TODO: create three_d::Window from canvas element id "gnss-canvas"
    // TODO: add Earth sphere (unit sphere, phosphor green wireframe or texture)
    // TODO: add PointCloud for satellite positions
    // TODO: add OrbitControl (with scroll-clamp workaround for WASM bug #403)
    // TODO: start render loop, updating satellite positions each frame
}
