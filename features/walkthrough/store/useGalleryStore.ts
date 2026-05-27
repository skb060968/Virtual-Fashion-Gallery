/**
 * useGalleryStore — zustand store local to the walkthrough feature.
 *
 * Holds transient 3D state that needs to be observed across the React tree
 * without prop-drilling and without forcing R3F-tree re-renders for everything:
 *
 *   - focusedFrameId         (proximity emphasis target; Req 2.5, 2.6)
 *   - zoomOpen               (Zoom_View overlay flag; Req 3.3, 9.6)
 *   - activeRecordId         (which Sketch_Record the Zoom_View is showing)
 *   - cameraSnapshotPreZoom  (camera state captured at openZoom; Req 3.5, 3.7)
 *   - navDuringZoom          (defence-in-depth marker for Req 3.7 / 14.3)
 *   - walkthroughReady       (mount-success flag for the 5s watchdog; Req 4.8)
 *   - reducedMotion          (mirrored from prefers-reduced-motion; Req 10.3)
 *
 * The store lives only in the gallery feature (Req 11.8). It is never exported
 * from `lib/`, never serialised to disk, and never used outside
 * `features/walkthrough` and the gallery client wrappers.
 */

import { create } from "zustand";

/**
 * CameraSnapshot — minimal pose captured at the moment Zoom_View opens
 * (Req 3.5) and used to restore the Walkthrough_Scene camera on dismiss
 * when no navigation input arrived during the zoom (Req 3.7, 14.3).
 */
export type CameraSnapshot = {
  /** World-space position [x, y, z]. */
  position: [number, number, number];
  /** Yaw in radians around world Y. */
  yaw: number;
  /** Pitch in radians, clamped to ±89° (±1.5533 rad) by the controls. */
  pitch: number;
};

/**
 * EntryStage — phase machine for the showroom-style entry sequence.
 *
 *   - "foyer"    : Visitor is outside the gallery in the foyer chamber.
 *                  The entry overlay button is visible; navigation
 *                  controls are gated so the camera does not leak out
 *                  of the foyer through arrow keys.
 *   - "entering" : Doors are sliding apart and the camera is auto-
 *                  walking forward through the doorway. Navigation
 *                  inputs are still gated.
 *   - "inside"   : Visitor is inside the gallery; navigation controls
 *                  are unrestricted and the entry overlay is hidden.
 *
 * The Walkthrough_Engine spawns at `SPAWN_FOYER` while the stage is
 * `"foyer"` and `"entering"`; once the entry animation completes the
 * stage flips to `"inside"`.
 */
export type EntryStage = "foyer" | "entering" | "inside";

export type GalleryState = {
  // Focus / proximity
  focusedFrameId: string | null;

  // Zoom_View
  zoomOpen: boolean;
  activeRecordId: string | null;
  cameraSnapshotPreZoom: CameraSnapshot | null;
  navDuringZoom: boolean;

  // Engine status (used by mount-failure watchdog)
  walkthroughReady: boolean;

  // Reduced motion
  reducedMotion: boolean;

  // Entry sequence
  entryStage: EntryStage;

  // Actions
  setFocusedFrame: (id: string | null) => void;
  openZoom: (id: string, snapshot: CameraSnapshot) => void;
  closeZoom: () => void;
  markNavInput: () => void;
  setReady: () => void;
  setReducedMotion: (v: boolean) => void;
  beginEntry: () => void;
  completeEntry: () => void;
};

export const useGalleryStore = create<GalleryState>((set) => ({
  // --- initial state ---
  focusedFrameId: null,

  zoomOpen: false,
  activeRecordId: null,
  cameraSnapshotPreZoom: null,
  navDuringZoom: false,

  walkthroughReady: false,

  reducedMotion: false,

  entryStage: "foyer",

  // --- actions ---

  /**
   * Set the currently focused (nearest within 1.5m) frame id, or clear it.
   * ProximityHighlighter compares against the current value before calling
   * to avoid redundant renders.
   */
  setFocusedFrame: (id) =>
    set((state) =>
      state.focusedFrameId === id ? state : { focusedFrameId: id },
    ),

  /**
   * Open the Zoom_View for a Sketch_Record and capture the pre-zoom camera
   * pose. Resets navDuringZoom so the dismiss path can decide whether to
   * restore the camera (Req 3.5, 3.7, 14.3).
   */
  openZoom: (id, snapshot) =>
    set({
      zoomOpen: true,
      activeRecordId: id,
      cameraSnapshotPreZoom: snapshot,
      navDuringZoom: false,
    }),

  /**
   * Close the Zoom_View. The consumer is responsible for reading
   * cameraSnapshotPreZoom and navDuringZoom *before* calling closeZoom in
   * order to decide whether to restore the camera (Req 3.6, 3.7).
   */
  closeZoom: () =>
    set({
      zoomOpen: false,
      activeRecordId: null,
      cameraSnapshotPreZoom: null,
      navDuringZoom: false,
    }),

  /**
   * Defence-in-depth marker: any control component that processes a
   * translate/rotate input while zoomOpen is true should call this before
   * applying the input. The dismiss path reads navDuringZoom to decide
   * whether camera restoration is allowed (Req 3.7, 14.3).
   */
  markNavInput: () =>
    set((state) =>
      state.navDuringZoom ? state : { navDuringZoom: true },
    ),

  /**
   * Marks the Walkthrough_Engine as ready (first scene frame rendered).
   * Used by the LandingClient mount-failure watchdog (Req 4.8).
   */
  setReady: () =>
    set((state) =>
      state.walkthroughReady ? state : { walkthroughReady: true },
    ),

  /**
   * Mirrors the OS-level prefers-reduced-motion preference into the store
   * so the 3D path can damp ambient animation without unmounting (Req 10.3).
   */
  setReducedMotion: (v) =>
    set((state) =>
      state.reducedMotion === v ? state : { reducedMotion: v },
    ),

  /**
   * Move the entry stage from "foyer" to "entering". Idempotent: a
   * second call while already entering is a no-op.
   */
  beginEntry: () =>
    set((state) =>
      state.entryStage === "foyer" ? { entryStage: "entering" } : state,
    ),

  /**
   * Move the entry stage to "inside". Called by the entry-walk
   * controller when the camera has finished walking through the
   * doorway.
   */
  completeEntry: () =>
    set((state) =>
      state.entryStage === "inside" ? state : { entryStage: "inside" },
    ),
}));
