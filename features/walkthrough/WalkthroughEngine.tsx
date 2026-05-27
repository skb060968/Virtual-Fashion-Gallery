"use client";

/**
 * WalkthroughEngine — host for the R3F `<Canvas>` that renders the
 * Walkthrough_Scene.
 *
 * Responsibilities (mapped to the spec):
 *
 *   - Mount the R3F `<Canvas>` with a DPR cap of
 *     `[1, min(window.devicePixelRatio, 2)]` so the renderer stays
 *     within budget on high-DPR displays (Req 5.5).
 *   - Configure the WebGL context with `antialias: true`,
 *     `powerPreference: "high-performance"`, `alpha: false` to bias the
 *     renderer toward the discrete GPU on hybrid devices and skip the
 *     compositor's alpha blend (Req 9.1, 9.2, 9.3).
 *   - Toggle R3F's `frameloop` between `"always"` and `"demand"` driven
 *     by `useGalleryStore(s => s.zoomOpen)` so the underlying scene is
 *     throttled to ≤ 1 FPS while a Zoom_View is open (Req 9.6). The
 *     1Hz invalidate that re-arms a frame in `"demand"` mode lives in
 *     `ZoomView.tsx`; this component only flips the mode.
 *   - On `<Canvas onCreated>`: seed the camera at the deterministic
 *     spawn pose declared by `WalkthroughScene` (Req 1.1, 1.8), then
 *     register the engine handle (`invalidate`, `restoreCamera`) so
 *     `<ZoomView/>` — which lives outside the Canvas subtree — can
 *     throttle and restore the camera (Req 3.5, 3.7, 14.3, 9.6).
 *   - After the first scene frame renders, mark the store as ready and
 *     invoke the optional `onReady` callback so `<GalleryClient/>` can
 *     clear the 5-second mount-failure watchdog (Req 4.5, 4.8).
 *   - Mount only `<WalkthroughScene/>` and the `<Controls/>` router
 *     inside the Canvas. `<PostFx/>` and `<SceneRefBinder/>` are
 *     mounted inside `WalkthroughScene` itself (so swapping the scene
 *     for a future XR variant per Req 5.7 / 13.1 keeps post-processing
 *     and the scene-ref accessor co-located with the scene); they are
 *     intentionally NOT remounted at the engine level.
 *   - On orientation / viewport resize, R3F's built-in resize observer
 *     re-fits the renderer in place without unmounting the Canvas
 *     (Req 5.6). The Canvas key never changes for the lifetime of the
 *     component, so the scene graph survives every resize.
 */

import { Canvas, type RootState } from "@react-three/fiber";
import { useEffect, useMemo } from "react";

import { Controls } from "./Controls";
import { setEngineHandle } from "./engine-handle";
import { useGalleryStore } from "./store/useGalleryStore";
import {
  GALLERY_COLLIDERS,
  SPAWN,
  WalkthroughScene,
} from "./WalkthroughScene";

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------

export type WalkthroughEngineProps = {
  /**
   * Invoked once the R3F `<Canvas>` has reported `onCreated` AND the
   * first scene frame has been rendered. `<GalleryClient/>` uses this
   * to clear the 5-second mount-failure watchdog from
   * `<LandingClient/>` (Req 4.8); the gallery store's `setReady()` is
   * also flipped on the same tick so any other subscriber observes
   * the same readiness signal.
   *
   * Optional: tests and Storybook mount the engine without consumers.
   */
  onReady?: () => void;
};

// ---------------------------------------------------------------------------
// DPR helper
// ---------------------------------------------------------------------------

/**
 * Compute the renderer DPR pair `[min, max]` per Requirement 5.5. The
 * lower bound is 1 so the renderer never produces a sub-physical
 * pixel buffer; the upper bound is `min(devicePixelRatio, 2)` so a 3x
 * "Retina" display does not push the GPU past the 2x budget.
 *
 * Defensive against SSR: although this component is `"use client"`,
 * Next.js still server-renders it during the initial document HTML
 * pass. `window` is undefined on the server, so we fall back to a
 * conservative `[1, 2]` pair until hydration. The Canvas itself only
 * initialises in the browser, so the SSR value is never actually
 * consumed by a renderer.
 */
