mod coords;
mod tles;
mod ground;
pub mod borders;

use std::cell::RefCell;
use std::f32::consts::PI;
use three_d::*;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use ground::Observer;
use tles::TleStore;

// ── State ─────────────────────────────────────────────────────────────────────

struct GnssState {
    tle_store: TleStore,
    observer: Observer,
    sim_epoch: f64,
    paused: bool,
    visible_only: bool,
    /// Indexed by tles::CONSTELLATION_* constants (0=GPS … 4=Other).
    constellation_visible: [bool; 5],
    /// -1 = none highlighted; 0-4 = one constellation highlighted.
    highlighted: i32,
    /// Most-recent per-satellite ECEF positions (km) from TLE propagation.
    sat_ecef_km: Vec<(u8, [f64; 3])>,
    /// Simulation time acceleration (e.g. 120 = 2 min real time per sim second).
    time_warp: f64,
    /// Configurable elevation mask in degrees (default 5.0). Replaces the old hardcoded 5.0.
    elev_mask_deg: f64,
    /// Visibility toggles for overlay objects.
    show_inc_rings: bool,
    show_ecef_axes: bool,
    show_eci_axes: bool,
    show_borders: bool,
    show_elev_cone: bool,
    /// Injected country border JSON. Set by inject_borders(), consumed by render loop.
    borders_json: Option<String>,
    /// True when borders_json was updated but the mesh hasn't been rebuilt yet.
    borders_dirty: bool,
}

impl Default for GnssState {
    fn default() -> Self {
        GnssState {
            tle_store: TleStore::new(),
            observer: ground::Observer::new(0.0, 0.0),
            sim_epoch: 0.0,
            paused: false,
            visible_only: false,
            constellation_visible: [true; 5],
            highlighted: -1,
            sat_ecef_km: Vec::new(),
            time_warp: 120.0,
            elev_mask_deg: 5.0,
            show_inc_rings: true,
            show_ecef_axes: false,
            show_eci_axes: false,
            show_borders: true,
            show_elev_cone: false,
            borders_json: None,
            borders_dirty: false,
        }
    }
}

thread_local! {
    static STATE: RefCell<GnssState> = RefCell::new(GnssState::default());
}

// ── WASM exports ──────────────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn set_ground_location(lat: f64, lon: f64) {
    STATE.with(|s| s.borrow_mut().observer = Observer::new(lat, lon));
}

#[wasm_bindgen]
pub fn toggle_constellation(idx: u32, on: bool) {
    if idx < 5 {
        STATE.with(|s| s.borrow_mut().constellation_visible[idx as usize] = on);
    }
}

#[wasm_bindgen]
pub fn set_highlighted_constellation(idx: i32) {
    STATE.with(|s| s.borrow_mut().highlighted = idx);
}

#[wasm_bindgen]
pub fn set_visible_only(on: bool) {
    STATE.with(|s| s.borrow_mut().visible_only = on);
}

#[wasm_bindgen]
pub fn set_paused(on: bool) {
    STATE.with(|s| s.borrow_mut().paused = on);
}

#[wasm_bindgen]
pub fn set_time_warp(v: f64) {
    STATE.with(|s| s.borrow_mut().time_warp = v.max(0.0));
}

#[wasm_bindgen]
pub fn set_elev_mask(v: f64) {
    STATE.with(|s| s.borrow_mut().elev_mask_deg = v.clamp(0.0, 89.0));
}

#[wasm_bindgen]
pub fn set_show_inc_rings(on: bool) {
    STATE.with(|s| s.borrow_mut().show_inc_rings = on);
}

#[wasm_bindgen]
pub fn set_show_ecef_axes(on: bool) {
    STATE.with(|s| s.borrow_mut().show_ecef_axes = on);
}

#[wasm_bindgen]
pub fn set_show_eci_axes(on: bool) {
    STATE.with(|s| s.borrow_mut().show_eci_axes = on);
}

#[wasm_bindgen]
pub fn set_show_borders(on: bool) {
    STATE.with(|s| s.borrow_mut().show_borders = on);
}

