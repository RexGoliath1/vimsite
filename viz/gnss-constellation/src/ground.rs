/// Ground observer location, satellite visibility, and sky-plot data export.
///
/// Pure math + JS-bridge — no three-d imports, no sgp4 imports.
/// lib.rs is responsible for TEME→ECEF conversion and for calling into
/// this module with pre-computed az/el values and ECEF positions.
///
/// All heavy trig uses f64; only WebGL/JS-facing outputs downcast to f32.
use wasm_bindgen::prelude::*;
use serde::Serialize;

// ---------------------------------------------------------------------------
// Earth radius constant
// ---------------------------------------------------------------------------

pub const EARTH_R_KM: f64 = 6371.0;

// ---------------------------------------------------------------------------
// Observer
// ---------------------------------------------------------------------------

/// Ground observer location specified in geodetic coordinates.
///
/// Assumes a spherical Earth — sufficient for sky-plot and line-of-sight
/// calculations at GNSS altitudes.
#[allow(dead_code)]
#[derive(Clone, Copy)]
pub struct Observer {
    pub lat_deg: f64,
    pub lon_deg: f64,
}

impl Default for Observer {
    fn default() -> Self {
        // Chicago, IL  41.85 °N  87.65 °W
        Self {
            lat_deg: 41.85,
            lon_deg: -87.65,
        }
    }
}

impl Observer {
    /// Construct a new observer at the given geodetic coordinates.
    pub fn new(lat_deg: f64, lon_deg: f64) -> Self {
        Self { lat_deg, lon_deg }
    }

    /// ECEF unit vector for this observer (spherical Earth, radius = 1).
    ///
    /// Implements the standard geodetic-to-ECEF conversion inline so that
    /// this module does not need to import `coords.rs`; lib.rs coordinates
    /// the two modules when both are needed together.
    ///
    /// ```text
    /// lat = lat_deg.to_radians();  lon = lon_deg.to_radians()
    /// [lat.cos()*lon.cos(),  lat.cos()*lon.sin(),  lat.sin()]
    /// ```
    pub fn ecef_unit(&self) -> [f64; 3] {
        let lat = self.lat_deg.to_radians();
        let lon = self.lon_deg.to_radians();
        [
            lat.cos() * lon.cos(),
            lat.cos() * lon.sin(),
            lat.sin(),
        ]
    }

    /// Observer ECEF position scaled to scene units (Earth radius = 1.0).
    ///
    /// The unit vector sits exactly on the surface of the unit-radius Earth
    /// used by the three-d scene, so no further scaling is required.
    /// Output is f32 for direct use with WebGL vertex buffers.
    pub fn scene_pos(&self) -> [f32; 3] {
        let u = self.ecef_unit();
        [u[0] as f32, u[1] as f32, u[2] as f32]
    }
}

// ---------------------------------------------------------------------------
// Sky-plot entry
// ---------------------------------------------------------------------------

