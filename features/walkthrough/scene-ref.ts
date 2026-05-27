/**
 * scene-ref.ts — stable accessor for the underlying THREE.Scene reference.
 *
 * The Walkthrough_Engine mounts a <SceneRefBinder/> child of the R3F
 * <Canvas> that grabs `useThree(s => s.scene)` and registers it here. Code
 * that needs the live scene (notably a future @react-three/xr integration
 * per Requirement 5.7 / 13.1) reads through `getSceneRef()` instead of
 * threading a prop through the component tree, so the WebXR seam is a
 * single import and no scene/lighting/frame component changes when XR is
 * wired in later.
 *
 * The accessor is module-scoped on purpose: the Gallery_App only ever
 * mounts one Walkthrough_Engine at a time, and the scene reference is
 * cleared on unmount to avoid leaking a stale Scene into a remounted
 * Canvas.
 */

"use client";

import { useEffect } from "react";
import type * as THREE from "three";

let currentScene: THREE.Scene | null = null;

/**
 * Returns the currently registered Walkthrough_Scene reference, or null if
 * no Walkthrough_Engine is mounted. Callers must tolerate `null` because
 * the WebGL_Fallback path never registers a scene.
 */
export function getSceneRef(): THREE.Scene | null {
  return currentScene;
}

/**
 * Registers (or clears, when passed `null`) the Walkthrough_Scene
 * reference. Intended for use by `<SceneRefBinder/>`; calling it directly
 * from product code is a smell.
 */
export function setSceneRef(scene: THREE.Scene | null): void {
  currentScene = scene;
}

/**
 * Convenience alias preserved for the Requirement 13.1 seam wording in
 * `design.md` ("`features/walkthrough/scene-ref.ts` exposes
 * `getWalkthroughSceneRef()`"). Implemented as a thin re-export of
 * `getSceneRef` so consumers can use either name.
 */
export const getWalkthroughSceneRef = getSceneRef;

/**
 * SceneRefBinder — registers the supplied THREE.Scene with the module-
 * scoped accessor on mount and clears it on unmount.
 *
 * Mount this as a child of the R3F `<Canvas>` and pass it the scene from
 * `useThree((s) => s.scene)`. It renders nothing.
 */
export function SceneRefBinder({
  scene,
}: {
  scene: THREE.Scene | null | undefined;
}): null {
  useEffect(() => {
    if (!scene) return;
    setSceneRef(scene);
    return () => {
      // Only clear if we are still the registered scene; guards against a
      // second SceneRefBinder having taken over before our cleanup runs.
      if (currentScene === scene) {
        setSceneRef(null);
      }
    };
  }, [scene]);

  return null;
}
