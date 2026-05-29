// features/walkthrough/textures/marbleTileTexture.ts — procedural
// canvas texture that paints a single marble tile with grout strips
// along its right and bottom edges. The strips are positioned so the
// texture tiles seamlessly under `THREE.RepeatWrapping`: every tile
// in the rendered floor shows three of its four grout lines from the
// neighbouring textures wrapping around, producing a regular tiled
// grid without any explicit per-tile geometry.
//
// One canvas drawing is generated lazily on first call and cached at
// module scope. Each call to `createMarbleTileTexture()` returns a
// fresh `THREE.CanvasTexture` that wraps the same canvas — three.js
// uploads the canvas pixels once per WebGL renderer; the per-floor
// `repeat` configuration lives on the texture instance, not the
// canvas, so two floors of different sizes can share the same image.

import * as THREE from "three";

/** Pixel side of one tile in the cached canvas pattern. */
const TILE_PX = 512;

/** Pixel width of the grout strip (4 px @ 512 px tile = ~0.8% of tile). */
const GROUT_PX = 4;

/** Tile body colour — same Calacatta-style cream the floor used before. */
const TILE_COLOR = "#ece5d3";

/** Grout line colour — a warm taupe slightly darker than the tile so
 *  the joins read as cement-coloured grout, not a black grid. */
const GROUT_COLOR = "#b8ad95";

let cachedCanvas: HTMLCanvasElement | null = null;

/**
 * Build (or return cached) a canvas containing a single marble tile
 * with grout strips on the right and bottom edges. Browsers only —
 * the gallery engine subtree is `next/dynamic({ ssr: false })` so
 * this never runs during server rendering.
 */
function getMarbleTileCanvas(): HTMLCanvasElement {
  if (cachedCanvas) return cachedCanvas;
  const canvas = document.createElement("canvas");
  canvas.width = TILE_PX;
  canvas.height = TILE_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // Fall back to a solid-colour canvas if 2D isn't available — the
    // floor will still render, just without visible grout.
    cachedCanvas = canvas;
    return canvas;
  }
  // Tile body
  ctx.fillStyle = TILE_COLOR;
  ctx.fillRect(0, 0, TILE_PX, TILE_PX);
  // Grout strip on the right edge
  ctx.fillStyle = GROUT_COLOR;
  ctx.fillRect(TILE_PX - GROUT_PX, 0, GROUT_PX, TILE_PX);
  // Grout strip on the bottom edge
  ctx.fillRect(0, TILE_PX - GROUT_PX, TILE_PX, GROUT_PX);
  cachedCanvas = canvas;
  return canvas;
}

/**
 * Create a `THREE.CanvasTexture` configured to repeat the cached tile
 * pattern `repeatX` times across its U axis and `repeatY` times across
 * its V axis. The caller is responsible for choosing values that match
 * the floor's world dimensions divided by the desired physical tile
 * size — e.g. for a 0.8 m tile on an 18 m × 18 m floor, pass
 * `repeatX = repeatY = 22.5`.
 */
export function createMarbleTileTexture(
  repeatX: number,
  repeatY: number,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(getMarbleTileCanvas());
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Anisotropic filtering keeps the grout lines crisp at grazing
  // angles (the visitor's eye is 1.6 m above a polished floor, so
  // most of the floor area is sampled at oblique angles).
  tex.anisotropy = 8;
  return tex;
}
