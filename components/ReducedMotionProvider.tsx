"use client";

/**
 * ReducedMotionProvider — wraps the app with framer-motion's `MotionConfig`
 * so that all consumers honour the visitor's OS-level
 * `prefers-reduced-motion` preference (Requirements 4.6, 10.2, 10.3).
 *
 * Two responsibilities:
 *   1. Render `<MotionConfig reducedMotion="user">` so framer-motion's
 *      built-in `useReducedMotion()` resolves to the OS preference for any
 *      descendant (LandingClient, ZoomView, ...).
 *   2. Mirror that boolean into the gallery zustand store as
 *      `reducedMotion: boolean`, so the Walkthrough_Engine can damp
 *      ambient camera animation (Req 10.3) without unmounting the scene.
 *
 * The store reference is intentionally lazy: this provider is mounted from
 * `app/layout.tsx` (task 7.1) earlier in the staged build than the gallery
 * store is created (task 9.1). The dynamic import + defensive guard means
 * the provider works correctly in either order.
 */

import { MotionConfig, useReducedMotion } from "framer-motion";
import { useEffect, type ReactNode } from "react";

// Re-export framer-motion's hook so consumers can import it from this
// provider as the canonical source of the reduced-motion signal.
export { useReducedMotion } from "framer-motion";

type GalleryStoreModule = {
  useGalleryStore?: {
    getState: () => {
      setReducedMotion?: (value: boolean) => void;
    };
  };
};

async function loadGalleryStore(): Promise<GalleryStoreModule | null> {
  try {
    // Lazy/forward import: when this provider mounts before the gallery
    // store module exists in the build, the dynamic import simply rejects
    // and the catch branch returns `null`. Once the store ships (task 9.1)
    // the module loads and structurally matches `GalleryStoreModule`.
    const mod: GalleryStoreModule = await import(
      "@/features/walkthrough/store/useGalleryStore"
    );
    return mod;
  } catch {
    // Module not present yet (pre-task-9.1). framer-motion's `MotionConfig`
    // still applies `reducedMotion="user"` globally on its own, so 2D
    // surfaces honour the preference even before the store exists.
    return null;
  }
}

/**
 * Inner sync component: reads the framer-motion reduced-motion signal and
 * forwards it to the gallery store whenever it changes. Returns no DOM.
 */
function ReducedMotionStoreSync(): null {
  const reduced = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    const value = reduced ?? false;

    void loadGalleryStore().then((mod) => {
      if (cancelled || !mod) return;
      const setReducedMotion = mod.useGalleryStore?.getState().setReducedMotion;
      if (typeof setReducedMotion === "function") {
        setReducedMotion(value);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [reduced]);

  return null;
}

export function ReducedMotionProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <ReducedMotionStoreSync />
      {children}
    </MotionConfig>
  );
}
