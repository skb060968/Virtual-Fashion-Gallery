"use client";

/**
 * TouchControls
 *
 * Coarse-pointer (touch) navigation for the Walkthrough_Engine
 * (Requirements 1.4, 1.5, 1.6, 1.7).
 *
 *   1. Single-finger drag on the canvas -> rotate camera yaw/pitch at
 *      sensitivity ROTATE_SENSITIVITY in [0.002, 0.01] rad/CSS-pixel
 *      (Req 1.4). Pitch is clamped to +/-1.5533 rad after every delta
 *      (Req 1.7).
 *   2. On-screen joystick (Tailwind-positioned absolute <div> in the
 *      bottom-left) -> translate forward/back/left/right at speed
 *      TRANSLATE_SPEED in [1.5, 3.0] units/sec (Req 1.5). The joystick
 *      is rendered to document.body via React's createPortal so it
 *      lives outside the R3F reconciler.
 *   3. All translation is passed through Collisions.resolveMotion
 *      against the supplied colliders (Req 1.6).
 *
 * Multi-finger gestures (e.g. pinch-zoom or two-finger vertical drag)
 * are intentionally not consumed by this component. Translation is
 * driven exclusively by the on-screen joystick on touch devices.
 *
 * Long-press handling:
 *   - Long-press on a sketch surface (Sketch_Frame, Metadata_Panel,
 *     Zoom_View) is intercepted by <ProtectedSurface/> via its
 *     onContextMenu -> preventDefault wiring; this component does not
 *     try to mirror that.
 *   - Long-press on the bare canvas is allowed: this component does
 *     NOT attach a contextmenu suppressor on the canvas DOM element
 *     and does NOT preventDefault on pointer events that aren't part
 *     of an active gesture, so the browser's native long-press
 *     contextmenu (and any platform debug affordances) still surface.
 *
 * Camera input gating during Zoom_View:
 *   - When useGalleryStore.zoomOpen is true and any rotate/translate
 *     input is actually applied, this component calls markNavInput()
 *     so the dismiss path can skip camera restoration (Req 3.7,
 *     defence-in-depth marker per the design's State Management
 *     section).
 *
 * Camera state convention:
 *   - The camera's Euler order is set to "YXZ" once on mount so that
 *     rotation.y is yaw and rotation.x is pitch and YXZ composition
 *     matches the snapshot/restoration model in
 *     features/walkthrough/store/useGalleryStore.ts. This is the same
 *     convention the other Controls modules use.
 */

import { useFrame, useThree } from "@react-three/fiber";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useGalleryStore } from "../store/useGalleryStore";
import { type AABB, resolveMotion, type Vec3 } from "./Collisions";

// ---------------------------------------------------------------------------
// Shared joystick state
//
// The on-screen joystick UI lives OUTSIDE the R3F `<Canvas>` subtree (R3F
// only knows how to reconcile THREE primitives, so a `<div>` returned from
// an in-Canvas component throws "Div is not part of the THREE namespace").
// The two halves communicate through this module-scoped ref pair: the
// DOM-side `<TouchJoystick/>` writes the axis, the in-Canvas
// `<TouchControls/>` reads it inside `useFrame`. A `Set` of subscribers
// lets the dispatcher signal when the joystick is mounted/unmounted so we
// don't double-render across HMR cycles.
// ---------------------------------------------------------------------------

const sharedJoystickAxis: { x: number; y: number } = { x: 0, y: 0 };
function setSharedJoystickAxis(x: number, y: number): void {
  sharedJoystickAxis.x = x;
  sharedJoystickAxis.y = y;
}
function getSharedJoystickAxis(): { x: number; y: number } {
  return sharedJoystickAxis;
}

// ---------------------------------------------------------------------------
// Spec-defined ranges
// ---------------------------------------------------------------------------

/** Req 1.4: rotation sensitivity in radians per CSS-pixel. */
const ROTATE_SENSITIVITY_MIN = 0.002;
const ROTATE_SENSITIVITY_MAX = 0.01;
/** Chosen value inside [ROTATE_SENSITIVITY_MIN, ROTATE_SENSITIVITY_MAX]. */
const ROTATE_SENSITIVITY = 0.005;

/** Req 1.5: translation speed in world units per second. */
const TRANSLATE_SPEED_MIN = 1.5;
const TRANSLATE_SPEED_MAX = 3.0;
/** Chosen value inside [TRANSLATE_SPEED_MIN, TRANSLATE_SPEED_MAX]. */
const TRANSLATE_SPEED = 2.5;

