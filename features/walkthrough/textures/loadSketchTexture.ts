"use client";

/**
 * loadSketchTexture — single dedicated texture-loading helper for the
 * Walkthrough_Engine (Requirement 13.3).
 *
 * Two public surfaces:
 *
 *   - `loadSketchTexture(record)` — async fetch + decode + compose, resolving
 *     to `{ texture, status }`. Resolves (never rejects) with a neutral
 *     placeholder on network error, decode failure, or a 10s load timeout
 *     (Requirements 2.7, 2.8).
 *   - `useSketchTexture(record)` — React hook returning the current
 *     `SketchTexture` for a record. Subscribes to the module-scoped cache so
 *     every caller for the same `Sketch_Record.id` observes the same
 *     `THREE.Texture` reference (Requirement 2.7).
 *
 * The cache is a `Map<id, Promise<SketchTexture>>` keyed by
 * `Sketch_Record.id`, not by `imageSrc`, so an editor can swap a record's
 * `imageSrc` without breaking de-duplication.
 *
 * Internally every successful load passes through a single
 * `composeSketchTexture(record, raw)` step — the texture-composition seam
 * referenced by Requirement 13.6. In v1 it returns `raw` unchanged. Future
 * watermarking, signed-URL fetching, or DRM-style overlay belongs inside
 * that one function and nowhere else.
 *
 * @see {@link ../../../components/ProtectedSurface.tsx} for the v1
 *      anti-casual-piracy hardening (Requirement 6).
 */

import { useEffect, useState } from "react";
import * as THREE from "three";

import type { SketchRecord } from "@/lib/sketch-record";

/**
 * The shape returned by both `loadSketchTexture` and `useSketchTexture`.
 * `status` is `"ok"` when the source image was fetched and decoded
 * successfully, and `"placeholder"` when the load was still pending, errored,
 * decode-failed, or timed out — in every "placeholder" case the texture is
 * the same shared 1×1 neutral-grey `DataTexture` so callers can render at
 * the same scale without a layout jump.
 */
export type SketchTexture = {
  texture: THREE.Texture;
  status: "ok" | "placeholder";
};

/** Hard cap on a single image's load + decode time (Requirement 2.8). */
const LOAD_TIMEOUT_MS = 10_000;

/**
 * Module-scoped cache keyed by `Sketch_Record.id` (Requirement 2.7).
 *
 * Stored values are the in-flight or settled promise; consumers awaiting the
 * same id always observe the same `SketchTexture` instance, and the
 * underlying loader runs at most once per id per module lifetime.
 */
const textureCache = new Map<string, Promise<SketchTexture>>();

/**
 * Single shared placeholder texture lazily created on first need so that the
 * THREE/WebGL machinery is only touched in the browser. The same instance is
 * handed back to every caller in a "placeholder" result so they all draw the
 * identical 1×1 neutral-grey pixel.
 */
let placeholderTexture: THREE.DataTexture | null = null;

/**
 * Build the 1×1 neutral-grey placeholder texture. RGBA `(128, 128, 128, 255)`
 * is mid-grey in sRGB, which reads as a calm neutral against the dark gallery
 * palette without drawing the eye away from frames that did load.
 */
