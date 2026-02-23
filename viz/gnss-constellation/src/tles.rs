// tles.rs — TLE data management and SGP4 propagation for gnss-constellation WASM viz
//
// Responsibilities:
//   - Parse Celestrak OMM JSON into SatRecord structs
//   - Classify satellites by constellation (GPS, GLONASS, Galileo, BeiDou, other)
//   - Propagate satellite positions via sgp4 crate (TEME frame, km)
//   - Keplerian fallback when sgp4 fails (long-range sim or bad elements)
//   - Epoch helpers: parse ISO / "YYYY-DDD.FFF" strings to Unix timestamps

use js_sys;
use serde::Deserialize;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Earth radius in km — used by Keplerian fallback to convert normalised units → km.
const EARTH_R: f64 = 6371.0;

/// Gravitational parameter μ = GM (km³/s²) — used for mean-motion sanity, not propagation.
#[allow(dead_code)]
const MU: f64 = 398_600.4418;

// ---------------------------------------------------------------------------
// Constellation indices (u8 flags passed back to JS / three-d renderer)
// ---------------------------------------------------------------------------

pub const CONSTELLATION_GPS: u8 = 0;
pub const CONSTELLATION_GLONASS: u8 = 1;
pub const CONSTELLATION_GALILEO: u8 = 2;
pub const CONSTELLATION_BEIDOU: u8 = 3;
pub const CONSTELLATION_OTHER: u8 = 4;

// ---------------------------------------------------------------------------
// Celestrak OMM JSON schema (serde Deserialize)
// ---------------------------------------------------------------------------
//
// Celestrak returns a JSON array; each element matches this struct.
// Fields marked `default` are optional in the feed but required by sgp4.

#[derive(Debug, Deserialize)]
struct OmmRecord {
    #[serde(rename = "OBJECT_NAME")]
    object_name: String,

    #[serde(rename = "NORAD_CAT_ID")]
    norad_cat_id: u64,

    /// Epoch as "YYYY-DDD.FFFFFFFF" or "YYYY-MM-DDTHH:MM:SS[.sss]"
    #[serde(rename = "EPOCH")]
    epoch: String,

    /// Revolutions per day
    #[serde(rename = "MEAN_MOTION")]
    mean_motion: f64,

    #[serde(rename = "ECCENTRICITY")]
    eccentricity: f64,

    /// Degrees
    #[serde(rename = "INCLINATION")]
    inclination: f64,

    /// Right ascension of ascending node, degrees
    #[serde(rename = "RA_OF_ASC_NODE")]
    ra_of_asc_node: f64,

    /// Argument of pericenter, degrees
    #[serde(rename = "ARG_OF_PERICENTER")]
    arg_of_pericenter: f64,

    /// Mean anomaly, degrees
    #[serde(rename = "MEAN_ANOMALY")]
    mean_anomaly: f64,

    /// B* drag term (1/earth_radii)
    #[serde(rename = "BSTAR", default)]
    bstar: f64,

    /// First derivative of mean motion (rev/day²)
    #[serde(rename = "MEAN_MOTION_DOT", default)]
    mean_motion_dot: f64,

    /// Second derivative of mean motion (rev/day³)
    #[serde(rename = "MEAN_MOTION_DDOT", default)]
    mean_motion_ddot: f64,
}

// ---------------------------------------------------------------------------
// Public data types
// ---------------------------------------------------------------------------

/// One satellite record with pre-computed sgp4 Constants for fast per-frame propagation.
pub struct SatRecord {
    pub name: String,
    /// 0=GPS 1=GLONASS 2=Galileo 3=BeiDou 4=other
    pub constellation: u8,
    /// Pre-initialised sgp4 propagator constants (expensive to build, cache here).
    pub constants: sgp4::Constants,
    /// TLE epoch expressed as Unix timestamp (seconds since 1970-01-01T00:00:00Z).
    pub epoch_unix: f64,
    // Keplerian fallback parameters (used when sgp4 returns an error)
    /// Inclination in radians
    pub inclination_rad: f32,
    /// RAAN in radians
    pub raan_rad: f32,
    /// Altitude above Earth surface (semi-major axis - Earth radius), km
    pub alt_km: f32,
    /// Mean motion in rad/s (for Keplerian fallback)
    pub mean_motion_rad_s: f32,
}