/** Req 1.7: camera pitch is clamped to +/-89 degrees (1.5533 rad). */
const PITCH_LIMIT = 1.5533;

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Joystick visible diameter and knob radius in CSS-pixels. */
const JOYSTICK_BASE_SIZE_PX = 96;
const JOYSTICK_KNOB_SIZE_PX = 36;

/**
 * Joystick deflection (in normalised [0,1] units along the radial axis)
 * below which the joystick is treated as centered. Eliminates noisy,
 * sub-perceptible drift from a finger resting near the center.
 */
const JOYSTICK_DEAD_ZONE = 0.1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TouchControlsProps = {
  /**
   * AABB colliders that constrain camera translation. Defaults to an
   * empty list so the component is renderable in isolation (tests and
   * Storybook) without needing a full WalkthroughScene mount; the
   * Walkthrough_Scene is responsible for passing its room walls and
   * Sketch_Frame colliders here.
   */
  colliders?: ReadonlyArray<AABB>;
};

/**
 * Internal mutable state for active touch pointers on the canvas. We
 * never mutate React state on every pointermove; instead we accumulate
 * deltas into refs and consume them inside useFrame so motion is
 * time-corrected (Req 1.2 / 1.5 phrasing of "per second").
 */
type CanvasTouchState = {
  /** Active pointer ids -> last seen x/y in CSS-pixels. */
  pointers: Map<number, { x: number; y: number }>;
  /** Accumulated yaw delta in raw CSS-pixels (consumed by useFrame). */
  rotateDxPx: number;
  /** Accumulated pitch delta in raw CSS-pixels (consumed by useFrame). */
  rotateDyPx: number;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TouchControls({
  colliders = [],
}: TouchControlsProps) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);

  // ---- Set Euler order for stable yaw/pitch decomposition ------------------
  useEffect(() => {
    camera.rotation.order = "YXZ";
  }, [camera]);

  // ---- Canvas pointer state (rotate only) ---------------------------------
  const touchStateRef = useRef<CanvasTouchState>({
    pointers: new Map(),
    rotateDxPx: 0,
    rotateDyPx: 0,
  });

  // -------------------------------------------------------------------------
  // Bind pointer listeners on the canvas DOM element. We use Pointer Events
  // (PEP-style) so a single API covers touch and pen. Setting
  // `touch-action: none` on the canvas keeps the browser from intercepting
  // the gesture for page scroll / pinch-zoom while still allowing the
  // native long-press contextmenu to surface (which is the intent of
  // "canvas long-press allowed").
  // -------------------------------------------------------------------------
  useEffect(() => {
    const el = gl.domElement;
    const previousTouchAction = el.style.touchAction;
    el.style.touchAction = "none";

    const onPointerDown = (e: PointerEvent) => {
      // Only accept touch / pen pointers here. Mouse routes through
      // PointerLookControls (drag-to-look) on the fine-pointer path.
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      const ts = touchStateRef.current;
      ts.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // Capture the pointer so we keep getting move/up events even if
      // the finger drifts off the canvas.
      el.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      const ts = touchStateRef.current;
      const prev = ts.pointers.get(e.pointerId);
      if (!prev) return;

      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      prev.x = e.clientX;
      prev.y = e.clientY;

      // Single-finger drag → rotation. Multi-finger gestures are
      // intentionally not consumed by this component (they used to
      // drive a two-finger walk; that was removed because the
      // joystick already handles touch translation).
      if (ts.pointers.size === 1) {
        ts.rotateDxPx += dx;
        ts.rotateDyPx += dy;
      }
    };

    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      const ts = touchStateRef.current;
      ts.pointers.delete(e.pointerId);
      el.releasePointerCapture?.(e.pointerId);
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerEnd);
    el.addEventListener("pointercancel", onPointerEnd);
    el.addEventListener("pointerleave", onPointerEnd);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerEnd);
      el.removeEventListener("pointercancel", onPointerEnd);
      el.removeEventListener("pointerleave", onPointerEnd);
      el.style.touchAction = previousTouchAction;
    };
  }, [gl]);

  // -------------------------------------------------------------------------
  // Per-frame: consume accumulated rotation deltas and translation inputs.
  // Pitch is clamped after every delta (Req 1.7). Translation is passed
  // through resolveMotion against the supplied colliders (Req 1.6).
  // -------------------------------------------------------------------------
  useFrame((_, dt) => {
    const ts = touchStateRef.current;
    const store = useGalleryStore.getState;

    // Gate touch input until the entry sequence completes.
    if (store().entryStage !== "inside") {
      ts.rotateDxPx = 0;
      ts.rotateDyPx = 0;
      return;
    }

    // ---- Rotation -----------------------------------------------------------
    if (ts.rotateDxPx !== 0 || ts.rotateDyPx !== 0) {
      const yawDelta = ts.rotateDxPx * ROTATE_SENSITIVITY;
      const pitchDelta = ts.rotateDyPx * ROTATE_SENSITIVITY;
      ts.rotateDxPx = 0;
      ts.rotateDyPx = 0;

      // Sign convention: dragging right (positive dx) rotates the
      // camera to look right, which for a YXZ Euler camera means
      // decreasing rotation.y.
      camera.rotation.y -= yawDelta;
      // Dragging down (positive dy) rotates the look UP (the world
      // appears to drag with the finger), so pitch increases.
      camera.rotation.x -= pitchDelta;
      camera.rotation.x = clamp(
        camera.rotation.x,
        -PITCH_LIMIT,
        PITCH_LIMIT,
      );

      if (store().zoomOpen) store().markNavInput();
    }

    // ---- Translation --------------------------------------------------------
    // Translation is driven exclusively by the on-screen joystick (the
    // DOM-side <TouchJoystick/> writes the axis into the shared module
    // ref). Multi-finger canvas gestures are intentionally not consumed.
    const joy = getSharedJoystickAxis();
    let inputRight = joy.x;
    let inputForward = joy.y;

    // Normalise so the input magnitude does not exceed 1. This keeps
    // the resulting velocity magnitude inside [TRANSLATE_SPEED_MIN,
    // TRANSLATE_SPEED_MAX] (Property 11).
    const mag = Math.hypot(inputRight, inputForward);
    if (mag > 1) {
      inputRight /= mag;
      inputForward /= mag;
    }

    if (Math.abs(inputRight) > 1e-6 || Math.abs(inputForward) > 1e-6) {
      // Compute world-space velocity from camera yaw only (pitch does
      // not affect ground-plane translation; this matches the
      // WheelControls convention referenced by Property 11).
      const yaw = camera.rotation.y;
      const sinY = Math.sin(yaw);
      const cosY = Math.cos(yaw);
      // Camera looks down its local -Z. With YXZ rotation about world Y:
      //   forward (world) = (-sin(y), 0, -cos(y))
      //   right   (world) = ( cos(y), 0, -sin(y))
      const fx = -sinY;
      const fz = -cosY;
      const rx = cosY;
      const rz = -sinY;

      const speed = TRANSLATE_SPEED;
      const velocity: Vec3 = [
        (fx * inputForward + rx * inputRight) * speed,
        0,
        (fz * inputForward + rz * inputRight) * speed,
      ];

      const current: Vec3 = [
        camera.position.x,
        camera.position.y,
        camera.position.z,
      ];
      const next = resolveMotion(current, velocity, dt, colliders);
      camera.position.set(next[0], next[1], next[2]);

      if (store().zoomOpen) store().markNavInput();
    }
  });

  // TouchControls is mounted inside the R3F `<Canvas>` to use
  // `useThree` / `useFrame`. R3F's reconciler only knows how to render
  // THREE primitives, so the on-screen joystick UI must live as a
  // sibling of the Canvas — see `<TouchJoystick/>` below, which the
  // gallery client mounts alongside the engine. This component
  // contributes only side effects to the scene tree.
  return null;
}

