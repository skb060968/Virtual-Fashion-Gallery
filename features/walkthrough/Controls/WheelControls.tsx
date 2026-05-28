"use client";

/**
 * WheelControls
 *
 * Desktop forward/backward navigation driven by the mouse wheel
 * (Requirements 1.2, 1.6 of the virtual-fashion-gallery spec).
 *
 * Convention:
 *   - Scrolling the wheel UP (deltaY < 0) walks the camera FORWARD along
 *     its horizontal facing.
 *   - Scrolling the wheel DOWN (deltaY > 0) walks the camera BACKWARD.
 *   - Strafing is intentionally not provided. Visitors can rotate the
 *     camera with the mouse drag (PointerLookControls) and walk forward
 *     in the new heading; this matches the "showroom walkthrough" intent
 *     of the spec where lateral motion is reserved for touch joystick.
 *
 * Wheel events deliver discrete deltas, but the spec mandates a constant
 * walking speed in `[1.5, 3.0]` units/sec (Req 1.2). We bridge the two by
 * accumulating each wheel tick into a signed `pendingDistance` (in world
 * units) and consuming it per frame at `MOVE_SPEED`. Each tick therefore
 * produces a brief impulse of forward / backward motion that decelerates
 * smoothly as the queue drains, instead of teleporting on every notch.
 *
 * Translation is passed through `Collisions.resolveMotion` so the camera
 * keeps the configured clearance from every wall and Sketch_Frame collider
 * (Req 1.6). Vertical motion is zero — the camera stays at its current
 * eye height regardless of pitch.
 *
 * Defence-in-depth marker for Req 14.3: while a Zoom_View is open the
 * gallery client unbinds inputs, but if a wheel event slips through we
 * call `useGalleryStore.markNavInput()` so the close path knows to skip
 * camera restoration.
 *
 * Render output: none. Side-effect-only component that mutates
 * `state.camera.position` inside `useFrame`.
 */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import { resolveMotion, type AABB, type Vec3 } from "./Collisions";
import { useGalleryStore } from "../store/useGalleryStore";

/**
 * Configured horizontal translation speed in world units / second
 * (Requirement 1.2: in `[1.5, 3.0]`). This is the magnitude of the
 * per-frame velocity while the wheel-impulse queue is non-empty.
 */
export const MOVE_SPEED = 2.25;

/**
 * World units of forward travel per pixel of `WheelEvent.deltaY` when
 * `deltaMode === DOM_DELTA_PIXEL` (the default on most browsers, where
 * one notch is ~100 px). At 0.012 units/px a single notch produces
 * ~1.2 units of travel, taking just over half a second to play out at
 * the configured `MOVE_SPEED`. Tuned so flicking the wheel walks the
 * camera roughly one frame-width forward per notch.
 */
const PIXEL_TO_DISTANCE = 0.012;

/**
 * Multipliers applied when the browser reports the delta in lines or
 * pages instead of pixels (Firefox legacy modes, some accessibility
 * setups). 16 px/line and 800 px/page are the same defaults the
 * `wheel-event` spec recommends as the reference conversion.
 */
const LINE_TO_PIXEL = 16;
const PAGE_TO_PIXEL = 800;

/**
 * Maximum signed magnitude of the pending-distance queue, in world
 * units. Caps how much travel a frantic scroll can buffer up — without
 * this a long mousewheel flick could keep the camera coasting for many
 * seconds after the user stopped scrolling. 8 units (~one room width)
 * keeps the inertia feeling tactile.
 */
const MAX_PENDING_DISTANCE = 8;

export type WheelControlsProps = {
  /**
   * AABB colliders the camera resolves against per frame (Req 1.6).
   * Defaults to an empty list so the component is renderable in
   * isolation (tests, Storybook). The Walkthrough_Scene supplies its
   * room walls and Sketch_Frame colliders.
   */
  colliders?: ReadonlyArray<AABB>;
};

