"use client";

/**
 * Controls — pointer-mode router for the Walkthrough_Engine.
 *
 * Subscribes to three `matchMedia` queries and mounts the matching control
 * set per the responsive cross-device rules in Requirements 5.2, 5.3, and
 * 5.4 of the virtual-fashion-gallery spec:
 *
 *   - `(pointer: fine) and (hover: hover)`  ⇒  fine    (Req 5.3)
 *       Mounts <KeyboardControls/> + <PointerLookControls/>; the touch
 *       on-screen joystick from Req 1.5 is NOT rendered, and the
 *       PointerLookControls overlay drives the click-to-look prompt.
 *
 *   - `(pointer: coarse) and (hover: none)` ⇒  coarse  (Req 5.2)
 *       Mounts <TouchControls/> only; the keyboard-and-mouse pointer-lock
 *       prompt is NOT rendered.
 *
 *   - both `(any-pointer: fine)` and `(any-pointer: coarse)` matching
 *                                           ⇒  hybrid  (Req 5.4)
 *       Mounts all three control components simultaneously. Hybrid devices
 *       expose multiple pointing devices on the same `any-pointer` axis;
 *       the literal `(pointer: coarse) AND (pointer: fine)` from Req 5.4
 *       cannot evaluate true for a single primary pointer, so we evaluate
 *       hybrid via `any-pointer` which is the only spelling that captures
 *       devices whose primary pointer is one kind but which still expose
 *       the other (e.g., a 2-in-1 laptop with a mouse plugged in, or an
 *       iPad with a Magic Keyboard trackpad).
 *
 * Hybrid takes precedence over fine and coarse — if a device matches the
 * hybrid query at all, both modalities are mounted regardless of which of
 * fine / coarse also matches as the primary pointer.
 *
 * The component re-evaluates on every `change` event from any of the three
 * MediaQueryList objects, so plugging in a mouse on a tablet or detaching a
 * keyboard on a 2-in-1 swaps the mounted controls without remounting the
 * R3F <Canvas> (Req 5.6 keeps the scene mounted across re-fits).
 *
 * SSR safety:
 *   - `typeof window === "undefined"` short-circuits to `"fine"` so that
 *     server-rendered output mounts a safe default; the real evaluation
 *     runs in the `useEffect` once the component hydrates in the browser.
 *   - Tests running under jsdom without `window.matchMedia` (older jsdom
 *     versions) similarly short-circuit to `"fine"` rather than throw.
 *
 * Render output: a React fragment containing the chosen control
 * components. Each control component already returns either `null` or a
 * portal/Html overlay, so this component contributes no extra DOM of its
 * own. It must be mounted INSIDE the R3F <Canvas> tree because the
 * KeyboardControls / TouchControls / PointerLookControls all depend on
 * `useThree` for the camera and renderer.
 */

import { useEffect, useState, type ReactElement } from "react";

import type { AABB } from "./Collisions";
import { KeyboardControls } from "./KeyboardControls";
import { PointerLookControls } from "./PointerLookControls";
import { TouchControls } from "./TouchControls";

// ---------------------------------------------------------------------------
// Media query strings
// ---------------------------------------------------------------------------

/** Req 5.3 — desktop-class fine pointing device with hover capability. */
export const FINE_QUERY = "(pointer: fine) and (hover: hover)";

/** Req 5.2 — touch-class coarse pointing device without hover. */
export const COARSE_QUERY = "(pointer: coarse) and (hover: none)";

/**
 * Req 5.4 — hybrid devices that expose both a fine AND a coarse pointer.
 * Uses `any-pointer` because the primary `pointer:` keyword can only
 * resolve to a single kind for any given device, while `any-pointer:`
 * matches if at least one input pointer of the queried kind is connected.
 */
export const HYBRID_QUERY = "(any-pointer: fine) and (any-pointer: coarse)";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PointerMode = "fine" | "coarse" | "hybrid";