/// Container for all loaded satellite records.
pub struct TleStore {
    pub records: Vec<SatRecord>,
}

// ---------------------------------------------------------------------------
// TleStore implementation
// ---------------------------------------------------------------------------

impl TleStore {
    pub fn new() -> Self {
        TleStore {
            records: Vec::new(),
        }
    }

    /// Parse a Celestrak OMM JSON string, append records to the store.
    /// Returns the count of successfully parsed satellites, or an error string.
    pub fn load_from_json(&mut self, json: &str) -> Result<usize, String> {
        let omm_records: Vec<OmmRecord> =
            serde_json::from_str(json).map_err(|e| format!("JSON parse error: {e}"))?;

        let mut count = 0usize;

        for omm in &omm_records {
            // --- Extract NORAD ID (already u64 from JSON) ---
            let norad_id: u64 = omm.norad_cat_id;

            // --- Parse epoch to (year_2digit, day_of_year, unix_ts) ---
            let (epoch_year, epoch_doy, epoch_unix) =
                match parse_epoch(&omm.epoch) {
                    Some(v) => v,
                    None => {
                        // Skip records with unparseable epochs
                        continue;
                    }
                };

            // --- Build chrono::NaiveDateTime from the parsed epoch_unix timestamp ---
            let datetime = chrono::DateTime::from_timestamp(
                epoch_unix as i64,
                (epoch_unix.fract().abs() * 1e9) as u32,
            )
            .map(|dt| dt.naive_utc())
            .unwrap_or(chrono::DateTime::UNIX_EPOCH.naive_utc());

            // --- Build sgp4::Elements ---
            // object_name / international_designator require sgp4 "alloc" feature —
            // omit them to avoid the cfg-guard; the satellite name lives in SatRecord.name.
            let elements = sgp4::Elements {
                norad_id,
                classification: sgp4::Classification::Unclassified,
                datetime,
                ephemeris_type: 0,
                mean_motion_dot: omm.mean_motion_dot,
                mean_motion_ddot: omm.mean_motion_ddot,
                drag_term: omm.bstar,
                element_set_number: 0,
                inclination: omm.inclination,
                right_ascension: omm.ra_of_asc_node,
                eccentricity: omm.eccentricity,
                argument_of_perigee: omm.arg_of_pericenter,
                mean_anomaly: omm.mean_anomaly,
                mean_motion: omm.mean_motion,
                revolution_number: 0,
            };

            // --- Build sgp4::Constants (expensive, do once per satellite) ---
            let constants = match sgp4::Constants::from_elements(&elements) {
                Ok(c) => c,
                Err(_) => {
                    // Bad elements — skip this satellite
                    continue;
                }
            };

            // --- Keplerian fallback parameters ---
            // Mean motion: rev/day → rad/s
            //   rev/day × 2π / 86400 = rad/s
            let mean_motion_rad_s = (omm.mean_motion * 2.0 * std::f64::consts::PI / 86400.0) as f32;

            // Semi-major axis from mean motion (for alt_km):
            //   n = sqrt(μ / a³)  →  a = (μ / n²)^(1/3)   where n is in rad/s
            let n_rad_s = mean_motion_rad_s as f64;
            let a_km = (MU / (n_rad_s * n_rad_s)).powf(1.0 / 3.0);
            let alt_km = (a_km - EARTH_R) as f32;

            let inclination_rad = omm.inclination.to_radians() as f32;
            let raan_rad = omm.ra_of_asc_node.to_radians() as f32;

            // --- Constellation classification ---
            let constellation = classify_constellation(&omm.object_name, norad_id);

            self.records.push(SatRecord {
                name: omm.object_name.clone(),
                constellation,
                constants,
                epoch_unix,
                inclination_rad,
                raan_rad,
                alt_km,
                mean_motion_rad_s,
            });

            count += 1;
        }

        Ok(count)
    }

