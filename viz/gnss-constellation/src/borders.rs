// borders.rs — Parses the injected country border JSON and builds
// 3D line-segment geometry on the unit Earth sphere for three-d.
//
// Each polyline segment is rendered as a thin radially-oriented ribbon
// quad (2 triangles) so it is always visible regardless of camera angle.
// This is the standard WebGL approach since GL_LINES is not exposed by
// the three-d 0.18 API.

use three_d::*;

/// Half-width of each border ribbon in scene units (Earth radius = 1.0).
/// 0.003 ≈ 19 km — thin enough to look like a line, thick enough to be
/// visible on the globe.
const RIBBON_HALF_WIDTH: f32 = 0.003;

/// Scalar offset above the Earth surface to avoid z-fighting.
const SURFACE_OFFSET: f32 = 1.001;

/// Parse the borders JSON (from an inject_borders JS call) and return a
/// `Gm` of triangulated ribbon geometry on the unit Earth sphere.
///
/// Format: `{"segments": [[lon0,lat0, lon1,lat1, ...], ...]}`
///
/// Each polyline becomes connected ribbon segments projected onto the
/// unit sphere, lifted slightly above the surface to avoid z-fighting.
/// Returns `None` if JSON parsing fails (graceful degradation).
pub fn build_border_lines(context: &Context, json: &str) -> Option<Gm<Mesh, ColorMaterial>> {
    let root: serde_json::Value = serde_json::from_str(json).ok()?;
    let segments = root.get("segments")?.as_array()?;

    let mut positions: Vec<Vec3> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();

    for seg in segments {
        let coords = match seg.as_array() {
            Some(a) => a,
            None => continue,
        };

        // Each segment is [lon0,lat0, lon1,lat1, ...] — pairs of f64
        let n = coords.len() / 2;
        if n < 2 {
            continue;
        }

        // Collect ECEF unit points for this polyline
        let mut pts: Vec<Vec3> = Vec::with_capacity(n);
        for i in 0..n {
            let lon_deg = match coords[i * 2].as_f64() {
                Some(v) => v,
                None => continue,
            };
            let lat_deg = match coords[i * 2 + 1].as_f64() {
                Some(v) => v,
                None => continue,
            };
            let lon = (lon_deg as f32).to_radians();
            let lat = (lat_deg as f32).to_radians();
            // ECEF unit vector: scene X=cos(lat)cos(lon), Y=cos(lat)sin(lon), Z=sin(lat)
            let x = lat.cos() * lon.cos();
            let y = lat.cos() * lon.sin();
            let z = lat.sin();
            pts.push(vec3(x, y, z) * SURFACE_OFFSET);
        }

        if pts.len() < 2 {
            continue;
        }

        // Build ribbon quads for consecutive point pairs
        for i in 0..pts.len() - 1 {
            let a = pts[i];
            let b = pts[i + 1];

            // Skip degenerate segments
            let seg_vec = b - a;
            if seg_vec.magnitude() < 1e-6 {
                continue;
            }

            // Outward normal: average of the two surface normals (both are
            // already unit vectors since they are projected onto the sphere)
            let outward = (a + b).normalize();

            // Ribbon width direction: perpendicular to the segment within
            // the plane tangent to the sphere at the midpoint
            let width_dir = seg_vec.cross(outward).normalize();

            // 4 corners of the ribbon quad
            let hw = width_dir * RIBBON_HALF_WIDTH;
            let v0 = a - hw; // start left
            let v1 = a + hw; // start right
            let v2 = b + hw; // end right
            let v3 = b - hw; // end left

            // Append vertices and two triangles (CCW winding)
            let base = positions.len() as u32;
            positions.push(v0);
            positions.push(v1);
            positions.push(v2);
            positions.push(v3);

            // Triangle 1: v0, v1, v2
            indices.push(base);
            indices.push(base + 1);
            indices.push(base + 2);
            // Triangle 2: v0, v2, v3
            indices.push(base);
            indices.push(base + 2);
            indices.push(base + 3);
        }
    }

    if positions.is_empty() {
        return None;
    }

    let cpu_mesh = CpuMesh {
        positions: Positions::F32(positions),
        indices: Indices::U32(indices),
        ..Default::default()
    };

    let mesh = Mesh::new(context, &cpu_mesh);
    let material = ColorMaterial {
        color: Srgba::new(180, 180, 180, 200),
        ..Default::default()
    };

    Some(Gm::new(mesh, material))
}
