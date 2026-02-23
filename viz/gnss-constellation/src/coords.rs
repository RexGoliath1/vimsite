/// Coordinate system math for GNSS constellation visualizer.
///
/// Pure math — no wasm_bindgen exports, no three-d, no async.
/// All trigonometry uses f64 for precision; km_to_scene downcasts to f32.

/// Unix timestamp (seconds) of J2000.0 epoch (2000-01-01 12:00:00 UTC).
const J2000_UNIX: f64 = 946728000.0;

/// Earth radius in km — used by km_to_scene to normalise to scene units.
const EARTH_R_KM: f64 = 6371.0;

/// Greenwich Mean Sidereal Time for a Unix timestamp (seconds since 1970-01-01 UTC).
///
/// Uses the IAU 1982 linear model accurate to ~0.1 s over ±50 years.
/// Returns GMST in radians [0, 2π).
pub fn gmst_rad(unix_s: f64) -> f64 {
    let d = (unix_s - J2000_UNIX) / 86400.0;
    let gmst_deg = 280.460_618_37 + 360.985_647_366_29 * d;
    gmst_deg.rem_euclid(360.0).to_radians()
}

/// Rotate a position vector from TEME frame to ECEF.
///
/// Applies −GMST rotation about the Z-axis:
/// ```text
/// x_ecef =  cos(gmst) * x_teme + sin(gmst) * y_teme
/// y_ecef = −sin(gmst) * x_teme + cos(gmst) * y_teme
/// z_ecef =  z_teme
/// ```
/// Input/output units are arbitrary and consistent (km or normalised).
pub fn teme_to_ecef(pos_teme: [f64; 3], gmst: f64) -> [f64; 3] {
    let (cg, sg) = (gmst.cos(), gmst.sin());
    [
        cg * pos_teme[0] + sg * pos_teme[1],
        -sg * pos_teme[0] + cg * pos_teme[1],
        pos_teme[2],
    ]
}

/// Convert geodetic (latitude°, longitude°) to an ECEF unit vector.
///
/// Assumes a spherical Earth (radius = 1); altitude and ellipsoid
/// flattening are both ignored — sufficient precision for this viz.
pub fn geodetic_to_ecef_unit(lat_deg: f64, lon_deg: f64) -> [f64; 3] {
    let lat = lat_deg.to_radians();
    let lon = lon_deg.to_radians();
    [
        lat.cos() * lon.cos(),
        lat.cos() * lon.sin(),
        lat.sin(),
    ]
}

/// Azimuth and elevation of a satellite as seen from a ground observer.
///
/// Both `obs_ecef` and `sat_ecef` must be in the same units (km or
/// normalised); only direction matters, magnitudes need not be unit vectors.
///
/// Returns `(azimuth_deg, elevation_deg)` where:
/// - Azimuth: 0 = North, 90 = East, 180 = South, 270 = West (compass convention).
/// - Elevation: −90 to +90, positive above the horizon.
pub fn az_el(obs_ecef: [f64; 3], sat_ecef: [f64; 3]) -> (f64, f64) {
    // Observer geodetic lat/lon from ECEF
    let lon_obs = obs_ecef[1].atan2(obs_ecef[0]);
    let lat_obs = obs_ecef[2].atan2(
        (obs_ecef[0] * obs_ecef[0] + obs_ecef[1] * obs_ecef[1]).sqrt(),
    );

    let (slat, clat) = (lat_obs.sin(), lat_obs.cos());
    let (slon, clon) = (lon_obs.sin(), lon_obs.cos());

    // Look vector (observer → satellite)
    let d = [
        sat_ecef[0] - obs_ecef[0],
        sat_ecef[1] - obs_ecef[1],
        sat_ecef[2] - obs_ecef[2],
    ];

    // Project onto local ENU frame
    let east  = -slon * d[0] + clon * d[1];
    let north = -slat * clon * d[0] - slat * slon * d[1] + clat * d[2];
    let up    =  clat * clon * d[0] + clat * slon * d[1] + slat * d[2];

    let el = up.atan2((east * east + north * north).sqrt()).to_degrees();

    // Compass azimuth: clockwise from North. east.atan2(north) already gives
    // the compass bearing directly (0=N, 90=E, 180=S, 270=W).
    let az = east.atan2(north).to_degrees().rem_euclid(360.0);

    (az, el)
}