    /// Propagate all satellites to the given Unix timestamp (seconds).
    ///
    /// Returns a Vec of `(constellation_idx, [x_km, y_km, z_km])` in TEME frame.
    /// Note: TEME ≈ ECI at GNSS altitudes — GMST rotation (ECI→ECEF) is a Phase 2 concern.
    ///
    /// Falls back to circular Keplerian propagation if sgp4 returns an error
    /// (e.g., satellite below horizon, long time extrapolation, near-degenerate elements).
    pub fn propagate_all(&self, unix_s: f64) -> Vec<(u8, [f64; 3])> {
        let mut out = Vec::with_capacity(self.records.len());

        for rec in &self.records {
            // Minutes since TLE epoch — sgp4 expects this as its time argument.
            let minutes = (unix_s - rec.epoch_unix) / 60.0;

            // TODO: verify sgp4 v2.3 propagate API; MinutesSinceEpoch may be a newtype.
            let pos: [f64; 3] = match rec.constants.propagate(sgp4::MinutesSinceEpoch(minutes)) {
                Ok(prediction) => {
                    // prediction.position is [f64; 3] in km, TEME frame
                    prediction.position
                }
                Err(_) => {
                    // SGP4 failed — use circular Keplerian fallback.
                    // This happens for:
                    //   - Very large |minutes| (element set too old)
                    //   - Satellites with unusual eccentricity driving them below Earth
                    //   - Numerical issues in SGP4 deep-space model
                    keplerian_pos(
                        rec.alt_km,
                        rec.inclination_rad,
                        rec.raan_rad,
                        rec.mean_motion_rad_s,
                        rec.epoch_unix,
                        unix_s,
                    )
                }
            };

            out.push((rec.constellation, pos));
        }

        out
    }

    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }
}

// ---------------------------------------------------------------------------
// Constellation classification
// ---------------------------------------------------------------------------

/// Classify a satellite by name prefix and NORAD ID.
///
/// Classification rules (name checked first, then NORAD ranges):
///   GPS      — name starts with "GPS" or "NAVSTAR"
///   GLONASS  — name starts with "COSMOS" or "GLONASS"  (NORAD 11: 11-20xxx range broadly)
///   Galileo  — name starts with "GSAT" or "GALILEO"
///   BeiDou   — name starts with "BEIDOU", "BDSM", or contains "BEIDOU"
///   Other    — everything else (include in render, mark separately)
fn classify_constellation(name: &str, _norad_id: u64) -> u8 {
    let up = name.to_ascii_uppercase();

    if up.starts_with("GPS") || up.starts_with("NAVSTAR") {
        return CONSTELLATION_GPS;
    }
    if up.starts_with("GLONASS") || up.starts_with("COSMOS") {
        return CONSTELLATION_GLONASS;
    }
    if up.starts_with("GSAT") || up.starts_with("GALILEO") {
        return CONSTELLATION_GALILEO;
    }
    if up.starts_with("BEIDOU") || up.starts_with("BDSM") || up.contains("BEIDOU") {
        return CONSTELLATION_BEIDOU;
    }

    CONSTELLATION_OTHER
}

// ---------------------------------------------------------------------------
// Keplerian fallback
// ---------------------------------------------------------------------------