#[wasm_bindgen]
pub fn set_show_elev_cone(on: bool) {
    STATE.with(|s| s.borrow_mut().show_elev_cone = on);
}

#[wasm_bindgen]
pub fn inject_borders(json: &str) {
    STATE.with(|s| {
        let mut st = s.borrow_mut();
        st.borders_json = Some(json.to_string());
        st.borders_dirty = true;
    });
}

#[wasm_bindgen]
pub fn get_sim_epoch() -> f64 {
    STATE.with(|s| s.borrow().sim_epoch)
}

#[wasm_bindgen]
pub fn set_sim_epoch(unix_s: f64) {
    STATE.with(|s| s.borrow_mut().sim_epoch = unix_s);
}

#[wasm_bindgen]
pub fn inject_tles(json: &str) {
    STATE.with(|s| {
        let mut st = s.borrow_mut();
        // Clear previous records so a fresh fetch replaces stale data
        st.tle_store = TleStore::new();
        match st.tle_store.load_from_json(json) {
            Ok(_) => {}
            Err(_) => {}
        }
    });
}

/// Returns a JS Array of sky-plot entries for the current sim epoch.
/// Each entry: `{ name, constellation, az_deg, el_deg, r, g, b, c_n0 }`
#[wasm_bindgen]
pub fn get_sky_data() -> JsValue {
    STATE.with(|s| {
        let st = s.borrow();
        // Observer ECEF position in km (unit vector × Earth radius)
        let u = st.observer.ecef_unit();
        let obs_km = [u[0] * 6371.0, u[1] * 6371.0, u[2] * 6371.0];

        let sky_sats: Vec<ground::SkySat> = st
            .sat_ecef_km
            .iter()
            .enumerate()
            .filter_map(|(sat_idx, (c_idx, pos_km))| {
                let ci = *c_idx as usize;
                if !st.constellation_visible.get(ci).copied().unwrap_or(false) {
                    return None;
                }
                let (az, el) = coords::az_el(obs_km, *pos_km);
                if el < 0.0 {
                    return None; // below horizon
                }
                if st.visible_only && el < st.elev_mask_deg {
                    return None;
                }
                let [r, g, b] = ground::constellation_color(*c_idx);
                let c_n0 = ground::simulate_c_n0(
                    el as f32,
                    st.observer.lat_deg,
                    st.observer.lon_deg,
                    st.sim_epoch,
                    *c_idx,
                    sat_idx,
                );
                Some(ground::SkySat {
                    name: String::new(),
                    constellation: *c_idx,
                    az_deg: az as f32,
                    el_deg: el as f32,
                    r,
                    g,
                    b,
                    c_n0,
                })
            })
            .collect();

        ground::sky_plot_jsvalue(&sky_sats)
    })
}

// ── Phase-1 constellation definitions (Keplerian fallback sim) ────────────────

struct ConstellationDef {
    rgb: [u8; 3],
    alt_km: f32,
    inc_deg: f32,
    planes: u32,
    sats_per_plane: u32,
    raan_spacing_deg: f32,
    raan_offset_deg: f32,
}

const SATS: &[ConstellationDef] = &[
    ConstellationDef { rgb: [57,  255, 20],  alt_km: 20200.0, inc_deg: 55.0, planes: 6, sats_per_plane: 4,  raan_spacing_deg: 60.0,  raan_offset_deg: 0.0  }, // GPS
    ConstellationDef { rgb: [255, 68,  68],  alt_km: 19130.0, inc_deg: 64.8, planes: 3, sats_per_plane: 8,  raan_spacing_deg: 120.0, raan_offset_deg: 15.0 }, // GLONASS
    ConstellationDef { rgb: [0,   255, 204], alt_km: 23222.0, inc_deg: 56.0, planes: 3, sats_per_plane: 10, raan_spacing_deg: 120.0, raan_offset_deg: 40.0 }, // Galileo
    ConstellationDef { rgb: [255, 170, 0],   alt_km: 21528.0, inc_deg: 55.0, planes: 3, sats_per_plane: 8,  raan_spacing_deg: 120.0, raan_offset_deg: 80.0 }, // BeiDou
];

