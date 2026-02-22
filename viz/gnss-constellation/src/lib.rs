use std::cell::Cell;
use std::f32::consts::PI;

use three_d::*;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

// ---------------------------------------------------------------------------
// Constellation definitions (Keplerian elements — Phase 1 sim data)
// Phase 2: replace with live TLE propagation via sgp4 crate
// ---------------------------------------------------------------------------

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
    ConstellationDef { rgb: [57, 255, 20],  alt_km: 20200.0, inc_deg: 55.0,  planes: 6, sats_per_plane: 4,  raan_spacing_deg: 60.0,  raan_offset_deg: 0.0  }, // GPS
    ConstellationDef { rgb: [255, 68, 68],  alt_km: 19130.0, inc_deg: 64.8,  planes: 3, sats_per_plane: 8,  raan_spacing_deg: 120.0, raan_offset_deg: 15.0 }, // GLONASS
    ConstellationDef { rgb: [0, 255, 204],  alt_km: 23222.0, inc_deg: 56.0,  planes: 3, sats_per_plane: 10, raan_spacing_deg: 120.0, raan_offset_deg: 40.0 }, // Galileo
    ConstellationDef { rgb: [255, 170, 0],  alt_km: 21528.0, inc_deg: 55.0,  planes: 3, sats_per_plane: 8,  raan_spacing_deg: 120.0, raan_offset_deg: 80.0 }, // BeiDou MEO
];

const EARTH_R: f32 = 6371.0;  // km
const MU: f32 = 398600.4418;  // km³/s²
const RING_PTS: u32 = 80;     // points per orbit ring

thread_local! {
    static TIME_WARP: Cell<f64> = Cell::new(50.0); // sim seconds per real second
}

#[wasm_bindgen]
pub fn set_time_warp(factor: f64) {
    TIME_WARP.with(|w| w.set(factor));
}

fn alt_norm(alt_km: f32) -> f32 { (EARTH_R + alt_km) / EARTH_R }

fn period_s(alt_km: f32) -> f32 {
    let a = EARTH_R + alt_km;
    2.0 * PI * (a * a * a / MU).sqrt()
}

/// Keplerian position — TEME ≈ ECI at GNSS altitudes, fine for Phase 1 viz.
/// Returns position in normalised units (Earth radius = 1.0).
fn kpos(r: f32, inc: f32, raan: f32, m: f32) -> Vec3 {
    let (xo, zo) = (r * m.cos(), r * m.sin());
    let y  = zo * inc.sin();
    let ze = zo * inc.cos();
    vec3(xo * raan.cos() - ze * raan.sin(), y, xo * raan.sin() + ze * raan.cos())
}

// ---------------------------------------------------------------------------
// Entry point — Phase 1: three-d WebGL2 render with Keplerian animation
// ---------------------------------------------------------------------------