export function WheelControls({ colliders = [] }: WheelControlsProps): null {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  /**
   * Signed remaining distance to travel along the camera's horizontal
   * facing. Positive = forward, negative = backward. Mutated by both
   * the wheel listener (adds impulses) and the `useFrame` consumer
   * (drains it at `MOVE_SPEED`).
   */
  const pendingDistanceRef = useRef(0);

  // --- wheel listener --------------------------------------------------
  useEffect(() => {
    const el = gl.domElement;

    function onWheel(e: WheelEvent) {
      // Gate while the entry sequence has not completed. We still
      // preventDefault so a stray scroll doesn't bubble up to scroll
      // the page underneath the canvas.
      e.preventDefault();
      if (useGalleryStore.getState().entryStage !== "inside") return;

      // Normalise deltaY to pixels regardless of the browser's
      // reported delta mode. `deltaMode` is 0 (pixel), 1 (line), or
      // 2 (page) per the wheel-event spec.
      let deltaPx = e.deltaY;
      if (e.deltaMode === 1) deltaPx *= LINE_TO_PIXEL;
      else if (e.deltaMode === 2) deltaPx *= PAGE_TO_PIXEL;

      // Convention: wheel UP (deltaY negative) = forward; wheel DOWN
      // (positive) = backward. So pendingDistance increases (forward)
      // as deltaPx decreases.
      const impulse = -deltaPx * PIXEL_TO_DISTANCE;
      const next = pendingDistanceRef.current + impulse;
      pendingDistanceRef.current = clamp(
        next,
        -MAX_PENDING_DISTANCE,
        MAX_PENDING_DISTANCE,
      );

      if (useGalleryStore.getState().zoomOpen) {
        useGalleryStore.getState().markNavInput();
      }
    }

    // `passive: false` is required so `preventDefault()` actually stops
    // the browser's native page-scroll / pinch-to-zoom on touchpads.
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [gl]);

  // --- per-frame motion ------------------------------------------------
  // Reusable scratch vector so the hot path allocates nothing per tick.
  const forwardVec = useRef(new THREE.Vector3()).current;

  useFrame((_, dt) => {
    const pending = pendingDistanceRef.current;
    if (pending === 0) return;

    // Gate while the entry sequence has not completed. Drain the queue
    // silently so the camera doesn't jump on stage transition.
    if (useGalleryStore.getState().entryStage !== "inside") {
      pendingDistanceRef.current = 0;
      return;
    }

    // Compute the step size for this frame. If the remaining distance
    // is smaller than one frame's MOVE_SPEED travel, take the whole
    // remainder so we settle exactly at the queue's terminal point
    // instead of overshooting into a tiny opposite-sign residue.
    const sign = pending > 0 ? 1 : -1;
    const maxStep = MOVE_SPEED * dt;
    const stepMagnitude = Math.min(Math.abs(pending), maxStep);
    const stepDistance = sign * stepMagnitude;
    pendingDistanceRef.current = pending - stepDistance;

    // Forward vector projected onto the horizontal plane: pitch must
    // not affect translation speed (looking up/down keeps walking
    // speed constant) and must not introduce vertical drift.
    camera.getWorldDirection(forwardVec);
    forwardVec.y = 0;
    if (forwardVec.lengthSq() < 1e-12) {
      // Camera looking straight up/down: fall back to a stable forward
      // so the walk continues along a sane heading.
      forwardVec.set(0, 0, -1);
    } else {
      forwardVec.normalize();
    }

    // World-space velocity = forward direction × stepDistance / dt.
    // (Equivalent to MOVE_SPEED·sign while the queue isn't draining,
    // and a clamped fraction on the final settling frame.)
    const vx = (forwardVec.x * stepDistance) / dt;
    const vz = (forwardVec.z * stepDistance) / dt;

    const cur: Vec3 = [
      camera.position.x,
      camera.position.y,
      camera.position.z,
    ];
    const vel: Vec3 = [vx, 0, vz];
    const next = resolveMotion(cur, vel, dt, colliders);
    camera.position.set(next[0], next[1], next[2]);

    // If a wall blocked us, clear the queue so the camera doesn't
    // grind against the collider for the rest of the impulse.
    const moved =
      Math.abs(next[0] - cur[0]) + Math.abs(next[2] - cur[2]);
    if (moved < 1e-5) {
      pendingDistanceRef.current = 0;
    }
  });

  return null;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export default WheelControls;