const EARTH_R: f32 = 6371.0;
const MU: f32 = 398_600.4418;
const RING_PTS: u32 = 80;

fn alt_norm(alt_km: f32) -> f32 {
    (EARTH_R + alt_km) / EARTH_R
}

fn period_s(alt_km: f32) -> f32 {
    let a = EARTH_R + alt_km;
    2.0 * PI * (a * a * a / MU).sqrt()
}

/// Keplerian position in normalised scene units (Earth radius = 1.0).
fn kpos(r: f32, inc: f32, raan: f32, m: f32) -> Vec3 {
    let (xo, zo) = (r * m.cos(), r * m.sin());
    let y  = zo * inc.sin();
    let ze = zo * inc.cos();
    vec3(xo * raan.cos() - ze * raan.sin(), y, xo * raan.sin() + ze * raan.cos())
}

struct SatState {
    r: f32, inc: f32, rsp: f32, roff: f32, mm: f32,
    planes: u32, sats_per_plane: u32,
}

// ── Constellation colours (per-constellation material colour in TLE mode) ─────

const CONST_COLORS: [[u8; 3]; 5] = [
    [57, 255, 20],    // GPS      — neon green
    [255, 68, 68],    // GLONASS  — red
    [0, 255, 204],    // Galileo  — cyan
    [255, 170, 0],    // BeiDou   — orange
    [128, 128, 128],  // Other    — grey
];

// ── Entry point ───────────────────────────────────────────────────────────────