/// Circular Keplerian position in TEME ≈ ECI frame, returned in km.
///
/// This is the same orbital geometry used in the Phase 1 Keplerian sim
/// (see `kpos` in lib.rs), adapted to accept real orbital elements and
/// return km rather than normalised scene units.
///
/// Arguments:
///   alt_km        — altitude above Earth surface (semi-major axis - R_earth), km
///   inc           — inclination, radians
///   raan          — right ascension of ascending node, radians
///   mm_rad_s      — mean motion, rad/s
///   epoch_unix    — TLE epoch as Unix timestamp (seconds)
///   unix_s        — target time as Unix timestamp (seconds)
///
/// Coordinate derivation:
///   1. Propagate mean anomaly from epoch: M = mm_rad_s × (t - t₀)
///   2. Circular orbit in orbital plane: (r·cos M, r·sin M, 0)  [perifocal frame]
///   3. Rotate by inclination around x-axis (tilt the plane)
///   4. Rotate by RAAN around z-axis (orient the ascending node)
///   Result is in ECI/TEME (z = north, y = completes right-hand frame).
fn keplerian_pos(
    alt_km: f32,
    inc: f32,
    raan: f32,
    mm_rad_s: f32,
    epoch_unix: f64,
    unix_s: f64,
) -> [f64; 3] {
    let r_km = EARTH_R as f32 + alt_km; // orbit radius in km

    // Elapsed time since TLE epoch (seconds)
    let dt = (unix_s - epoch_unix) as f32;

    // Mean anomaly at target time (radians) — starts at 0 at epoch
    // (For a more accurate fallback we could read mean_anomaly_at_epoch, but
    //  for Phase 1 visual purposes starting at 0 is fine and matches lib.rs kpos.)
    let ma = mm_rad_s * dt;

    // Position in orbital plane (perifocal frame, eccentricity = 0 ⟹ E = M):
    //   x_orb = r cos M,  y_orb = 0 (in-plane normal),  z_orb = r sin M
    let x_orb = r_km * ma.cos(); // along line of nodes at M=0
    let z_orb = r_km * ma.sin(); // 90° ahead in orbit

    // Rotate by inclination: tilt the orbital plane out of the equatorial plane.
    //   After inc rotation around x_orb axis:
    //     x stays the same (x_orb)
    //     y_eci  = z_orb * sin(inc)   (out-of-plane = north for prograde orbits)
    //     z_eq   = z_orb * cos(inc)   (equatorial projection of z_orb)
    let y_eci = z_orb * inc.sin();
    let z_eq = z_orb * inc.cos();

    // Rotate by RAAN: spin the ascending node to the correct longitude.
    //   x_eci = x_orb cos(RAAN) - z_eq sin(RAAN)
    //   z_eci = x_orb sin(RAAN) + z_eq cos(RAAN)
    let x_eci = x_orb * raan.cos() - z_eq * raan.sin();
    let z_eci = x_orb * raan.sin() + z_eq * raan.cos();

    [x_eci as f64, y_eci as f64, z_eci as f64]
}

// ---------------------------------------------------------------------------
// Epoch helpers
// ---------------------------------------------------------------------------

/// Parse a Celestrak epoch string to `(year_2digit: u64, day_of_year: f64, unix_ts: f64)`.
///
/// Supported formats:
///   "YYYY-DDD.FFFFFFFF"   — e.g. "2024-001.50000000"
///   "YYYY-MM-DDTHH:MM:SS" — e.g. "2024-01-15T12:00:00"
///   "YYYY-MM-DDTHH:MM:SS.sss" — with fractional seconds
///
/// Returns `None` if the string cannot be parsed.
fn parse_epoch(epoch_str: &str) -> Option<(u64, f64, f64)> {
    let s = epoch_str.trim();

    // Detect format by counting '-' separators before 'T' (or before '.').
    // "YYYY-DDD.FFF" has exactly one '-' before the '.'.
    // "YYYY-MM-DDTHH:MM:SS" has two '-' before 'T'.
    if s.contains('T') {
        parse_epoch_iso(s)
    } else {
        parse_epoch_doy(s)
    }
}

/// Parse "YYYY-DDD.FFFFFFFF" format.
fn parse_epoch_doy(s: &str) -> Option<(u64, f64, f64)> {
    // Split on '-': ["YYYY", "DDD.FFFFFFFF"]
    let mut parts = s.splitn(2, '-');
    let year_str = parts.next()?.trim();
    let doy_str = parts.next()?.trim();

    let year_full: u64 = year_str.parse().ok()?;
    let doy: f64 = doy_str.parse().ok()?;

    let year_2digit = year_full % 100;
    let unix_ts = doy_and_year_to_unix(year_full, doy)?;

    Some((year_2digit, doy, unix_ts))
}

