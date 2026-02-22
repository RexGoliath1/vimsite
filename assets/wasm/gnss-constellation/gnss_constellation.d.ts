/* tslint:disable */
/* eslint-disable */

/**
 * Parse Celestrak OMM JSON and propagate all satellites to current time.
 * Returns a JsValue array of {name, x, y, z} objects (TEME frame, km).
 * Note: TEME ≈ ECI at GNSS altitudes — GMST rotation deferred to Phase 2.
 */
export function propagate(tle_json: string): any;

export function set_time_warp(factor: number): void;

export function start(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly propagate: (a: number, b: number) => [number, number, number];
    readonly set_time_warp: (a: number) => void;
    readonly start: () => void;
    readonly wasm_bindgen__closure__destroy__h12d6647f1f8d439a: (a: number, b: number) => void;
    readonly wasm_bindgen__closure__destroy__ha269213a20b3fe57: (a: number, b: number) => void;
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
    readonly __externref_table_dealloc: (a: number) => void;
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
