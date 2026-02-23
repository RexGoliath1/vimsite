/* tslint:disable */
/* eslint-disable */

/**
 * Returns the current camera view-projection matrix as a Vec of 16 f64 values (column-major).
 * Each frame this is updated by the render loop. Used by JS for screen-space axis label projection.
 */
export function get_camera_vp_matrix(): Float64Array;

export function get_sim_epoch(): number;

/**
 * Returns a JS Array of sky-plot entries for the current sim epoch.
 * Each entry: `{ name, constellation, az_deg, el_deg, r, g, b, c_n0 }`
 */
export function get_sky_data(): any;

/**
 * Returns the number of TLE satellite records currently loaded.
 * Call after inject_tles() to verify the JSON was successfully parsed.
 * Returns 0 if inject_tles() has not been called or if the JSON failed to parse.
 */
export function get_tle_count(): number;

export function inject_borders(json: string): void;

export function inject_tles(json: string): void;

export function set_elev_mask(v: number): void;

export function set_ground_location(lat: number, lon: number): void;

export function set_highlighted_constellation(idx: number): void;

export function set_paused(on: boolean): void;

export function set_show_borders(on: boolean): void;

export function set_show_ecef_axes(on: boolean): void;

export function set_show_eci_axes(on: boolean): void;

export function set_show_elev_cone(on: boolean): void;

export function set_show_inc_rings(on: boolean): void;

export function set_sim_epoch(unix_s: number): void;

export function set_time_warp(v: number): void;

export function set_visible_only(on: boolean): void;

export function start(): void;

export function toggle_constellation(idx: number, on: boolean): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly get_camera_vp_matrix: () => [number, number];
    readonly get_sim_epoch: () => number;
    readonly get_sky_data: () => any;
    readonly get_tle_count: () => number;
    readonly inject_borders: (a: number, b: number) => void;
    readonly inject_tles: (a: number, b: number) => void;
    readonly set_elev_mask: (a: number) => void;
    readonly set_ground_location: (a: number, b: number) => void;
    readonly set_highlighted_constellation: (a: number) => void;
    readonly set_paused: (a: number) => void;
    readonly set_show_borders: (a: number) => void;
    readonly set_show_ecef_axes: (a: number) => void;
    readonly set_show_eci_axes: (a: number) => void;
    readonly set_show_elev_cone: (a: number) => void;
    readonly set_show_inc_rings: (a: number) => void;
    readonly set_sim_epoch: (a: number) => void;
    readonly set_time_warp: (a: number) => void;
    readonly set_visible_only: (a: number) => void;
    readonly start: () => void;
    readonly toggle_constellation: (a: number, b: number) => void;
    readonly wasm_bindgen__closure__destroy__h9ce5017ecb4fb027: (a: number, b: number) => void;
    readonly wasm_bindgen__closure__destroy__h5a7df7e0ff64d37c: (a: number, b: number) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h0c5132cdd4deee4b: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h0c5132cdd4deee4b_1: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h0c5132cdd4deee4b_2: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h0c5132cdd4deee4b_3: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h0c5132cdd4deee4b_4: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h0c5132cdd4deee4b_5: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h0c5132cdd4deee4b_6: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h0c5132cdd4deee4b_7: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__hef488d895ab7b27f: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