/// Parse "YYYY-MM-DDTHH:MM:SS[.sss]" format.
fn parse_epoch_iso(s: &str) -> Option<(u64, f64, f64)> {
    // Split on 'T'
    let mut halves = s.splitn(2, 'T');
    let date_part = halves.next()?.trim();
    let time_part = halves.next().unwrap_or("00:00:00").trim();

    // Date: "YYYY-MM-DD"
    let mut date_parts = date_part.splitn(3, '-');
    let year_full: u64 = date_parts.next()?.parse().ok()?;
    let month: u32 = date_parts.next()?.parse().ok()?;
    let day: u32 = date_parts.next()?.parse().ok()?;

    // Time: "HH:MM:SS[.sss]"
    let mut time_parts = time_part.splitn(3, ':');
    let hh: u64 = time_parts.next()?.parse().ok()?;
    let mm: u64 = time_parts.next()?.parse().ok()?;
    let ss_str = time_parts.next().unwrap_or("0");
    let ss: f64 = ss_str.parse().ok()?;

    // Convert to fractional day-of-year
    let doy_int = day_of_year(year_full, month, day)?;
    // Day-of-year is 1-indexed; fractional part from HH:MM:SS
    let frac_day = (hh as f64 * 3600.0 + mm as f64 * 60.0 + ss) / 86400.0;
    let doy = doy_int as f64 + frac_day;

    let year_2digit = year_full % 100;
    let unix_ts = doy_and_year_to_unix(year_full, doy)?;

    Some((year_2digit, doy, unix_ts))
}

/// Convert (year, fractional day-of-year) to Unix timestamp (seconds since 1970-01-01).
///
/// Algorithm:
///   1. Compute Unix timestamp for Jan 1 00:00:00 UTC of `year`.
///   2. Add (doy - 1) * 86400.0  (doy is 1-indexed: Jan 1 = day 1.0).
fn doy_and_year_to_unix(year: u64, doy: f64) -> Option<f64> {
    // Seconds from 1970 to Jan 1 of `year` (UTC, no leap seconds).
    // We compute elapsed years and account for leap years.
    // Leap year: divisible by 4, except centuries unless divisible by 400.
    let base_unix = years_to_unix(year)?;
    // doy is 1-indexed: doy=1.0 → Jan 1 00:00:00 → no offset added
    let unix_ts = base_unix as f64 + (doy - 1.0) * 86400.0;
    Some(unix_ts)
}

/// Compute Unix timestamp (seconds) for midnight UTC on Jan 1 of the given year.
/// Valid for years 1970–2100 (covers all plausible TLE epochs).
fn years_to_unix(year: u64) -> Option<i64> {
    if year < 1970 || year > 2100 {
        return None;
    }
    let mut days: i64 = 0;
    for y in 1970..year {
        days += if is_leap_year(y) { 366 } else { 365 };
    }
    Some(days * 86400)
}