export type ControlsProps = {
  /**
   * AABB colliders forwarded to the keyboard and touch control components
   * (Req 1.6). Defaults to an empty list so the router renders cleanly in
   * tests / Storybook without a full WalkthroughScene mount.
   * PointerLookControls does not consume colliders — it only rotates the
   * camera and never translates it.
   */
  colliders?: ReadonlyArray<AABB>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the active pointer mode from the three media queries, preferring
 * hybrid over fine over coarse. Returns `"fine"` when `window.matchMedia`
 * is not available (SSR or older test environments) so the server-rendered
 * shell is consistent with a desktop-class default; the real evaluation
 * runs in the `useEffect` once the browser hydrates the component.
 */
function resolvePointerMode(): PointerMode {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "fine";
  }
  if (window.matchMedia(HYBRID_QUERY).matches) return "hybrid";
  if (window.matchMedia(FINE_QUERY).matches) return "fine";
  if (window.matchMedia(COARSE_QUERY).matches) return "coarse";
  // Devices that don't match any of the three documented modes (rare —
  // e.g., a hover-capable coarse pointer) default to fine so visitors can
  // still navigate via keyboard. Hybrid would cause the touch overlay UI
  // to render on a desktop browser that is mid-resize and momentarily
  // matches neither query, which is the wrong default.
  return "fine";
}

/**
 * Subscribe to a `MediaQueryList`'s `change` event using the modern
 * `addEventListener` API and falling back to the deprecated
 * `addListener` / `removeListener` pair on older WebKit (Safari < 14).
 * Returns an unsubscribe function suitable for a `useEffect` cleanup.
 */
function subscribeToChange(
  mql: MediaQueryList,
  handler: (event: MediaQueryListEvent) => void,
): () => void {
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }
  // Older Safari shipped only the legacy listener API. Cast through the
  // intersection so TypeScript accepts the deprecated signature without
  // forcing consumers to widen their lib target.
  const legacy = mql as MediaQueryList & {
    addListener: (cb: (e: MediaQueryListEvent) => void) => void;
    removeListener: (cb: (e: MediaQueryListEvent) => void) => void;
  };
  legacy.addListener(handler);
  return () => legacy.removeListener(handler);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Controls({ colliders = [] }: ControlsProps): ReactElement {
  const [mode, setMode] = useState<PointerMode>(() => resolvePointerMode());

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const fineMql = window.matchMedia(FINE_QUERY);
    const coarseMql = window.matchMedia(COARSE_QUERY);
    const hybridMql = window.matchMedia(HYBRID_QUERY);

    // Re-evaluate eagerly on mount so any drift between the lazy
    // `useState` initialiser (which ran before hydration in some
    // setups) and the live media-query state is corrected immediately.
    const evaluate = () => {
      if (hybridMql.matches) {
        setMode("hybrid");
      } else if (fineMql.matches) {
        setMode("fine");
      } else if (coarseMql.matches) {
        setMode("coarse");
      } else {
        setMode("fine");
      }
    };

    evaluate();

    const unsubscribeFine = subscribeToChange(fineMql, evaluate);
    const unsubscribeCoarse = subscribeToChange(coarseMql, evaluate);
    const unsubscribeHybrid = subscribeToChange(hybridMql, evaluate);

    return () => {
      unsubscribeFine();
      unsubscribeCoarse();
      unsubscribeHybrid();
    };
  }, []);

  // Render the matching control set. Each branch returns a fragment so the
  // router contributes no extra DOM/scene nodes of its own.
  if (mode === "coarse") {
    return (
      <>
        <TouchControls colliders={colliders} />
      </>
    );
  }

  if (mode === "hybrid") {
    return (
      <>
        <KeyboardControls colliders={colliders} />
        <PointerLookControls />
        <TouchControls colliders={colliders} />
      </>
    );
  }

  // Default / "fine": keyboard + pointer-lock with drag-to-look fallback.
  return (
    <>
      <KeyboardControls colliders={colliders} />
      <PointerLookControls />
    </>
  );
}

export default Controls;