/// One visible satellite entry for the sky-plot overlay.
///
/// Serialises to a plain JS object via `serde_wasm_bindgen` so the host
/// page can render it with Canvas2D or SVG without any extra parsing.
#[allow(dead_code)]
#[derive(Serialize)]
pub struct SkySat {
    pub name: String,
    /// Constellation index (0 = GPS, 1 = GLONASS, 2 = Galileo, 3 = BeiDou MEO).
    pub constellation: u8,
    /// Azimuth in degrees [0, 360).  0 = North, 90 = East.
    pub az_deg: f32,
    /// Elevation in degrees [min_el, 90].
    pub el_deg: f32,
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

// ---------------------------------------------------------------------------
// Constellation colour lookup
// ---------------------------------------------------------------------------

/// RGB colour for a constellation index.
///
/// Matches the `SATS` colour definitions in `lib.rs` so that sky-plot dots
/// and 3-D scene dots share the same palette.
///
/// | idx | Constellation | Colour            |
/// |-----|---------------|-------------------|
/// |   0 | GPS           | neon green        |
/// |   1 | GLONASS       | red               |
/// |   2 | Galileo       | cyan              |
/// |   3 | BeiDou MEO    | orange            |
/// |   _ | unknown       | grey              |
pub fn constellation_color(idx: u8) -> [u8; 3] {
    match idx {
        0 => [57, 255, 20],   // GPS      — neon green
        1 => [255, 68, 68],   // GLONASS  — red
        2 => [0, 255, 204],   // Galileo  — cyan
        3 => [255, 170, 0],   // BeiDou MEO — orange
        _ => [128, 128, 128], // unknown  — grey
    }
}

// ---------------------------------------------------------------------------
// Visibility test
// ---------------------------------------------------------------------------

/// Return `true` if the satellite is at or above the minimum elevation mask.
///
/// `el_deg` is the elevation angle in degrees as returned by `coords::az_el`.
/// `min_el_deg` is typically 5.0–15.0° to exclude multipath-prone low-angle
/// satellites.
#[inline]
pub fn is_visible(el_deg: f64, min_el_deg: f64) -> bool {
    el_deg >= min_el_deg
}

// ---------------------------------------------------------------------------
// Sky-plot JS export
// ---------------------------------------------------------------------------

/// Serialise a slice of visible `SkySat` entries to a JS Array of objects.
///
/// The host page receives an Array where each element has the shape:
/// ```json
/// { "name": "G01", "constellation": 0,
///   "az_deg": 135.4, "el_deg": 42.1,
///   "r": 57, "g": 255, "b": 20 }
/// ```
///
/// Returns `JsValue::NULL` only if serialisation fails (should never happen
/// for well-formed `SkySat` values).
pub fn sky_plot_jsvalue(sats: &[SkySat]) -> JsValue {
    serde_wasm_bindgen::to_value(sats).unwrap_or(JsValue::NULL)
}

// ---------------------------------------------------------------------------
// Line-segment geometry for observer→satellite overlay
// ---------------------------------------------------------------------------

/// Build a flat `f32` buffer of line segments from the observer to each
/// visible satellite, suitable for upload to a WebGL `LINES` draw call.
///
/// Layout: `[obs_x, obs_y, obs_z, sat_x, sat_y, sat_z, ...]`
/// — 6 floats per segment, one segment per visible satellite.
///
/// `obs_scene`   — observer position in scene units (Earth radius = 1.0).
/// `visible_sats` — `(constellation_idx, scene_pos)` pairs, already filtered
///                  to above the elevation mask and already in scene units.
///                  The `constellation_idx` is included so callers can extend
///                  this function to emit per-constellation colours if needed.
pub fn build_line_segments(
    obs_scene: [f32; 3],
    visible_sats: &[(u8, [f32; 3])],
) -> Vec<f32> {
    let mut buf = Vec::with_capacity(visible_sats.len() * 6);
    for &(_constellation_idx, sat_pos) in visible_sats {
        // Observer end
        buf.push(obs_scene[0]);
        buf.push(obs_scene[1]);
        buf.push(obs_scene[2]);
        // Satellite end
        buf.push(sat_pos[0]);
        buf.push(sat_pos[1]);
        buf.push(sat_pos[2]);
    }
    buf
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // --- Observer ---

    #[test]
    fn test_observer_default_is_chicago() {
        let obs = Observer::default();
        assert!((obs.lat_deg - 41.85).abs() < 1e-10);
        assert!((obs.lon_deg - -87.65).abs() < 1e-10);
    }

    #[test]
    fn test_observer_new_roundtrip() {
        let obs = Observer::new(51.5, -0.1);
        assert!((obs.lat_deg - 51.5).abs() < 1e-10);
        assert!((obs.lon_deg - -0.1).abs() < 1e-10);
    }

    /// Observer at equator / prime-meridian must have ECEF unit vector (1, 0, 0).
    #[test]
    fn test_ecef_unit_equator_prime_meridian() {
        let obs = Observer::new(0.0, 0.0);
        let u = obs.ecef_unit();
        assert!((u[0] - 1.0).abs() < 1e-12, "x={}", u[0]);
        assert!((u[1] - 0.0).abs() < 1e-12, "y={}", u[1]);
        assert!((u[2] - 0.0).abs() < 1e-12, "z={}", u[2]);
    }

    /// North pole (lat=90) must be (0, 0, 1).
    #[test]
    fn test_ecef_unit_north_pole() {
        let obs = Observer::new(90.0, 0.0);
        let u = obs.ecef_unit();
        assert!((u[0] - 0.0).abs() < 1e-12, "x={}", u[0]);
        assert!((u[1] - 0.0).abs() < 1e-12, "y={}", u[1]);
        assert!((u[2] - 1.0).abs() < 1e-12, "z={}", u[2]);
    }

    /// scene_pos must equal ecef_unit cast to f32 (observer sits on unit sphere).
    #[test]
    fn test_scene_pos_matches_ecef_unit_f32() {
        let obs = Observer::new(41.85, -87.65);
        let u = obs.ecef_unit();
        let s = obs.scene_pos();
        assert!((s[0] - u[0] as f32).abs() < 1e-6);
        assert!((s[1] - u[1] as f32).abs() < 1e-6);
        assert!((s[2] - u[2] as f32).abs() < 1e-6);
    }

    // --- is_visible ---

    #[test]
    fn test_is_visible_above_mask() {
        assert!(is_visible(10.0, 5.0));
        assert!(is_visible(5.0, 5.0));  // equal = visible
    }

    #[test]
    fn test_is_visible_below_mask() {
        assert!(!is_visible(4.9, 5.0));
        assert!(!is_visible(-1.0, 0.0));
    }

    // --- constellation_color ---

    #[test]
    fn test_constellation_color_known() {
        assert_eq!(constellation_color(0), [57, 255, 20]);
        assert_eq!(constellation_color(1), [255, 68, 68]);
        assert_eq!(constellation_color(2), [0, 255, 204]);
        assert_eq!(constellation_color(3), [255, 170, 0]);
    }

    #[test]
    fn test_constellation_color_unknown() {
        assert_eq!(constellation_color(4),   [128, 128, 128]);
        assert_eq!(constellation_color(255), [128, 128, 128]);
    }

    // --- build_line_segments ---

    #[test]
    fn test_build_line_segments_empty() {
        let obs = [0.0_f32, 0.0, 1.0];
        let buf = build_line_segments(obs, &[]);
        assert!(buf.is_empty());
    }

    #[test]
    fn test_build_line_segments_one_sat() {
        let obs = [0.1_f32, 0.2, 0.9];
        let sat = [3.0_f32, 4.0, 5.0];
        let buf = build_line_segments(obs, &[(0u8, sat)]);
        assert_eq!(buf.len(), 6);
        // observer end
        assert_eq!(buf[0], 0.1);
        assert_eq!(buf[1], 0.2);
        assert_eq!(buf[2], 0.9);
        // satellite end
        assert_eq!(buf[3], 3.0);
        assert_eq!(buf[4], 4.0);
        assert_eq!(buf[5], 5.0);
    }

    #[test]
    fn test_build_line_segments_two_sats() {
        let obs  = [0.0_f32, 0.0, 1.0];
        let sat1 = [1.0_f32, 0.0, 4.0];
        let sat2 = [0.0_f32, 1.0, 3.5];
        let buf  = build_line_segments(obs, &[(0u8, sat1), (2u8, sat2)]);
        assert_eq!(buf.len(), 12);
        // second segment observer end is at index 6..9
        assert_eq!(buf[6], 0.0);
        assert_eq!(buf[7], 0.0);
        assert_eq!(buf[8], 1.0);
    }

    /// Buffer capacity must be 6 × number of visible satellites.
    #[test]
    fn test_build_line_segments_n_sats() {
        let obs  = [0.0_f32; 3];
        let sats: Vec<(u8, [f32; 3])> = (0..10)
            .map(|i| (i as u8 % 4, [i as f32, 0.0, 5.0]))
            .collect();
        let buf = build_line_segments(obs, &sats);
        assert_eq!(buf.len(), 60); // 10 × 6
    }
}