/// Returns true if the given year is a Gregorian leap year.
fn is_leap_year(year: u64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

/// Return the 1-indexed day-of-year for a given (year, month [1-12], day [1-31]).
fn day_of_year(year: u64, month: u32, day: u32) -> Option<u32> {
    // Cumulative days before each month (non-leap)
    const MONTH_DAYS: [u32; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    if month < 1 || month > 12 {
        return None;
    }
    let mut doy: u32 = 0;
    for m in 0..(month - 1) as usize {
        doy += MONTH_DAYS[m];
        // Add leap day after February (month index 1) in leap years
        if m == 1 && is_leap_year(year) {
            doy += 1;
        }
    }
    doy += day;
    Some(doy)
}

// ---------------------------------------------------------------------------
// Public epoch helpers (called from lib.rs)
// ---------------------------------------------------------------------------

/// Parse a Celestrak epoch string ("YYYY-DDD.FFF" or ISO "YYYY-MM-DDTHH:MM:SS")
/// to a Unix timestamp (seconds since 1970-01-01T00:00:00Z).
///
/// Returns 0.0 on parse failure (caller should treat as unknown epoch).
#[allow(dead_code)]
pub fn epoch_str_to_unix(epoch_str: &str) -> f64 {
    parse_epoch(epoch_str)
        .map(|(_, _, unix)| unix)
        .unwrap_or(0.0)
}

/// Current time as Unix timestamp (seconds), sourced from `js_sys::Date::now()`.
///
/// `Date.now()` returns milliseconds since Unix epoch; divide by 1000 for seconds.
#[allow(dead_code)]
pub fn now_unix() -> f64 {
    js_sys::Date::now() / 1000.0
}

// ---------------------------------------------------------------------------
// Tests (run with `cargo test --target x86_64-unknown-linux-gnu`)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_leap_year() {
        assert!(is_leap_year(2000));
        assert!(is_leap_year(2024));
        assert!(!is_leap_year(1900));
        assert!(!is_leap_year(2023));
    }

    #[test]
    fn test_day_of_year() {
        // Jan 1 = day 1
        assert_eq!(day_of_year(2024, 1, 1), Some(1));
        // Mar 1 in leap year 2024: 31 (Jan) + 29 (Feb) + 1 = 61
        assert_eq!(day_of_year(2024, 3, 1), Some(61));
        // Mar 1 in non-leap year 2023: 31 + 28 + 1 = 60
        assert_eq!(day_of_year(2023, 3, 1), Some(60));
        // Dec 31 in non-leap year
        assert_eq!(day_of_year(2023, 12, 31), Some(365));
    }

    #[test]
    fn test_years_to_unix() {
        // 1970 Jan 1 = Unix 0
        assert_eq!(years_to_unix(1970), Some(0));
        // 1971 Jan 1 = 365 days * 86400
        assert_eq!(years_to_unix(1971), Some(365 * 86400));
    }

    #[test]
    fn test_parse_epoch_doy() {
        // "2024-001.50000000" → day 1.5 of 2024
        let result = parse_epoch("2024-001.50000000");
        assert!(result.is_some());
        let (yr2, doy, _unix) = result.unwrap();
        assert_eq!(yr2, 24);
        assert!((doy - 1.5).abs() < 1e-6);
    }

    #[test]
    fn test_parse_epoch_iso() {
        // "2024-01-15T12:00:00" → Jan 15 noon = day 15.5
        let result = parse_epoch("2024-01-15T12:00:00");
        assert!(result.is_some());
        let (yr2, doy, _unix) = result.unwrap();
        assert_eq!(yr2, 24);
        // Jan 15 noon = day 15 + 0.5 = 15.5
        assert!((doy - 15.5).abs() < 1e-6, "doy was {doy}");
    }

    #[test]
    fn test_classify_constellation() {
        assert_eq!(classify_constellation("GPS BIIA-10", 11054), CONSTELLATION_GPS);
        assert_eq!(classify_constellation("NAVSTAR 68", 40534), CONSTELLATION_GPS);
        assert_eq!(classify_constellation("GLONASS-M 752", 32276), CONSTELLATION_GLONASS);
        assert_eq!(classify_constellation("COSMOS 2471", 37139), CONSTELLATION_GLONASS);
        assert_eq!(classify_constellation("GSAT0211", 41859), CONSTELLATION_GALILEO);
        assert_eq!(classify_constellation("GALILEO 5", 37846), CONSTELLATION_GALILEO);
        assert_eq!(classify_constellation("BEIDOU-3 M1", 43001), CONSTELLATION_BEIDOU);
        assert_eq!(classify_constellation("UNKNOWN SAT", 99999), CONSTELLATION_OTHER);
    }

    #[test]
    fn test_keplerian_pos_origin_at_epoch() {
        // At epoch (dt=0), mean anomaly = 0 → satellite is at (r, 0, 0) rotated by RAAN.
        // For inc=0, raan=0: position should be (r_km, 0, 0).
        let alt_km = 20200.0f32; // GPS altitude
        let r_km = EARTH_R as f32 + alt_km;
        let pos = keplerian_pos(
            alt_km,
            0.0,  // inclination = 0
            0.0,  // RAAN = 0
            0.001, // mean motion (arbitrary)
            0.0,  // epoch_unix
            0.0,  // target = epoch → dt=0
        );
        // x ≈ r_km, y ≈ 0, z ≈ 0
        assert!((pos[0] - r_km as f64).abs() < 0.01, "x={}", pos[0]);
        assert!(pos[1].abs() < 0.01, "y={}", pos[1]);
        assert!(pos[2].abs() < 0.01, "z={}", pos[2]);
    }
}
