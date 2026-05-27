"use client";

/**
 * ProximityHighlighter
 *
 * Implements the camera-proximity emphasis target selection for Requirements
 * 2.5 and 2.6. Runs once per frame inside R3F's `useFrame` to find the single
 * `Sketch_Frame` nearest the camera within 1.5m and writes its id into the
 * gallery store's `focusedFrameId`. Each `<SketchFrame/>` reads
 * `focusedFrameId === record.id` (selector subscription) to apply the ≥1.25×
 * highlight multiplier from Req 2.5.
 *
 * Selection rules:
 *   - In-range gate is inclusive at 1.5m (Req 2.5: "within 1.5 metres"):
 *     a frame is a candidate iff `distance ≤ 1.5m`.
 *   - Tie-break is deterministic by catalogue index. The component receives
 *     `frames` in catalogue order; the search uses strict `<` against the
 *     running minimum so the *first-encountered* (lowest catalogue-index)
 *     candidate wins on equal distances.
 *   - When no frame is within 1.5m the focused id is cleared to `null` so
 *     `<SketchFrame/>` can drop emphasis.
 *
 * Render-cost notes:
 *   - The component renders nothing (returns `null`).
 *   - Distances are computed in squared form to avoid a per-frame
 *     `Math.sqrt` per candidate.
 *   - A local ref tracks the previously-published id; the store's
 *     `setFocusedFrame` is only invoked when the id actually changes,
 *     keeping `<SketchFrame/>` re-renders to one per focus transition
 *     rather than one per frame. (The store's own setter also short-circuits
 *     on equal values, but the ref keeps the work out of zustand entirely.)
 */

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";

import { useGalleryStore } from "./store/useGalleryStore";

/** Req 2.5: "within 1.5 metres of a Sketch_Frame". */
const PROXIMITY_RADIUS_METRES = 1.5;
const PROXIMITY_RADIUS_SQ =
  PROXIMITY_RADIUS_METRES * PROXIMITY_RADIUS_METRES;

/**
 * Minimal placement contract a `Sketch_Frame` exposes for proximity testing.
 * `id` is the corresponding `Sketch_Record.id`. `position` is the world-space
 * anchor of the frame's canvas (the same anchor `<SketchFrame/>` is mounted
 * at via the placement helper).
 *
 * The supplied array MUST be in catalogue order so its array index is the
 * catalogue index used for the deterministic tie-break.
 */
export type ProximityFrame = {
  id: string;
  position: readonly [number, number, number];
};

export type ProximityHighlighterProps = {
  /** Frames to test, in catalogue (Sketch_Catalog) order. */
  frames: ReadonlyArray<ProximityFrame>;
};

export function ProximityHighlighter({
  frames,
}: ProximityHighlighterProps): null {
  /**
   * Last id we wrote into the store. Initialised to `undefined` (rather than
   * `null`) so the first frame always publishes — including the case where
   * the initial nearest is `null` and the store's default is also `null`,
   * keeping the publish-on-change semantic explicit on first run.
   */
  const lastPublishedRef = useRef<string | null | undefined>(undefined);

  useFrame((state) => {
    const cam = state.camera.position;

    let nearestId: string | null = null;
    let nearestDistSq = Number.POSITIVE_INFINITY;

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const [fx, fy, fz] = frame.position;
      const dx = cam.x - fx;
      const dy = cam.y - fy;
      const dz = cam.z - fz;
      const distSq = dx * dx + dy * dy + dz * dz;

      // In-range gate: inclusive at 1.5m (Req 2.5).
      if (distSq > PROXIMITY_RADIUS_SQ) continue;

      // Strict `<` so on equal distances the earlier (lower catalogue-index)
      // frame keeps the lead — this is the deterministic tie-break for Req 2.6.
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearestId = frame.id;
      }
    }

    if (lastPublishedRef.current !== nearestId) {
      lastPublishedRef.current = nearestId;
      useGalleryStore.getState().setFocusedFrame(nearestId);
    }
  });

  return null;
}