/// Normalise an ECEF position from kilometres to scene units where Earth radius = 1.
///
/// Divides each component by `EARTH_R_KM` (6371 km) and casts to f32 for
/// use with three-d / WebGL buffers.
pub fn km_to_scene(pos_km: [f64; 3]) -> [f32; 3] {
    [
        (pos_km[0] / EARTH_R_KM) as f32,
        (pos_km[1] / EARTH_R_KM) as f32,
        (pos_km[2] / EARTH_R_KM) as f32,
    ]
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// GMST at J2000.0 itself must equal 280.46061837° → ≈ 4.8949 rad.
    #[test]
    fn test_gmst_j2000() {
        let g = gmst_rad(J2000_UNIX);
        let expected = 280.460_618_37_f64.to_radians();
        assert!((g - expected).abs() < 1e-9, "gmst at J2000 = {g}, expected {expected}");
    }

    /// GMST must stay within [0, 2π).
    #[test]
    fn test_gmst_range() {
        for offset in [-1e9_f64, 0.0, 1e9, 1.6e9] {
            let g = gmst_rad(J2000_UNIX + offset);
            assert!(g >= 0.0 && g < std::f64::consts::TAU, "gmst out of range: {g}");
        }
    }

    /// Rotation about Z by gmst=0 must be identity.
    #[test]
    fn test_teme_to_ecef_zero_gmst() {
        let pos = [1.0, 2.0, 3.0];
        let out = teme_to_ecef(pos, 0.0);
        for i in 0..3 {
            assert!((out[i] - pos[i]).abs() < 1e-12);
        }
    }

    /// 90° rotation: (1,0,0) → (0,−1,0).
    #[test]
    fn test_teme_to_ecef_quarter_turn() {
        let pos = [1.0, 0.0, 0.0];
        let out = teme_to_ecef(pos, std::f64::consts::FRAC_PI_2);
        assert!((out[0] -  0.0).abs() < 1e-12, "x={}", out[0]);
        assert!((out[1] - -1.0).abs() < 1e-12, "y={}", out[1]);
        assert!((out[2] -  0.0).abs() < 1e-12, "z={}", out[2]);
    }

    /// Equatorial point at lon=0 must be (1, 0, 0).
    #[test]
    fn test_geodetic_equator_prime_meridian() {
        let v = geodetic_to_ecef_unit(0.0, 0.0);
        assert!((v[0] - 1.0).abs() < 1e-12);
        assert!((v[1] - 0.0).abs() < 1e-12);
        assert!((v[2] - 0.0).abs() < 1e-12);
    }

    /// North pole must be (0, 0, 1).
    #[test]
    fn test_geodetic_north_pole() {
        let v = geodetic_to_ecef_unit(90.0, 0.0);
        assert!((v[0] - 0.0).abs() < 1e-12);
        assert!((v[1] - 0.0).abs() < 1e-12);
        assert!((v[2] - 1.0).abs() < 1e-12);
    }

    /// A satellite directly overhead (obs = unit Z, sat = 2×unit Z) must have
    /// elevation = 90° and azimuth is degenerate but well-defined.
    #[test]
    fn test_az_el_directly_overhead() {
        let obs = [0.0, 0.0, 1.0]; // north pole observer
        let sat = [0.0, 0.0, 2.0]; // directly above
        let (_, el) = az_el(obs, sat);
        assert!((el - 90.0).abs() < 1e-9, "elevation={el}");
    }

    /// A satellite on the horizon (same Z, displaced in X) must have elevation ≈ 0°.
    #[test]
    fn test_az_el_on_horizon() {
        let obs = [1.0, 0.0, 0.0]; // observer on equator, prime meridian
        let sat = [1.0, 1.0, 0.0]; // same radius, displaced east
        let (_, el) = az_el(obs, sat);
        assert!(el.abs() < 1e-9, "elevation={el}");
    }

    /// km_to_scene: Earth radius itself must map to [1,0,0].
    #[test]
    fn test_km_to_scene_earth_radius() {
        let out = km_to_scene([6371.0, 0.0, 0.0]);
        assert!((out[0] - 1.0_f32).abs() < 1e-6);
        assert!((out[1] - 0.0_f32).abs() < 1e-6);
        assert!((out[2] - 0.0_f32).abs() < 1e-6);
    }
}
