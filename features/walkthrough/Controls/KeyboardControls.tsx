"use client";

/**
 * KeyboardControls
 *
 * Implements the desktop keyboard navigation half of Requirement 1.2 plus the
 * collision-resolved translation half of Requirement 1.6 for the Walkthrough_
 * Engine. Listens to `window` keydown / keyup so the camera moves regardless
 * of where DOM focus currently lives (the `<Canvas>` element itself does not
 * receive key events without a tabindex), and integrates the per-tick motion
 * through `Collisions.resolveMotion` so the camera maintains a 0.3-unit
 * clearance against every wall, floor, ceiling, and Sketch_Frame collider
 * (Req 1.6).
 *
 * Key map (Req 1.2):
 *   - W / ArrowUp    → forward      (along the camera's horizontal facing)
 *   - S / ArrowDown  → backward
 *   - A / ArrowLeft  → left strafe  (perpendicular to forward, world-up axis)
 *   - D / ArrowRight → right strafe
 *
 * Speed (Req 1.2): the resulting per-second velocity magnitude is clamped to
 * the configured `MOVE_SPEED` constant in [1.5, 3.0] units/sec — i.e. when
 * any movement key is held the camera moves at exactly `MOVE_SPEED`, and
 * diagonals are normalised so W+D does not exceed the cap. Vertical (Y)
 * motion is intentionally zero: the camera stays at its current height and
 * cannot fly. The pitch of the camera does not influence translation
 * direction; the forward vector is projected onto the horizontal plane so
 * looking up or down does not slow forward travel.
 *
 * Defence-in-depth for Req 14.3: while a Zoom_View is open the gallery
 * client unbinds input handlers, but if a key event somehow arrives anyway
 * we mark `navDuringZoom` via `useGalleryStore.markNavInput()` so the close
 * path knows to skip camera restoration.
 *
 * Render output: none. The component returns `null` and does all work
 * inside a `useFrame` callback that mutates `state.camera.position`
 * directly.
 */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import { resolveMotion, type AABB, type Vec3 } from "./Collisions";
import { useGalleryStore } from "../store/useGalleryStore";

/**
 * Configured horizontal translation speed in world units / second
 * (Requirement 1.2: in `[1.5, 3.0]`). Held diagonals are normalised so the
 * resulting magnitude is exactly this value when any direction is requested.
 */
export const MOVE_SPEED = 2.25;

/** Set of physical key identifiers that map to forward motion (Req 1.2). */
const FORWARD_KEYS = new Set(["KeyW", "ArrowUp"]);
/** Set of physical key identifiers that map to backward motion (Req 1.2). */
const BACKWARD_KEYS = new Set(["KeyS", "ArrowDown"]);
/** Set of physical key identifiers that map to left strafe (Req 1.2). */
const LEFT_KEYS = new Set(["KeyA", "ArrowLeft"]);
/** Set of physical key identifiers that map to right strafe (Req 1.2). */
const RIGHT_KEYS = new Set(["KeyD", "ArrowRight"]);

export type KeyboardControlsProps = {
  /**
   * Static collider set the camera resolves against this tick. The
   * Walkthrough_Engine assembles this from the room geometry and the
   * Sketch_Frame placements; an empty array disables collision (used in
   * tests). The reference is read once per `useFrame` tick.
   */
  colliders: ReadonlyArray<AABB>;
};

export function KeyboardControls({ colliders }: KeyboardControlsProps): null {
  const camera = useThree((s) => s.camera);

  /**
   * Held-key set keyed by `KeyboardEvent.code` so the mapping is independent
   * of the active keyboard layout (W on QWERTY and Z on AZERTY both fire
   * `KeyW`). Mutated in-place by the keydown / keyup listeners; read once
   * per `useFrame` tick.
   */
  const heldRef = useRef<Set<string>>(new Set());

  // --- key listeners ---------------------------------------------------
  useEffect(() => {
    const held = heldRef.current;

    function onKeyDown(e: KeyboardEvent) {
      if (
        FORWARD_KEYS.has(e.code) ||
        BACKWARD_KEYS.has(e.code) ||
        LEFT_KEYS.has(e.code) ||
        RIGHT_KEYS.has(e.code)
      ) {
        held.add(e.code);
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      held.delete(e.code);
    }

    /**
     * Releasing focus from the window (e.g. alt-tab) typically swallows the
     * matching keyup, leaving keys "stuck" held. Clear the set on blur and
     * on `visibilitychange` so the camera does not drift on return.
     */
    function onBlur() {
      held.clear();
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onBlur);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onBlur);
      held.clear();
    };
  }, []);

  // --- per-frame motion ------------------------------------------------
  // Reusable scratch vectors so the hot path allocates nothing per tick.
  const forwardVec = useRef(new THREE.Vector3()).current;
  const rightVec = useRef(new THREE.Vector3()).current;
  const WORLD_UP = useRef(new THREE.Vector3(0, 1, 0)).current;

  useFrame((_, dt) => {
    const held = heldRef.current;
    if (held.size === 0) return;

    // Gate navigation while the entry sequence has not completed —
    // before "inside", arrow keys are reserved for the on-screen
    // entry overlay (which routes Enter / Space to the same handler).
    if (useGalleryStore.getState().entryStage !== "inside") return;

    // Translate the held-key set into a (forwardAxis, rightAxis) pair in
    // {-1, 0, +1}. Opposite keys cancel, matching the spec's per-axis
    // mapping in Req 1.2.
    let fwd = 0;
    let strafe = 0;
    for (const code of held) {
      if (FORWARD_KEYS.has(code)) fwd += 1;
      else if (BACKWARD_KEYS.has(code)) fwd -= 1;
      else if (LEFT_KEYS.has(code)) strafe -= 1;
      else if (RIGHT_KEYS.has(code)) strafe += 1;
    }
    if (fwd === 0 && strafe === 0) return;

    // Defence-in-depth marker for Req 14.3 (camera restore).
    if (useGalleryStore.getState().zoomOpen) {
      useGalleryStore.getState().markNavInput();
    }

    // Forward vector projected onto the horizontal plane: pitch must not
    // affect translation speed (looking up/down keeps walking speed
    // constant) and must not introduce vertical drift.
    camera.getWorldDirection(forwardVec);
    forwardVec.y = 0;
    if (forwardVec.lengthSq() < 1e-12) {
      // Camera looking straight up/down: fall back to a stable forward.
      forwardVec.set(0, 0, -1);
    } else {
      forwardVec.normalize();
    }

    // Right = forward × worldUp. With three.js' right-handed coordinate
    // system this places +right on the camera's right side.
    rightVec.copy(forwardVec).cross(WORLD_UP).normalize();

    // Combine and normalise the input direction so diagonals do not exceed
    // the configured speed cap (Req 1.2: magnitude in [1.5, 3.0]).
    const dx = forwardVec.x * fwd + rightVec.x * strafe;
    const dz = forwardVec.z * fwd + rightVec.z * strafe;
    const lenSq = dx * dx + dz * dz;
    if (lenSq < 1e-12) return;
    const inv = 1 / Math.sqrt(lenSq);
    const vx = dx * inv * MOVE_SPEED;
    const vz = dz * inv * MOVE_SPEED;

    // Resolve through the Collisions module. Y-velocity is zero so the
    // camera maintains its current height; horizontal collision still snaps
    // the swept axis component to the 0.3-unit clearance plane (Req 1.6).
    const cur: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
    const vel: Vec3 = [vx, 0, vz];
    const next = resolveMotion(cur, vel, dt, colliders);
    camera.position.set(next[0], next[1], next[2]);
  });

  return null;
}