function computeDprPair(): [number, number] {
  if (typeof window === "undefined") {
    return [1, 2];
  }
  const ratio = window.devicePixelRatio;
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  return [1, Math.min(safeRatio, 2)];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WalkthroughEngine({
  onReady,
}: WalkthroughEngineProps) {
  // Drive `frameloop` from the zoom flag (Req 9.6). The selector is a
  // single boolean read so the engine re-renders only on open/close
  // transitions of Zoom_View, not on every interior store change.
  const zoomOpen = useGalleryStore((s) => s.zoomOpen);
  const frameloop = zoomOpen ? "demand" : "always";

  // DPR pair is computed once per mount. The renderer will pick its
  // operating ratio at construction time; subsequent display changes
  // are handled by R3F's resize observer alongside the viewport
  // size (Req 5.6).
  const dpr = useMemo<[number, number]>(() => computeDprPair(), []);

  /**
   * `onCreated` runs exactly once when the Canvas's `WebGLRenderer`
   * has been constructed and the R3F state object is ready. We use
   * this single hook to:
   *
   *   1. Seat the camera at the deterministic spawn pose defined by
   *      `WalkthroughScene` (Req 1.1, 1.8). Yaw/pitch are written
   *      with the YXZ Euler order that the controls subtree assumes
   *      (`PointerLookControls`/`TouchControls` both fix
   *      `camera.rotation.order = "YXZ"` on mount; setting it here
   *      keeps the spawn pose consistent regardless of which
   *      controls run first).
   *   2. Register the engine handle so `<ZoomView/>` can throttle the
   *      scene and restore the camera from outside the Canvas
   *      subtree (Req 3.5, 3.7, 9.6, 14.3).
   *   3. Defer the readiness signal to the next animation frame so
   *      `setReady()` fires only after the first scene frame has had
   *      a chance to render (Req 4.5, 4.8). This is what
   *      `<LandingClient/>`'s 5s mount watchdog listens for.
   */
  const handleCreated = useMemo(
    () => (state: RootState) => {
      const { camera, invalidate } = state;

      // ---- Spawn pose (Req 1.1, 1.8) ----------------------------------
      camera.position.set(
        SPAWN.position[0],
        SPAWN.position[1],
        SPAWN.position[2],
      );
      camera.rotation.order = "YXZ";
      camera.rotation.set(SPAWN.pitch, SPAWN.yaw, 0, "YXZ");
      camera.updateMatrixWorld();

      // ---- Engine handle (Req 3.5, 3.7, 9.6, 14.3) --------------------
      setEngineHandle({
        invalidate: () => invalidate(),
        restoreCamera: (snapshot) => {
          // Direct assignment, no smoothing — the Zoom_View round-trip
          // must reproduce the captured pose to within 1e-6 tolerance.
          camera.position.set(
            snapshot.position[0],
            snapshot.position[1],
            snapshot.position[2],
          );
          camera.rotation.order = "YXZ";
          camera.rotation.set(snapshot.pitch, snapshot.yaw, 0, "YXZ");
          camera.updateMatrixWorld();
          // After restoring the pose we may be in `"demand"` mode (the
          // zoom is still tearing down); kick a frame so the user sees
          // the restored pose immediately.
          invalidate();
        },
      });

      // ---- Ready signal after first frame (Req 4.5, 4.8) --------------
      // `requestAnimationFrame` fires on the next browser repaint,
      // which for an `"always"` frameloop is the first scene frame.
      // We then chain a second rAF so the signal arrives strictly
      // after the renderer has produced at least one frame, not just
      // scheduled one.
      const win = typeof window !== "undefined" ? window : null;
      if (win) {
        win.requestAnimationFrame(() => {
          win.requestAnimationFrame(() => {
            useGalleryStore.getState().setReady();
            onReady?.();
          });
        });
      } else {
        // Non-browser fallback (tests under @react-three/test-renderer
        // that mock the Canvas). Fire synchronously so the test
        // observes the readiness flag without needing a rAF shim.
        useGalleryStore.getState().setReady();
        onReady?.();
      }
    },
    [onReady],
  );

  // Reset the entry stage on every engine mount so navigating away
  // from /gallery and back replays the showroom-style entry sequence.
  // The store is module-scoped, so it would otherwise retain
  // `"inside"` from a prior visit.
  useEffect(() => {
    useGalleryStore.setState({ entryStage: "foyer" });
  }, []);

  // Clear the engine handle on unmount so a remounted Canvas (e.g.
  // after a WebGL context loss → fallback → retry cycle) cannot leak
  // its restoreCamera/invalidate closures into the new engine.
  useEffect(() => {
    return () => {
      setEngineHandle(null);
    };
  }, []);

  return (
    <Canvas
      dpr={dpr}
      gl={{
        antialias: true,
        powerPreference: "high-performance",
        alpha: false,
      }}
      frameloop={frameloop}
      onCreated={handleCreated}
      // Camera defaults; the spawn pose set inside `onCreated` is the
      // authoritative initial position/orientation. Field of view and
      // near/far are tuned for an interior gallery: 60° matches a
      // natural human focal length, and a 0.05 near plane keeps the
      // Visitor from clipping into wall surfaces during close inspection.
      camera={{ fov: 60, near: 0.05, far: 100 }}
      // Three's default colour pipeline is sRGB; we leave it on so
      // sketch textures composed by `loadSketchTexture` render with
      // their stored colour values unchanged.
    >
      <WalkthroughScene />
      <Controls colliders={GALLERY_COLLIDERS} />
    </Canvas>
  );
}

export default WalkthroughEngine;

// ---------------------------------------------------------------------------
// Re-exports for tests
// ---------------------------------------------------------------------------

/**
 * Internal helper exposed for tests so DPR computation can be exercised
 * without spinning up a Canvas. Not part of the public API.
 */
export const __test__ = {
  computeDprPair,
};

