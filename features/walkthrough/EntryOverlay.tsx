"use client";

/**
 * EntryOverlay — DOM affordances rendered above (and outside) the R3F
 * `<Canvas>` for the showroom-style entry sequence and the post-entry
 * navigation hint.
 *
 * Two states, mirroring the gallery store's `entryStage` field:
 *
 *   - "foyer"     : Visitor has just landed in the foyer chamber.
 *                   The overlay shows the gallery title, a brief
 *                   description, a primary "Step inside" button, and
 *                   a short navigation hint that adapts to the visitor's
 *                   pointer kind (keyboard + mouse, or touch).
 *   - "entering"  : Same overlay but the button is disabled and the
 *                   copy switches to "Walking in…" so the visitor can
 *                   see the auto-walk progress.
 *   - "inside"    : The overlay collapses into a small navigation-hint
 *                   chip docked to the bottom of the screen. The chip
 *                   stays visible for ~6s after entry then auto-hides
 *                   so it does not compete with the gallery itself.
 *
 * The overlay also exposes a Tab-reachable Skip link that flips
 * straight to "inside" — useful for visitors who prefer to bypass the
 * cinematic entry, and for screen-reader users who would otherwise
 * have no audible cue that the entry is animating.
 */

import { useCallback, useEffect, useState } from "react";

import { FOCUS_RING_CLASS } from "@/components/FocusRing";

import { useGalleryStore } from "./store/useGalleryStore";

const HINT_AUTO_HIDE_MS = 6000;

/**
 * Detect whether the visitor is on a coarse-pointer (touch) device.
 * Used to swap the navigation-hint copy so mobile users see the
 * touch gesture instead of WASD/arrow keys.
 */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(mql.matches);
    update();
    mql.addEventListener?.("change", update);
    return () => mql.removeEventListener?.("change", update);
  }, []);
  return coarse;
}

export function EntryOverlay() {
  const entryStage = useGalleryStore((s) => s.entryStage);
  const beginEntry = useGalleryStore((s) => s.beginEntry);
  const coarse = useCoarsePointer();

  const [hintVisible, setHintVisible] = useState(true);

  // Once we've entered, auto-hide the in-gallery navigation hint after
  // a short window so the visitor can see the room without the chip
  // competing for attention. The hint can be re-summoned via the
  // permanent "?" button rendered alongside.
  useEffect(() => {
    if (entryStage !== "inside") return;
    setHintVisible(true);
    const id = window.setTimeout(() => setHintVisible(false), HINT_AUTO_HIDE_MS);
    return () => window.clearTimeout(id);
  }, [entryStage]);

  // Keyboard shortcut while in foyer: Enter or Space presses the
  // "Step inside" button without requiring a click. Once entryStage
  // becomes "inside" the wheel + drag-to-look controls take over;
  // arrow keys are not wired anywhere on the gallery page.
  useEffect(() => {
    if (entryStage !== "foyer") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        beginEntry();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entryStage, beginEntry]);

  // "Step inside" begins the entry sequence: the glass doors slide
  // apart and the camera auto-walks through the doorway. When the
  // walk completes the EntryWalkController flips entryStage to
  // "inside", which unlocks free navigation (WASD / arrow keys /
  // mouse-look / touch joystick).
  const handleStepInside = useCallback(() => {
    if (entryStage === "foyer") beginEntry();
  }, [entryStage, beginEntry]);

  if (entryStage === "foyer") {
    return (
      <div
        className="pointer-events-none fixed inset-0 z-30 flex flex-col items-center justify-end gap-6 px-6 pb-12 sm:pb-16"
        data-vfg-entry-overlay={entryStage}
      >
        <div className="pointer-events-auto flex max-w-xs flex-col items-center gap-3 rounded-md border border-white/10 bg-black/55 px-5 py-4 text-center text-[var(--gallery-fg)] backdrop-blur-md">
          <p className="font-display text-xs uppercase tracking-[0.3em] text-[var(--gallery-muted)]">
            Welcome to the showroom
          </p>
          <button
            type="button"
            onClick={handleStepInside}
            disabled={entryStage !== "foyer"}
            className={`inline-flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-md bg-[var(--gallery-accent)] px-5 py-2.5 font-display text-sm font-medium uppercase tracking-[0.2em] text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING_CLASS}`}
            aria-label="Open the doors and step inside"
            data-vfg-entry-button=""
          >
            {entryStage === "foyer" ? (
              <>
                <span aria-hidden="true">→</span>
                Step inside
              </>
            ) : (
              <>Walking in…</>
            )}
          </button>
        </div>
      </div>
    );
  }

  // entryStage === "inside" → render a small dismissable navigation chip
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-20 flex justify-center px-4"
      data-vfg-nav-hint=""
    >
      {hintVisible ? (
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-white/10 bg-black/55 px-4 py-2 text-xs text-[var(--gallery-fg)] backdrop-blur-md">
          <span className="font-body">
            {coarse
              ? "Drag to look · joystick at bottom-left to walk"
              : "Drag with mouse to look · scroll wheel to walk · click a frame to zoom"}
          </span>
          <button
            type="button"
            onClick={() => setHintVisible(false)}
            aria-label="Dismiss navigation hint"
            className={`-mr-1 rounded-full p-1 text-[var(--gallery-muted)] transition-colors hover:text-[var(--gallery-fg)] ${FOCUS_RING_CLASS}`}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setHintVisible(true)}
          aria-label="Show navigation hint"
          className={`pointer-events-auto rounded-full border border-white/10 bg-black/55 px-3 py-1.5 text-xs text-[var(--gallery-muted)] backdrop-blur-md transition-colors hover:text-[var(--gallery-fg)] ${FOCUS_RING_CLASS}`}
        >
          ?
        </button>
      )}
    </div>
  );
}

export default EntryOverlay;
