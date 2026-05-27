"use client";

/**
 * Post_Processing_Pipeline
 *
 * Implements Requirement 2.4 (bloom + vignette over the Walkthrough_Scene)
 * and Requirement 11.6 (built on @react-three/postprocessing).
 *
 * Configuration intent: cinematic but readable. Bloom intensity is kept low
 * with a relatively high luminance threshold so only the brightest highlights
 * (e.g. spot-lit frame edges) bloom; Metadata_Panel text rendered through
 * <Html transform/> stays legible. Vignette darkness ≈ 0.3 keeps room corners
 * subtly framed without crushing the panels at the periphery.
 */

import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";

export function PostFx() {
  return (
    <EffectComposer>
      <Bloom
        intensity={0.4}
        luminanceThreshold={0.85}
        luminanceSmoothing={0.2}
        mipmapBlur
      />
      <Vignette darkness={0.3} offset={0.3} eskil={false} />
    </EffectComposer>
  );
}