function createPlaceholderTexture(): THREE.DataTexture {
  const data = new Uint8Array([128, 128, 128, 255]);
  const tex = new THREE.DataTexture(
    data,
    1,
    1,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  tex.name = "sketch-placeholder";
  return tex;
}

/** Lazy accessor for the shared placeholder, created on first call. */
function getPlaceholderTexture(): THREE.DataTexture {
  if (!placeholderTexture) {
    placeholderTexture = createPlaceholderTexture();
  }
  return placeholderTexture;
}

/**
 * Texture-composition seam (Requirement 13.6).
 *
 * v1: identity — returns `raw` unchanged. This is the *only* place a future
 * watermark/DRM/overlay step needs to be wired in, and it must remain the
 * sole composition hook in the gallery so the seam stays single-point.
 */
function composeSketchTexture(
  _record: SketchRecord,
  raw: THREE.Texture,
): THREE.Texture {
  return raw;
}

/**
 * One-shot loader: fetch + decode the image referenced by `record.imageSrc`,
 * wrap it in a `THREE.Texture`, run it through `composeSketchTexture`, and
 * resolve with `{ texture, status: "ok" }`.
 *
 * On error or a 10s timeout, resolves (never rejects) with the shared
 * placeholder texture and `status: "placeholder"`, after emitting
 * `console.warn("[sketch] load failed", record.id)` exactly once.
 *
 * Uses `THREE.TextureLoader` rather than constructing a `Texture` from a
 * raw `Image` element. The loader handles the async dance internally
 * (cross-origin, decode, GPU upload prep) and produces a texture whose
 * `image` is fully populated by the time the success callback fires —
 * which is what the `<SketchFrame/>`'s aspect-ratio fallback relies on.
 */
function loadOne(record: SketchRecord): Promise<SketchTexture> {
  return new Promise<SketchTexture>((resolve) => {
    if (typeof window === "undefined") {
      // Server-side guard. Should never happen because the consumer is
      // a `"use client"` hook, but fail safe just in case.
      resolve({ texture: getPlaceholderTexture(), status: "placeholder" });
      return;
    }

    let settled = false;
    const finish = (result: SketchTexture): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const fail = (): void => {
      if (settled) return;
      console.warn("[sketch] load failed", record.id);
      finish({ texture: getPlaceholderTexture(), status: "placeholder" });
    };

    const timer = setTimeout(fail, LOAD_TIMEOUT_MS);

    const loader = new THREE.TextureLoader();
    loader.load(
      record.imageSrc,
      (texture) => {
        if (settled) return;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        texture.name = `sketch:${record.id}`;
        const composed = composeSketchTexture(record, texture);
        finish({ texture: composed, status: "ok" });
      },
      undefined,
      (err) => {
        console.warn("[sketch] loader error for", record.id, err);
        fail();
      },
    );
  });
}

/**
 * Public async API: returns the cached `Promise<SketchTexture>` for the
 * record's id, populating the cache on first call. The promise resolves
 * (never rejects) — failure modes resolve with a placeholder result.
 *
 * On every call we also mark the underlying texture as needing GPU re-
 * upload once it resolves. The cache is module-scoped and survives
 * Canvas remounts (e.g. navigating away from /gallery and back), but
 * each new `WebGLRenderer` starts with an empty texture-properties
 * map; without `needsUpdate = true` three.js's renderer treats the
 * cached texture as already uploaded and the mesh renders blank.
 */
export function loadSketchTexture(
  record: SketchRecord,
): Promise<SketchTexture> {
  let entry = textureCache.get(record.id);
  if (!entry) {
    entry = loadOne(record);
    textureCache.set(record.id, entry);
  }
  // Schedule a `needsUpdate` flip on the resolved texture without
  // returning a derived promise (we want every consumer to receive
  // the same `SketchTexture` instance).
  void entry.then((result) => {
    if (result.status === "ok") {
      result.texture.needsUpdate = true;
    }
  });
  return entry;
}

/**
 * React hook: returns the current `SketchTexture` for `record`. Until the
 * underlying load resolves, returns the shared placeholder (with
 * `status: "placeholder"`) so the SketchFrame can mount and lay out at a
 * stable size; once the load resolves, the hook re-renders with the real
 * texture and `status: "ok"`.
 *
 * Multiple components mounting the same `record.id` share the cached
 * promise; the underlying `Image` load runs at most once per id per
 * module lifetime (Requirement 2.7).
 */
export function useSketchTexture(record: SketchRecord): SketchTexture {
  const [state, setState] = useState<SketchTexture>(() => ({
    texture: getPlaceholderTexture(),
    status: "placeholder",
  }));

  useEffect(() => {
    let cancelled = false;

    // Kick off (or join) the cached load. The hook stays at its
    // current placeholder/ok value while the promise is pending — we
    // intentionally do NOT reset state to placeholder on every mount,
    // because under React StrictMode the resulting double-render race
    // between the first effect's pending promise and the second
    // effect's placeholder reset has been observed to leave the
    // canvas blank after a hard refresh.
    loadSketchTexture(record).then((result) => {
      if (cancelled) return;
      setState(result);
    });

    return () => {
      cancelled = true;
    };
  }, [record.id]);

  return state;
}
