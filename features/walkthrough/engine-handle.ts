/**
 * engine-handle.ts — module-scoped accessor for engine primitives that
 * need to be reachable from React subtrees mounted *outside* the R3F
 * `<Canvas>`.
 *
 * The Zoom_View overlay (`features/walkthrough/ZoomView.tsx`) is a
 * sibling of the `<Canvas>` rather than a child, so it cannot use
 * `useThree` or any other R3F hook to talk to the renderer or the
 * camera. Instead, the Walkthrough_Engine registers a small handle with
 * exactly two callbacks that the overlay needs:
 *
 *   - `invalidate()`    — schedules the next render frame when the
 *                         engine's `frameloop` is in `"demand"` mode.
 *                         Zoom_View calls this on a 1Hz `setInterval`
 *                         so the scene continues to render at most one
 *                         frame per second while the overlay is open
 *                         (Requirement 9.6).
 *   - `restoreCamera(snap)` — applies a captured `CameraSnapshot` back
 *                         onto the live camera. Zoom_View calls this
 *                         on dismiss when no navigation input arrived
 *                         during open (Requirements 3.5, 3.7, 14.3).
 *
 * The accessor is module-scoped on purpose: the Gallery_App only ever
 * mounts one Walkthrough_Engine at a time, and the handle is cleared
 * on unmount to avoid leaking a stale callback into a remounted Canvas.
 *
 * If no handle is currently registered (for example, the engine has
 * not yet mounted, or the WebGL_Fallback path is active), callers MUST
 * tolerate `null` and skip the operation gracefully.
 */

"use client";

import type { CameraSnapshot } from "./store/useGalleryStore";

/**
 * Engine-side primitives Zoom_View needs to call from outside the
 * `<Canvas>` subtree. The Walkthrough_Engine is responsible for
 * registering a value of this type via `setEngineHandle` once its R3F
 * tree is ready, and clearing it on unmount.
 */
export type EngineHandle = {
  /**
   * Schedule the next R3F render frame. While the engine's `frameloop`
   * is `"demand"` (set whenever Zoom_View is open per Req 9.6), no
   * frames are produced until something invokes this. Zoom_View uses
   * a 1Hz `setInterval` to call this so the throttled scene keeps
   * rendering at exactly the rate cap, no more.
   */
  invalidate: () => void;

  /**
   * Apply a captured pre-zoom `CameraSnapshot` back onto the live
   * camera. The implementation MUST set `position`, `yaw`, and `pitch`
   * by direct assignment (no smoothing, no interpolation) so that the
   * round-trip is exact within 1e-6 tolerance per Property 2 / Req
   * 14.3.
   */
  restoreCamera: (snapshot: CameraSnapshot) => void;
};

let currentHandle: EngineHandle | null = null;

/**
 * Register (or clear, when passed `null`) the engine handle. Intended
 * for the Walkthrough_Engine's mount/unmount path; calling it from
 * product code outside the engine is a smell.
 */
export function setEngineHandle(handle: EngineHandle | null): void {
  currentHandle = handle;
}

/**
 * Read the currently registered engine handle, or `null` if no engine
 * is mounted. Callers MUST guard against `null` and skip the operation
 * gracefully — Zoom_View renders correctly even without an engine
 * (which can happen in tests or while the engine is still mounting).
 */
export function getEngineHandle(): EngineHandle | null {
  return currentHandle;
}
