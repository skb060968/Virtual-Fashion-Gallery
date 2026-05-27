/**
 * WebGL feature detection helper.
 *
 * Validates Requirement 10.4: when WebGL is unavailable or initialisation
 * throws, the Gallery_App must take the WebGL_Fallback path instead of
 * mounting the Walkthrough_Engine. `GalleryClient` calls `detectWebGL()`
 * synchronously on the client, so this helper must:
 *
 *   1. Be SSR-safe (no `window`/`document` access on the server).
 *   2. Never throw — every probe is wrapped so any failure becomes `false`.
 *   3. Probe a throwaway `<canvas>` for `webgl2` and fall back to `webgl`.
 */

export function detectWebGL(): boolean {
  // SSR guard: on the server, `window`, `document`, and `WebGLRenderingContext`
  // do not exist. Returning `false` is safe here because `GalleryClient` is a
  // client component and will re-evaluate after hydration.
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  try {
    // The constructor must be present for any WebGL context to be obtainable.
    if (typeof (window as { WebGLRenderingContext?: unknown }).WebGLRenderingContext === "undefined") {
      return false;
    }

    const canvas = document.createElement("canvas");

    // Prefer WebGL2 when available, otherwise fall back to WebGL1. Either
    // result that is non-null counts as "WebGL is available".
    const gl =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      null;

    return gl !== null;
  } catch {
    // Some browsers throw from `getContext` when WebGL is blocklisted,
    // out of GPU resources, or disabled by policy. Treat any throw as
    // "WebGL unavailable" so the caller can render the fallback surface.
    return false;
  }
}