#[wasm_bindgen(start)]
pub fn start() {
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
    // min/max distance clamp — partial mitigation for OrbitControl WASM zoom bug #403
    let mut control = OrbitControl::new(camera.target(), 2.0, 25.0);

    // Earth sphere (Earth radius = 1.0 in scene units)
    let earth = Gm::new(
        Mesh::new(&context, &CpuMesh::sphere(32)),
        ColorMaterial {
            color: Srgba::new(8, 20, 8, 255),
            ..Default::default()
        },
    );

    // Equatorial ring
    let eq_ring = Gm::new(
        Mesh::new(&context, &CpuMesh::circle(128)),
        ColorMaterial {
            color: Srgba::new(20, 60, 20, 255),
            ..Default::default()
        },
    );

    // Build orbit rings (static geometry) and satellite instance meshes
    let ring_dot = CpuMesh::sphere(3);
    let sat_dot  = CpuMesh::sphere(4);
    let ring_scale = Mat4::from_scale(0.009);
    let sat_scale  = Mat4::from_scale(0.04);

    // Runtime state captured into render loop closure
    struct SatState {
        r: f32, inc: f32, rsp: f32, roff: f32, mm: f32,
        planes: u32, sats_per_plane: u32,
    }

    let mut orbit_gms: Vec<Gm<InstancedMesh, ColorMaterial>> = Vec::new();
    let mut sat_gms:   Vec<Gm<InstancedMesh, ColorMaterial>> = Vec::new();
    let mut states:    Vec<SatState> = Vec::new();

    for def in SATS {
        let r    = alt_norm(def.alt_km);
        let inc  = def.inc_deg.to_radians();
        let rsp  = def.raan_spacing_deg.to_radians();
        let roff = def.raan_offset_deg.to_radians();
        let mm   = 2.0 * PI / period_s(def.alt_km);

        let sat_col  = Srgba::new(def.rgb[0], def.rgb[1], def.rgb[2], 255);
        let ring_col = Srgba::new(def.rgb[0] / 7, def.rgb[1] / 7, def.rgb[2] / 7, 255);

        // Orbit ring: RING_PTS dots per plane × planes
        let ring_xforms: Vec<Mat4> = (0..def.planes)
            .flat_map(|p| {
                let raan = roff + p as f32 * rsp;
                (0..RING_PTS).map(move |i| {
                    let a = i as f32 * 2.0 * PI / RING_PTS as f32;
                    Mat4::from_translation(kpos(r, inc, raan, a)) * ring_scale
                })
            })
            .collect();

        orbit_gms.push(Gm::new(
            InstancedMesh::new(
                &context,
                &Instances { transformations: ring_xforms, ..Default::default() },
                &ring_dot,
            ),
            ColorMaterial { color: ring_col, ..Default::default() },
        ));

        // Satellite mesh — identity transforms, updated every frame
        let n = def.planes * def.sats_per_plane;
        sat_gms.push(Gm::new(
            InstancedMesh::new(
                &context,
                &Instances { transformations: vec![Mat4::identity(); n as usize], ..Default::default() },
                &sat_dot,
            ),
            ColorMaterial { color: sat_col, ..Default::default() },
        ));

        states.push(SatState { r, inc, rsp, roff, mm, planes: def.planes, sats_per_plane: def.sats_per_plane });
    }

    let mut sim_time = 0.0f64;

    window.render_loop(move |mut frame_input| {
        sim_time += frame_input.elapsed_time * TIME_WARP.with(|w| w.get());
        let t = sim_time as f32;

        control.handle_events(&mut camera, &mut frame_input.events);
        camera.set_viewport(frame_input.viewport);

        // Update satellite positions each frame
        for (idx, s) in states.iter().enumerate() {
            let xforms: Vec<Mat4> = (0..s.planes)
                .flat_map(|p| {
                    let raan = s.roff + p as f32 * s.rsp;
                    (0..s.sats_per_plane).map(move |i| {
                        let ma = i as f32 * 2.0 * PI / s.sats_per_plane as f32 + s.mm * t;
                        Mat4::from_translation(kpos(s.r, s.inc, raan, ma)) * sat_scale
                    })
                })
                .collect();
            sat_gms[idx].geometry.set_instances(&Instances {
                transformations: xforms,
                ..Default::default()
            });
        }

        let mut objs: Vec<&dyn Object> = Vec::new();
        objs.push(&earth);
        objs.push(&eq_ring);
        for g in &orbit_gms { objs.push(g); }
        for g in &sat_gms   { objs.push(g); }

        frame_input
            .screen()
            .clear(ClearState { red: Some(0.01), green: Some(0.01), blue: Some(0.01), alpha: Some(1.0), depth: Some(1.0) })
            .render(&camera, objs, &[]);

        FrameOutput::default()
    });
}

// ---------------------------------------------------------------------------
// Phase 2 stubs: TLE fetch + SGP4 propagation
// ---------------------------------------------------------------------------

const TLE_URL: &str = "https://celestrak.org/NORAD/elements/gp.php?GROUP=gnss&FORMAT=json";

#[allow(dead_code)]
async fn fetch_tles() -> Result<String, JsValue> {
    // TODO: check Cache API for fresh entry (< 12 h old)
    // TODO: if stale/missing, fetch TLE_URL via gloo_net::http::Request
    // TODO: store response in Cache API with x-fetched-at timestamp header
    todo!("fetch_tles not yet implemented")
}

/// Parse Celestrak OMM JSON and propagate all satellites to current time.
/// Returns a JsValue array of {name, x, y, z} objects (TEME frame, km).
/// Note: TEME ≈ ECI at GNSS altitudes — GMST rotation deferred to Phase 2.
#[wasm_bindgen]
pub fn propagate(tle_json: &str) -> Result<JsValue, JsValue> {
    // TODO: deserialise tle_json into Vec<sgp4::Elements>
    // TODO: for each: Constants::from_elements() + constants.propagate(minutes)
    // TODO: return via serde_wasm_bindgen::to_value()
    let _ = tle_json;
    todo!("propagate not yet implemented")
}