#[wasm_bindgen(start)]
pub fn start() {
    // Seed sim epoch to current wall-clock time
    STATE.with(|s| s.borrow_mut().sim_epoch = js_sys::Date::now() / 1000.0);

    let canvas = web_sys::window()
        .expect("no window")
        .document()
        .expect("no document")
        .get_element_by_id("gnss-canvas")
        .expect("no #gnss-canvas")
        .dyn_into::<web_sys::HtmlCanvasElement>()
        .expect("not a canvas");

    let window = Window::new(WindowSettings {
        title: "gnss constellation".to_string(),
        canvas: Some(canvas),
        ..Default::default()
    })
    .expect("window");

    let context = window.gl();

    let mut camera = Camera::new_perspective(
        window.viewport(),
        vec3(0.0, 3.5, 9.0),
        vec3(0.0, 0.0, 0.0),
        vec3(0.0, 1.0, 0.0),
        degrees(42.0),
        0.1,
        200.0,
    );
    let mut control = OrbitControl::new(camera.target(), 2.0, 25.0);

    // Earth sphere (radius = 1.0 scene units)
    let earth = Gm::new(
        Mesh::new(&context, &CpuMesh::sphere(32)),
        ColorMaterial { color: Srgba::new(8, 20, 8, 255), ..Default::default() },
    );

    // Equatorial ring
    let eq_ring = Gm::new(
        Mesh::new(&context, &CpuMesh::circle(128)),
        ColorMaterial { color: Srgba::new(20, 60, 20, 255), ..Default::default() },
    );

    // Lat/lon graticule — 15° grid dots on Earth surface
    let grid_dot_mesh = CpuMesh::sphere(2);
    let grid_dot_scale = Mat4::from_scale(0.007f32);
    let mut grid_xforms: Vec<Mat4> = Vec::new();
    for lat_i in -5i32..=5 {          // −75° to +75° in 15° steps
        let lat = (lat_i as f32 * 15.0).to_radians();
        for lon_i in 0..24i32 {        // 0° to 345° in 15° steps
            let lon = (lon_i as f32 * 15.0).to_radians();
            let x = lat.cos() * lon.cos();
            let y = lat.cos() * lon.sin();
            let z = lat.sin();
            grid_xforms.push(Mat4::from_translation(vec3(x, y, z)) * grid_dot_scale);
        }
    }
    // Polar caps
    grid_xforms.push(Mat4::from_translation(vec3(0.0f32, 0.0, 1.0)) * grid_dot_scale);
    grid_xforms.push(Mat4::from_translation(vec3(0.0f32, 0.0, -1.0)) * grid_dot_scale);
    let graticule = Gm::new(
        InstancedMesh::new(
            &context,
            &Instances { transformations: grid_xforms, ..Default::default() },
            &grid_dot_mesh,
        ),
        ColorMaterial { color: Srgba::new(100, 100, 100, 255), ..Default::default() },
    );

    // Ground observer marker — bright yellow sphere on Earth surface
    let mut ground_marker = Gm::new(
        Mesh::new(&context, &CpuMesh::sphere(8)),
        ColorMaterial { color: Srgba::new(255, 240, 60, 255), ..Default::default() },
    );

    // ── Keplerian Phase-1 orbit rings + satellite meshes ──────────────────────
    let ring_dot  = CpuMesh::sphere(3);
    let sat_dot   = CpuMesh::sphere(4);
    let ring_scale = Mat4::from_scale(0.009);
    let sat_scale  = Mat4::from_scale(0.04);

    let mut orbit_gms: Vec<Gm<InstancedMesh, ColorMaterial>> = Vec::new();
    let mut sat_gms:   Vec<Gm<InstancedMesh, ColorMaterial>> = Vec::new();
    let mut states:    Vec<SatState>                         = Vec::new();

    for def in SATS {
        let r    = alt_norm(def.alt_km);
        let inc  = def.inc_deg.to_radians();
        let rsp  = def.raan_spacing_deg.to_radians();
        let roff = def.raan_offset_deg.to_radians();
        let mm   = 2.0 * PI / period_s(def.alt_km);

        let ring_xforms: Vec<Mat4> = (0..def.planes)
            .flat_map(|p| {
                let raan = roff + p as f32 * rsp;
                (0..RING_PTS).map(move |i| {
                    let a = i as f32 * 2.0 * PI / RING_PTS as f32;
                    Mat4::from_translation(kpos(r, inc, raan, a)) * ring_scale
                })
            })
            .collect();

        let ring_col = Srgba::new(def.rgb[0] / 7, def.rgb[1] / 7, def.rgb[2] / 7, 255);
        orbit_gms.push(Gm::new(
            InstancedMesh::new(&context, &Instances { transformations: ring_xforms, ..Default::default() }, &ring_dot),
            ColorMaterial { color: ring_col, ..Default::default() },
        ));

        let n = def.planes * def.sats_per_plane;
        let sat_col = Srgba::new(def.rgb[0], def.rgb[1], def.rgb[2], 255);
        sat_gms.push(Gm::new(
            InstancedMesh::new(&context, &Instances { transformations: vec![Mat4::identity(); n as usize], ..Default::default() }, &sat_dot),
            ColorMaterial { color: sat_col, ..Default::default() },
        ));
        states.push(SatState { r, inc, rsp, roff, mm, planes: def.planes, sats_per_plane: def.sats_per_plane });
    }

    // ── TLE-mode satellite meshes — one Gm per constellation ─────────────────
    let mut tle_sat_gms: Vec<Gm<InstancedMesh, ColorMaterial>> = CONST_COLORS
        .iter()
        .map(|rgb| {
            Gm::new(
                InstancedMesh::new(
                    &context,
                    &Instances { transformations: vec![Mat4::from_scale(0.0)], ..Default::default() },
                    &sat_dot,
                ),
                ColorMaterial { color: Srgba::new(rgb[0], rgb[1], rgb[2], 255), ..Default::default() },
            )
        })
        .collect();

    // ── ECEF reference frame axes — static dot lines ─────────────────────────
    let axis_dot_mesh = CpuMesh::sphere(2);
    let axis_dot_scale = Mat4::from_scale(0.012f32);
    let n_axis_dots: i32 = 18;
    let axis_max_r = 1.5f32;

    let ecef_gm_x = {
        let dir = vec3(1.0f32, 0.0, 0.0);
        let xforms: Vec<Mat4> = (1..=n_axis_dots)
            .map(|i| {
                let t = i as f32 * axis_max_r / n_axis_dots as f32;
                Mat4::from_translation(dir * t) * axis_dot_scale
            })
            .collect();
        Gm::new(
            InstancedMesh::new(&context, &Instances { transformations: xforms, ..Default::default() }, &axis_dot_mesh),
            ColorMaterial { color: Srgba::new(255, 80, 80, 255), ..Default::default() },
        )
    };
    let ecef_gm_y = {
        let dir = vec3(0.0f32, 1.0, 0.0);
        let xforms: Vec<Mat4> = (1..=n_axis_dots)
            .map(|i| {
                let t = i as f32 * axis_max_r / n_axis_dots as f32;
                Mat4::from_translation(dir * t) * axis_dot_scale
            })
            .collect();
        Gm::new(
            InstancedMesh::new(&context, &Instances { transformations: xforms, ..Default::default() }, &axis_dot_mesh),
            ColorMaterial { color: Srgba::new(80, 255, 80, 255), ..Default::default() },
        )
    };
    let ecef_gm_z = {
        let dir = vec3(0.0f32, 0.0, 1.0);
        let xforms: Vec<Mat4> = (1..=n_axis_dots)
            .map(|i| {
                let t = i as f32 * axis_max_r / n_axis_dots as f32;
                Mat4::from_translation(dir * t) * axis_dot_scale
            })
            .collect();
        Gm::new(
            InstancedMesh::new(&context, &Instances { transformations: xforms, ..Default::default() }, &axis_dot_mesh),
            ColorMaterial { color: Srgba::new(80, 80, 255, 255), ..Default::default() },
        )
    };

    // ── ECI axes — placeholder transforms, updated each frame based on GMST ──
    let mut eci_gm_x = Gm::new(
        InstancedMesh::new(&context, &Instances { transformations: vec![Mat4::from_scale(0.0)], ..Default::default() }, &axis_dot_mesh),
        ColorMaterial { color: Srgba::new(255, 160, 80, 255), ..Default::default() }, // orange
    );
    let mut eci_gm_y = Gm::new(
        InstancedMesh::new(&context, &Instances { transformations: vec![Mat4::from_scale(0.0)], ..Default::default() }, &axis_dot_mesh),
        ColorMaterial { color: Srgba::new(160, 80, 255, 255), ..Default::default() }, // purple
    );
    let eci_gm_z = {
        // ECI Z = ECEF Z, light blue
        let dir = vec3(0.0f32, 0.0, 1.0);
        let xforms: Vec<Mat4> = (1..=n_axis_dots)
            .map(|i| {
                let t = i as f32 * axis_max_r / n_axis_dots as f32;
                Mat4::from_translation(dir * t) * axis_dot_scale
            })
            .collect();
        Gm::new(
            InstancedMesh::new(&context, &Instances { transformations: xforms, ..Default::default() }, &axis_dot_mesh),
            ColorMaterial { color: Srgba::new(80, 160, 255, 200), ..Default::default() },
        )
    };

    // ── Elevation cone ring — updated each frame ──────────────────────────────
    let cone_dot_mesh = CpuMesh::sphere(2);
    let mut elev_cone_gm = Gm::new(
        InstancedMesh::new(&context, &Instances { transformations: vec![Mat4::from_scale(0.0)], ..Default::default() }, &cone_dot_mesh),
        ColorMaterial { color: Srgba::new(80, 255, 120, 180), ..Default::default() }, // transparent green
    );

    // ── Country borders — built lazily when inject_borders() is called ────────
    let mut borders_gm: Option<Gm<Mesh, ColorMaterial>> = None;

    window.render_loop(move |mut frame_input| {
        // ── 1. Advance sim clock ──────────────────────────────────────────
        let paused = STATE.with(|s| s.borrow().paused);
        if !paused {
            let warp = STATE.with(|s| s.borrow().time_warp);
            STATE.with(|s| {
                s.borrow_mut().sim_epoch += frame_input.elapsed_time / 1000.0 * warp;
            });
        }
        let sim_epoch = STATE.with(|s| s.borrow().sim_epoch);

        // ── 2. Camera events ──────────────────────────────────────────────
        control.handle_events(&mut camera, &mut frame_input.events);
        camera.set_viewport(frame_input.viewport);

        // ── 3. Read display state snapshot ───────────────────────────────
        let (has_tles, cv, highlighted, visible_only, elev_mask, show_inc_rings, show_ecef_axes,
             show_eci_axes, show_borders, show_elev_cone, borders_dirty) = STATE.with(|s| {
            let st = s.borrow();
            (
                !st.tle_store.is_empty(),
                st.constellation_visible,
                st.highlighted,
                st.visible_only,
                st.elev_mask_deg,
                st.show_inc_rings,
                st.show_ecef_axes,
                st.show_eci_axes,
                st.show_borders,
                st.show_elev_cone,
                st.borders_dirty,
            )
        });

        // ── 4. Update Keplerian orbit ring colours (highlight / dim) ──────
        for (i, og) in orbit_gms.iter_mut().enumerate() {
            let base = SATS[i].rgb;
            og.material.color = if !cv[i] {
                Srgba::new(0, 0, 0, 255)
            } else if highlighted != -1 && highlighted != i as i32 {
                Srgba::new(base[0] / 20, base[1] / 20, base[2] / 20, 255)
            } else {
                Srgba::new(base[0] / 7, base[1] / 7, base[2] / 7, 255)
            };
        }

        // ── 5. Propagate satellites ───────────────────────────────────────
        if has_tles {
            // SGP4 propagation
            let all_teme = STATE.with(|s| s.borrow().tle_store.propagate_all(sim_epoch));
            let gmst = coords::gmst_rad(sim_epoch);
            let ecef: Vec<(u8, [f64; 3])> = all_teme
                .iter()
                .map(|(c, t)| (*c, coords::teme_to_ecef(*t, gmst)))
                .collect();
            STATE.with(|s| s.borrow_mut().sat_ecef_km = ecef.clone());

            // Observer ECEF km for elevation mask
            let obs_km = {
                let u = STATE.with(|s| s.borrow().observer.ecef_unit());
                [u[0] * 6371.0, u[1] * 6371.0, u[2] * 6371.0]
            };

            for ci in 0..5usize {
                let base = CONST_COLORS[ci];
                tle_sat_gms[ci].material.color = if !cv[ci] {
                    Srgba::new(0, 0, 0, 255)
                } else if highlighted != -1 && highlighted != ci as i32 {
                    Srgba::new(base[0] / 4, base[1] / 4, base[2] / 4, 255)
                } else {
                    Srgba::new(base[0], base[1], base[2], 255)
                };

                let mut xf: Vec<Mat4> = if !cv[ci] {
                    Vec::new()
                } else {
                    ecef.iter()
                        .filter(|(c, _)| *c as usize == ci)
                        .filter_map(|(_, pos_km)| {
                            // Health check: skip satellites at implausible altitude (decayed or bad TLE)
                            let alt_km = (pos_km[0].powi(2) + pos_km[1].powi(2) + pos_km[2].powi(2)).sqrt() - 6371.0;
                            if alt_km < 100.0 || alt_km > 50_000.0 {
                                return None;
                            }
                            if visible_only {
                                let (_, el) = coords::az_el(obs_km, *pos_km);
                                if el < elev_mask { return None; }
                            }
                            let s = coords::km_to_scene(*pos_km);
                            Some(Mat4::from_translation(vec3(s[0], s[1], s[2])) * sat_scale)
                        })
                        .collect()
                };
                if xf.is_empty() { xf.push(Mat4::from_scale(0.0)); }
                tle_sat_gms[ci].geometry.set_instances(&Instances { transformations: xf, ..Default::default() });
            }
            // Hide Keplerian dots (rings stay as background decoration)
            for sg in &mut sat_gms {
                sg.geometry.set_instances(&Instances {
                    transformations: vec![Mat4::from_scale(0.0)],
                    ..Default::default()
                });
            }
        } else {
            // Keplerian fallback
            let t = sim_epoch as f32;
            let obs_km_kepler = {
                let u = STATE.with(|s| s.borrow().observer.ecef_unit());
                [u[0] * 6371.0, u[1] * 6371.0, u[2] * 6371.0]
            };
            for (idx, s) in states.iter().enumerate() {
                let base = CONST_COLORS[idx];
                sat_gms[idx].material.color = if !cv[idx] {
                    Srgba::new(0, 0, 0, 255)
                } else if highlighted != -1 && highlighted != idx as i32 {
                    Srgba::new(base[0] / 4, base[1] / 4, base[2] / 4, 255)
                } else {
                    Srgba::new(base[0], base[1], base[2], 255)
                };
                let mut xf: Vec<Mat4> = if !cv[idx] {
                    vec![Mat4::from_scale(0.0)]
                } else {
                    (0..s.planes).flat_map(|p| {
                        let raan = s.roff + p as f32 * s.rsp;
                        (0..s.sats_per_plane).filter_map(move |i| {
                            let ma = i as f32 * 2.0 * PI / s.sats_per_plane as f32 + s.mm * t;
                            let p = kpos(s.r, s.inc, raan, ma);
                            if visible_only {
                                let sat_km = [p.x as f64 * 6371.0, p.y as f64 * 6371.0, p.z as f64 * 6371.0];
                                let (_, el) = coords::az_el(obs_km_kepler, sat_km);
                                if el < elev_mask { return None; }
                            }
                            Some(Mat4::from_translation(p) * sat_scale)
                        })
                    }).collect()
                };
                if xf.is_empty() { xf.push(Mat4::from_scale(0.0)); }
                sat_gms[idx].geometry.set_instances(&Instances { transformations: xf, ..Default::default() });
            }
            // Populate sat_ecef_km from Keplerian positions so get_sky_data() works in fallback mode.
            // Keplerian positions are in normalized scene units (Earth radius = 1); multiply by 6371 for km.
            // NOTE: these positions are in the scene/ECEF-like frame, not true ECI. Elevation/azimuth
            // values will be approximately correct for visualization purposes.
            let kepler_ecef: Vec<(u8, [f64; 3])> = states.iter().enumerate().flat_map(|(const_idx, s)| {
                let t_f = sim_epoch as f32;
                (0..s.planes).flat_map(move |p| {
                    let raan = s.roff + p as f32 * s.rsp;
                    (0..s.sats_per_plane).map(move |i| {
                        let ma = i as f32 * 2.0 * PI / s.sats_per_plane as f32 + s.mm * t_f;
                        let pos = kpos(s.r, s.inc, raan, ma);
                        (const_idx as u8, [pos.x as f64 * 6371.0, pos.y as f64 * 6371.0, pos.z as f64 * 6371.0])
                    })
                })
            }).collect();
            STATE.with(|s| s.borrow_mut().sat_ecef_km = kepler_ecef);

            for sg in &mut tle_sat_gms {
                sg.geometry.set_instances(&Instances {
                    transformations: vec![Mat4::from_scale(0.0)],
                    ..Default::default()
                });
            }
        }

        // ── 6. Ground marker ──────────────────────────────────────────────
        let obs_scene = STATE.with(|s| s.borrow().observer.scene_pos());
        ground_marker.geometry.set_transformation(
            Mat4::from_translation(vec3(obs_scene[0], obs_scene[1], obs_scene[2]))
                * Mat4::from_scale(0.06),
        );

        // ── 6b. ECI axes — rotate with GMST ──────────────────────────────────────
        let gmst = coords::gmst_rad(sim_epoch) as f32;
        // ECI X direction in ECEF coords: (cos(GMST), sin(GMST), 0)
        // ECI Y direction in ECEF coords: (-sin(GMST), cos(GMST), 0)
        let eci_x_dir = vec3(gmst.cos(), gmst.sin(), 0.0f32);
        let eci_y_dir = vec3(-gmst.sin(), gmst.cos(), 0.0f32);
        if show_eci_axes {
            let eci_xf = |dir: Vec3| -> Vec<Mat4> {
                (1..=18i32).map(|i| {
                    Mat4::from_translation(dir * (i as f32 * 1.5 / 18.0)) * Mat4::from_scale(0.012)
                }).collect()
            };
            eci_gm_x.geometry.set_instances(&Instances { transformations: eci_xf(eci_x_dir), ..Default::default() });
            eci_gm_y.geometry.set_instances(&Instances { transformations: eci_xf(eci_y_dir), ..Default::default() });
        } else {
            let hidden = vec![Mat4::from_scale(0.0)];
            eci_gm_x.geometry.set_instances(&Instances { transformations: hidden.clone(), ..Default::default() });
            eci_gm_y.geometry.set_instances(&Instances { transformations: hidden, ..Default::default() });
        }

        // ── 6c. Elevation cone ring ───────────────────────────────────────────────
        if show_elev_cone {
            let obs_pos = STATE.with(|s| s.borrow().observer.scene_pos());
            let obs_n = vec3(obs_pos[0], obs_pos[1], obs_pos[2]).normalize();
            // Build orthonormal basis for the observer's local frame
            let up_ref = if obs_n.z.abs() < 0.9 { vec3(0.0f32, 0.0, 1.0) } else { vec3(1.0f32, 0.0, 0.0) };
            let e1 = obs_n.cross(up_ref).normalize();
            let e2 = obs_n.cross(e1).normalize();
            let el_rad = elev_mask as f32 * std::f32::consts::PI / 180.0;
            let ring_r = 1.6f32; // place ring at ~0.6 Earth radii above surface, near sat altitude
            let n_cone_pts = 64i32;
            let cone_xforms: Vec<Mat4> = (0..n_cone_pts).map(|i| {
                let phi = i as f32 * 2.0 * std::f32::consts::PI / n_cone_pts as f32;
                // Direction from observer toward the elevation mask boundary:
                // el_rad above local horizon = 90°-el_rad from zenith
                let dir = (el_rad.sin() * obs_n + el_rad.cos() * (phi.cos() * e1 + phi.sin() * e2)).normalize();
                let pt = dir * ring_r;
                Mat4::from_translation(pt) * Mat4::from_scale(0.009)
            }).collect();
            elev_cone_gm.geometry.set_instances(&Instances { transformations: cone_xforms, ..Default::default() });
        } else {
            elev_cone_gm.geometry.set_instances(&Instances {
                transformations: vec![Mat4::from_scale(0.0)],
                ..Default::default()
            });
        }

        // ── 6d. Country borders — lazy rebuild when inject_borders() called ───────
        if borders_dirty {
            let json_opt = STATE.with(|s| s.borrow().borders_json.clone());
            if let Some(ref json) = json_opt {
                borders_gm = borders::build_border_lines(&context, json);
            }
            STATE.with(|s| s.borrow_mut().borders_dirty = false);
        }

        // ── 7. Render ─────────────────────────────────────────────────────
        let mut objs: Vec<&dyn Object> = vec![&earth, &eq_ring, &graticule, &ground_marker];
        if show_inc_rings {
            for g in &orbit_gms { objs.push(g); }
        }
        for g in &sat_gms    { objs.push(g); }
        for g in &tle_sat_gms { objs.push(g); }
        if show_ecef_axes {
            objs.push(&ecef_gm_x);
            objs.push(&ecef_gm_y);
            objs.push(&ecef_gm_z);
        }
        objs.push(&eci_gm_x);
        objs.push(&eci_gm_y);
        objs.push(&eci_gm_z);
        if show_elev_cone { objs.push(&elev_cone_gm); }
        if let Some(ref brd) = borders_gm {
            if show_borders { objs.push(brd); }
        }

        frame_input
            .screen()
            .clear(ClearState {
                red:   Some(0.01),
                green: Some(0.01),
                blue:  Some(0.01),
                alpha: Some(1.0),
                depth: Some(1.0),
            })
            .render(&camera, objs, &[]);

        FrameOutput::default()
    });
}
