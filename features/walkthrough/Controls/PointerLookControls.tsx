"use client";

/**
 * PointerLookControls — drag-to-look rotation for desktop visitors.
 *
 * This component renders nothing of its own. It attaches mouse
 * listeners to the WebGL canvas (via `useThree`) and updates the
 * camera's yaw/pitch on drag. The logic is intentionally simple:
 *
 *   1. On `mousedown` (primary button) over the canvas, start a drag.
 *   2. On `mousemove` while dragging, accumulate yaw/pitch deltas
 *      proportional to the cursor movement (sensitivity ∈ [0.002,
 *      0.01] rad/CSS-pixel per Requirement 1.4).
 *   3. On `mouseup` anywhere, end the drag.
 *   4. Pitch is clamped to ±1.5533 rad (≈±89°) per Requirement 1.7.
 *
 * The earlier pointer-lock path was removed: it required an extra
 * activation gesture, hid the OS cursor, and was harder to recover
 * from. Drag-to-look is the convention modern 3D-tour sites use and
 * keeps every input modality consistent (mouse drag, touch drag, and
 * the gallery's own click handlers all coexist cleanly).
 *
 * While the entry sequence is still running (`entryStage !== "inside"`)
 * the rotation listeners stay attached but every applied delta short-
 * circuits, so stray clicks during the foyer phase cannot spin the
 * camera off-axis.
 */

import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import { Euler } from "three";

import { useGalleryStore } from "../store/useGalleryStore";

/**
 * Drag-to-look yaw/pitch sensitivity in radians per CSS pixel. Held
 * inside the [0.002, 0.01] band required by Requirements 1.4 / 1.9 so
 * Property 12 (rotation sensitivity bounds) holds for any input.
 */
export const DRAG_SENSITIVITY = 0.005;

/**
 * Pitch clamp at ±89° expressed in radians (Requirement 1.7). Shared
 * with `TouchControls` and the `CameraSnapshot` invariant.
 */
export const PITCH_LIMIT = 1.5533;

export function PointerLookControls() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const canvas = gl.domElement as HTMLCanvasElement;

  // Authoritative yaw/pitch in YXZ Euler order. Seeded from the live
  // camera quaternion on mount so the deterministic spawn pose set
  // by `WalkthroughScene` is preserved regardless of the camera's
  // prior rotation order.
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const draggingRef = useRef(false);

  useEffect(() => {
    const e = new Euler().setFromQuaternion(camera.quaternion, "YXZ");
    yawRef.current = e.y;
    pitchRef.current = clamp(e.x, -PITCH_LIMIT, PITCH_LIMIT);
    camera.rotation.order = "YXZ";
    camera.rotation.set(pitchRef.current, yawRef.current, 0, "YXZ");
  }, [camera]);

  /**
   * Apply a single (dx, dy) pixel-delta pair through the rotation
   * pipeline. Yaw delta is `-dx * sensitivity` so dragging right yaws
   * the camera right. Pitch delta is `-dy * sensitivity` so dragging
   * up looks up. Pitch is clamped after every delta (Requirement 1.7).
   */
  const applyDelta = useCallback(
    (dx: number, dy: number) => {
      const store = useGalleryStore.getState();
      if (store.entryStage !== "inside") return;
      if (store.zoomOpen) {
        store.markNavInput();
        return;
      }

      yawRef.current = yawRef.current - dx * DRAG_SENSITIVITY;
      pitchRef.current = clamp(
        pitchRef.current - dy * DRAG_SENSITIVITY,
        -PITCH_LIMIT,
        PITCH_LIMIT,
      );
      camera.rotation.set(pitchRef.current, yawRef.current, 0, "YXZ");
    },
    [camera],
  );

  // Drag listeners. Mounted for the lifetime of the component so
  // mouse-look works as soon as the entry sequence completes — the
  // applyDelta short-circuit handles the foyer/entering phases.
  useEffect(() => {
    if (typeof document === "undefined") return;

    let lastX = 0;
    let lastY = 0;

    const onDown = (e: MouseEvent) => {
      // Only the primary mouse button drives drag-to-look.
      if (e.button !== 0) return;
      // Don't start a drag on top of a focusable overlay button —
      // those need to receive their click cleanly.
      const target = e.target as HTMLElement | null;
      if (target && target.closest("button, a")) return;
      draggingRef.current = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };

    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      applyDelta(dx, dy);
    };

    const onUp = () => {
      draggingRef.current = false;
    };

    canvas.addEventListener("mousedown", onDown);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);

    return () => {
      canvas.removeEventListener("mousedown", onDown);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      draggingRef.current = false;
    };
  }, [applyDelta, canvas]);

  return null;
}

/** Inclusive clamp; returns `lo` for NaN to keep pitch finite. */
function clamp(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

export default PointerLookControls;