// ---------------------------------------------------------------------------
// TouchJoystick — DOM-only joystick UI mounted as a sibling of the
// `<Canvas>` (NOT inside it). Writes its axis into the shared module-
// scoped ref so the in-Canvas `<TouchControls/>` can read it inside
// `useFrame` without ever rendering DOM through R3F.
//
// Mounted by `app/gallery/GalleryClient.tsx` alongside the engine and
// the entry overlay. The component returns null on SSR or when the
// device exposes a fine pointer (mouse) without any coarse pointer —
// keyboard + mouse users don't need it. Hybrid devices and pure-touch
// devices both render it.
// ---------------------------------------------------------------------------

function useHasCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(any-pointer: coarse)");
    const update = () => setCoarse(mql.matches);
    update();
    mql.addEventListener?.("change", update);
    return () => mql.removeEventListener?.("change", update);
  }, []);
  return coarse;
}

export function TouchJoystick() {
  const entryStage = useGalleryStore((s) => s.entryStage);
  const zoomOpen = useGalleryStore((s) => s.zoomOpen);
  const hasCoarse = useHasCoarsePointer();

  // Knob offset from base center, in CSS pixels. State (not ref) so
  // React paints repaint the knob on every move.
  const [knob, setKnob] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Active pointer id while a drag is in flight, plus the joystick
  // base centre in client-space coordinates so we measure deflection
  // against the gesture origin instead of the most recent move.
  const pointerIdRef = useRef<number | null>(null);
  const centerRef = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
    const rect = e.currentTarget.getBoundingClientRect();
    centerRef.current = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    pointerIdRef.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromClient(e.clientX, e.clientY);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    updateFromClient(e.clientX, e.clientY);
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    pointerIdRef.current = null;
    centerRef.current = null;
    setSharedJoystickAxis(0, 0);
    setKnob({ x: 0, y: 0 });
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  function updateFromClient(clientX: number, clientY: number): void {
    const center = centerRef.current;
    if (!center) return;
    const radius = JOYSTICK_BASE_SIZE_PX / 2;
    const dx = clientX - center.x;
    const dy = clientY - center.y;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(dist, radius);
    const ux = dist > 0 ? dx / dist : 0;
    const uy = dist > 0 ? dy / dist : 0;
    setKnob({ x: ux * clampedDist, y: uy * clampedDist });

    let axisX = ux * (clampedDist / radius);
    // DOM y grows downward; "joystick up" should drive forward, so
    // flip the sign before publishing.
    let axisY = -uy * (clampedDist / radius);
    if (Math.hypot(axisX, axisY) < JOYSTICK_DEAD_ZONE) {
      axisX = 0;
      axisY = 0;
    }
    setSharedJoystickAxis(axisX, axisY);
  }

  // Don't render until we're both inside the gallery and on a device
  // that actually has a coarse pointer. Keyboard-and-mouse-only users
  // navigate with WASD and never need the joystick. Also hide while
  // the Zoom_View overlay is open so the joystick can't poke through
  // the dialog and obscure the metadata text.
  if (!hasCoarse) return null;
  if (entryStage !== "inside") return null;
  if (zoomOpen) return null;
  if (typeof document === "undefined") return null;

  const baseStyle: CSSProperties = {
    width: JOYSTICK_BASE_SIZE_PX,
    height: JOYSTICK_BASE_SIZE_PX,
    touchAction: "none",
  };
  const knobStyle: CSSProperties = {
    width: JOYSTICK_KNOB_SIZE_PX,
    height: JOYSTICK_KNOB_SIZE_PX,
    transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
  };

  return createPortal(
    <div
      data-testid="touch-joystick"
      role="presentation"
      aria-hidden="true"
      className="pointer-events-auto fixed bottom-6 left-6 z-40 select-none rounded-full border border-amber-200/30 bg-black/40 backdrop-blur-sm"
      style={baseStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <div
        className="absolute left-1/2 top-1/2 rounded-full bg-amber-200/80 shadow-md"
        style={knobStyle}
      />
    </div>,
    document.body,
  );
}
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

// ---------------------------------------------------------------------------
// Re-export the spec-defined ranges for tests / consumers that want to
// assert sensitivity and speed bounds without reading them out of source
// comments. These are exported as plain const values so they shrink to
// nothing in production bundles after dead-code elimination.
// ---------------------------------------------------------------------------

export const TOUCH_ROTATE_SENSITIVITY_BOUNDS = {
  min: ROTATE_SENSITIVITY_MIN,
  max: ROTATE_SENSITIVITY_MAX,
  /** Concrete sensitivity used by this component, in [min, max]. */
  current: ROTATE_SENSITIVITY,
} as const;

export const TOUCH_TRANSLATE_SPEED_BOUNDS = {
  min: TRANSLATE_SPEED_MIN,
  max: TRANSLATE_SPEED_MAX,
  /** Concrete speed used by this component, in [min, max]. */
  current: TRANSLATE_SPEED,
} as const;

export const TOUCH_PITCH_LIMIT_RAD = PITCH_LIMIT;

export default TouchControls;
