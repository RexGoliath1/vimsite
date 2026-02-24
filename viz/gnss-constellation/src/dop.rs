/// DOP (Dilution of Precision) computation for the GNSS constellation visualizer.
///
/// Pure math — no wasm_bindgen, no three-d, no async.
/// 4×4 matrix inversion is implemented directly to avoid any external linear-algebra dependency.

/// DOP result for a set of satellites observed from a ground point.
#[derive(Clone, Copy)]
pub struct DopResult {
    pub gdop: f32,
    pub pdop: f32,
    pub hdop: f32,
    pub vdop: f32,
    pub tdop: f32,
    pub n_sats: u32,
}

impl DopResult {
    /// Sentinel returned when fewer than 4 satellites are above the elevation mask.
    pub fn unavailable() -> Self {
        DopResult { gdop: 99.9, pdop: 99.9, hdop: 99.9, vdop: 99.9, tdop: 99.9, n_sats: 0 }
    }
}

/// Compute DOP metrics for a set of satellites seen from an observer.
///
/// # Arguments
/// * `sat_ecef_km` — slice of `(constellation_idx, [x,y,z]_km)` tuples
/// * `obs_km` — observer ECEF position in km
/// * `elev_mask` — elevation mask in degrees; satellites below this are excluded
///
/// Returns `DopResult::unavailable()` if fewer than 4 satellites survive the mask.
pub fn compute_dop(sat_ecef_km: &[(u8, [f64; 3])], obs_km: [f64; 3], elev_mask: f64) -> DopResult {
    use crate::coords;

    // Build H rows: [e, n, u, 1] for each satellite above the elevation mask.
    let rows: Vec<[f32; 4]> = sat_ecef_km
        .iter()
        .filter_map(|(_, pos_km)| {
            let (_, el) = coords::az_el(obs_km, *pos_km);
            if el < elev_mask {
                return None;
            }
            let enu = coords::enu_unit(obs_km, *pos_km);
            Some([enu[0] as f32, enu[1] as f32, enu[2] as f32, 1.0f32])
        })
        .collect();

    let n = rows.len() as u32;
    if n < 4 {
        return DopResult::unavailable();
    }

    // Accumulate H^T * H into a symmetric 4×4 matrix.
    let mut a = [[0.0f64; 4]; 4];
    for row in &rows {
        for i in 0..4 {
            for j in 0..4 {
                a[i][j] += (row[i] * row[j]) as f64;
            }
        }
    }

    // Invert the 4×4 matrix via Gaussian elimination with partial pivoting.
    // Returns None for singular / near-singular matrices.
    let q = match invert4x4(a) {
        Some(m) => m,
        None => return DopResult { n_sats: n, ..DopResult::unavailable() },
    };

    // Diagonal of Q = (H^T H)^{-1}: q[i][i]
    let q00 = q[0][0] as f32;
    let q11 = q[1][1] as f32;
    let q22 = q[2][2] as f32;
    let q33 = q[3][3] as f32;

    if q00 <= 0.0 || q11 <= 0.0 || q22 <= 0.0 || q33 <= 0.0 {
        return DopResult { n_sats: n, ..DopResult::unavailable() };
    }

    DopResult {
        gdop: (q00 + q11 + q22 + q33).sqrt(),
        pdop: (q00 + q11 + q22).sqrt(),
        hdop: (q00 + q11).sqrt(),
        vdop: q22.sqrt(),
        tdop: q33.sqrt(),
        n_sats: n,
    }
}

/// Invert a 4×4 matrix using Gauss-Jordan elimination with partial pivoting.
/// Returns `None` if the matrix is singular (pivot < epsilon).
fn invert4x4(src: [[f64; 4]; 4]) -> Option<[[f64; 4]; 4]> {
    // Augment [src | I]
    let mut m = [[0.0f64; 8]; 4];
    for i in 0..4 {
        for j in 0..4 {
            m[i][j] = src[i][j];
        }
        m[i][i + 4] = 1.0; // identity block
    }

    for col in 0..4 {
        // Partial pivot: find row with largest absolute value in this column
        let mut max_val = m[col][col].abs();
        let mut max_row = col;
        for row in (col + 1)..4 {
            if m[row][col].abs() > max_val {
                max_val = m[row][col].abs();
                max_row = row;
            }
        }

        if max_val < 1e-14 {
            return None; // singular
        }

        // Swap rows
        if max_row != col {
            m.swap(max_row, col);
        }

        // Scale pivot row
        let pivot = m[col][col];
        for j in 0..8 {
            m[col][j] /= pivot;
        }

        // Eliminate column from all other rows
        for row in 0..4 {
            if row == col { continue; }
            let factor = m[row][col];
            for j in 0..8 {
                m[row][j] -= factor * m[col][j];
            }
        }
    }

    // Extract right half (the inverse)
    let mut out = [[0.0f64; 4]; 4];
    for i in 0..4 {
        for j in 0..4 {
            out[i][j] = m[i][j + 4];
        }
    }
    Some(out)
}
