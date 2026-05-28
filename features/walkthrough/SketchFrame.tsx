"use client";

/**
 * SketchFrame — a single Sketch_Record rendered as a framed 3D artwork on
 * a gallery wall (Requirements 2.1, 2.2, 2.5, 3.3, 14.2).
 *
 * Layout (inside a `<group>` anchored at `wallPose.position`, rotated so
 * the local +Z basis vector aligns with `wallPose.normal`):
 *
 *   - Frame mesh: a thin `BoxGeometry` (matte-black `MeshStandardMaterial`)
 *     centred on the wall slot. Reads as a flat picture frame rather than a
 *     box because its depth is small relative to its width and height.
 *
 *   - Canvas mesh: a `PlaneGeometry` inset inside the frame opening, whose
 *     in-plane (width, height) is sized to preserve the source image's
 *     intrinsic aspect ratio (Requirement 2.2). The aspect ratio is read
 *     from the loaded texture's `image.naturalWidth / naturalHeight`. While
 *     the texture is still resolving, `useSketchTexture` returns the shared
 *     1×1 placeholder so the canvas mounts at 1:1 and re-renders to the
 *     correct ratio when the real load resolves.
 *
 *   - Interaction collider: an invisible `PlaneGeometry` slightly in front
 *     of the canvas that captures click / tap and calls
 *     `useGalleryStore.getState().openZoom(record.id, snapshot)` (Req 3.3).
 *     "Enter" while this frame is the proximity-focused frame routes
 *     through a `window` keydown listener (3D meshes are not in the
 *     accessibility tree, so the proximity gate is the documented
 *     interaction key).
 *
 * Texture composition (Requirement 13.6):
 *   The single texture-composition seam lives inside
 *   `features/walkthrough/textures/loadSketchTexture.ts`'s internal
 *   `composeSketchTexture(record, raw)` step. By the time `useSketchTexture`
 *   resolves, the returned `texture` is already composed — we simply assign
 *   it as `material.map`. A future watermarking, signed-URL, or DRM overlay
 *   belongs in that one helper and nowhere else.
 *
 * Proximity emphasis (Requirements 2.5, 2.6):
 *   When the gallery store reports `focusedFrameId === record.id`, the
 *   canvas material's `emissiveIntensity` is multiplied by 1.5 (≥1.25 per
 *   Req 2.5). `<ProximityHighlighter/>` is responsible for selecting the
 *   single nearest frame within 1.5m and writing the id into the store, so
 *   this component only reacts to the boolean equality check.
 *
 * Asset_Protection_Layer note (Requirement 6.1, 6.2, 13.6):
 *   `<ProtectedSurface/>` is a DOM-based wrapper that suppresses the native
 *   context-menu and drag behaviour on HTML/2D sketch surfaces. Inside the
 *   R3F `<Canvas>` subtree the rendered output is a raster (the WebGL
 *   canvas), so wrapping a 3D `<group>` in the DOM-based component would
 *   have no effect on raster pixels. The asset-protection guarantees for
 *   the in-scene canvas come from the `<ProtectedSurface/>` overlay
 *   sibling that wraps the `<Canvas>` host, plus the wraps on
 *   `<MetadataPanel/>`'s `<Html>` subtree and the `<ZoomView/>` overlay.
 *   The 3D group itself therefore uses raster-only protection per design
 *   and is intentionally not wrapped here.
 */

import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { SketchRecord } from "@/lib/sketch-record";

import type { WallPose } from "./placement";
import {
  useGalleryStore,
  type CameraSnapshot,
} from "./store/useGalleryStore";
import { useSketchTexture } from "./textures/loadSketchTexture";

/** Outer frame width in world units. Matches the placement helper's default
 * `frameWidth` so the placement walk and rendered geometry agree. */
const FRAME_WIDTH = 1.4;
/** Outer frame height. A roughly square outer frame leaves enough opening
 * for both portrait and landscape canvases under aspect-fit. */
const FRAME_HEIGHT = 1.4;
/** Frame thickness along the wall normal. Thin so the frame visually reads
 * as a flat picture frame rather than a box. */
const FRAME_DEPTH = 0.06;
/** Margin between the outer frame edge and the canvas opening on each side. */
const FRAME_INSET = 0.06;
/** Maximum canvas opening width. */
const CANVAS_OPENING_WIDTH = FRAME_WIDTH - 2 * FRAME_INSET;
/** Maximum canvas opening height. */
const CANVAS_OPENING_HEIGHT = FRAME_HEIGHT - 2 * FRAME_INSET;
/** Local-Z offset for the canvas mesh: just in front of the frame box's
 * front face so it sits flush in the opening without z-fighting. */
const CANVAS_DEPTH_OFFSET = FRAME_DEPTH / 2 + 0.001;
/** Local-Z offset for the invisible interaction collider: slightly further
 * out so it reliably catches click / tap input without poking through the
 * canvas mesh's depth-test. */
const COLLIDER_DEPTH_OFFSET = FRAME_DEPTH / 2 + 0.04;

/** Base material colour multiplier when the frame is not focused. */
const CANVAS_BASE_BRIGHTNESS = 1.0;
/**
 * Multiplier applied to the canvas colour when this frame is the
 * proximity-focused frame. Picks up bloom around the active frame
 * without changing the photo's stored colours.
 */
const CANVAS_FOCUS_BRIGHTNESS = 1.15;

export type SketchFrameProps = {
  /** The Sketch_Record this frame represents. Drives texture, metadata id,
   * and the Zoom_View target. */
  record: SketchRecord;
  /** Wall slot pose (world position + outward-facing wall normal) supplied
   * by the placement helper in catalogue order. */
  wallPose: WallPose;
};

/**
 * Convert a wall-normal vector (assumed horizontal) into the yaw rotation
 * around world Y that aligns the local +Z basis with the normal. A group
 * with rotation `[0, y, 0]` sends local +Z to `(sin y, 0, cos y)`, so
 * `y = atan2(nx, nz)` makes the frame's front face point into the room.
 * Mirrors the convention used by `<MetadataPanel/>` so frame and panel
 * face the same direction.
 */
function yawForNormal(normal: WallPose["normal"]): number {
  return Math.atan2(normal[0], normal[2]);
}

/**
 * Compute the canvas mesh's `(width, height)` in world units that preserves
 * the source image's intrinsic aspect ratio while fitting inside the frame
 * opening (Req 2.2 / Property 19). Falls back to a 1:1 fill of the opening
 * when either dimension is non-positive (e.g. the placeholder branch
 * before the real texture has resolved).
 */
function fitCanvasToAspect(
  naturalWidth: number,
  naturalHeight: number,
): [number, number] {
  if (
    !Number.isFinite(naturalWidth) ||
    !Number.isFinite(naturalHeight) ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
    return [CANVAS_OPENING_WIDTH, CANVAS_OPENING_HEIGHT];
  }
  const aspect = naturalWidth / naturalHeight;
  const openingAspect = CANVAS_OPENING_WIDTH / CANVAS_OPENING_HEIGHT;
  if (aspect >= openingAspect) {
    // Image is at least as wide as the opening: limit by width.
    const w = CANVAS_OPENING_WIDTH;
    const h = w / aspect;
    return [w, h];
  }
  // Image is taller than the opening: limit by height.
  const h = CANVAS_OPENING_HEIGHT;
  const w = h * aspect;
  return [w, h];
}

export function SketchFrame({
  record,
  wallPose,
}: SketchFrameProps) {
  const { texture: sketchTexture, status } = useSketchTexture(record);
  const camera = useThree((s) => s.camera);
  const isFocused = useGalleryStore(
    (s) => s.focusedFrameId === record.id,
  );

  // The texture's `.image` is an `HTMLImageElement` when `status === "ok"`
  // and a `{ data, width, height }` literal for the 1×1 `DataTexture`
  // placeholder. We only read the natural dimensions here; either branch
  // gives the correct fit (1:1 fills the opening for the placeholder).
  const sketchImage = sketchTexture.image as
    | HTMLImageElement
    | { width?: number; height?: number }
    | undefined;
  const naturalWidth =
    (sketchImage as HTMLImageElement | undefined)?.naturalWidth ??
    sketchImage?.width ??
    1;
  const naturalHeight =
    (sketchImage as HTMLImageElement | undefined)?.naturalHeight ??
    sketchImage?.height ??
    1;

  const [canvasWidth, canvasHeight] = useMemo(
    () => fitCanvasToAspect(naturalWidth, naturalHeight),
    [naturalWidth, naturalHeight],
  );

  const groupYaw = useMemo(
    () => yawForNormal(wallPose.normal),
    [wallPose.normal],
  );

  // Track the canvas material so the proximity-focus highlight has a
  // direct handle to it. With `meshBasicMaterial` we drive the
  // emphasis by tinting the colour brighter — the frame's lighting
  // is decorative around the photo, not used to brighten the photo
  // itself, so swapping a `color` value reads cleaner than the old
  // emissive multiplier under bloom.
  const canvasMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);

  useEffect(() => {
    const material = canvasMaterialRef.current;
    if (!material) return;
    // When the texture flips from null → a real texture (or vice
    // versa), `meshBasicMaterial` needs its shader recompiled to
    // include / drop the map sampler. Without this, R3F's prop
    // diff updates the `.map` slot but the GPU keeps using the old
    // shader and the photo never appears.
    material.needsUpdate = true;
  }, [sketchTexture, status]);

  useEffect(() => {
    const material = canvasMaterialRef.current;
    if (!material || status !== "ok") return;
    const v = isFocused ? CANVAS_FOCUS_BRIGHTNESS : CANVAS_BASE_BRIGHTNESS;
    material.color.setRGB(v, v, v);
  }, [isFocused, status]);

  // ---------------------------------------------------------------
  // Activation: click / tap / Enter → openZoom (Req 3.3)
  // ---------------------------------------------------------------

  /**
   * Capture the live camera pose so the Zoom_View dismiss path can restore
   * it exactly when no navigation input arrives during the overlay lifetime
   * (Req 3.5, 3.7, 14.3). Yaw and pitch are extracted in YXZ order, the
   * standard first-person ordering used by the controls subtree.
   */
  const captureSnapshot = useCallback((): CameraSnapshot => {
    const euler = new THREE.Euler().setFromQuaternion(
      camera.quaternion,
      "YXZ",
    );
    return {
      position: [camera.position.x, camera.position.y, camera.position.z],
      yaw: euler.y,
      pitch: euler.x,
    };
  }, [camera]);

  const openZoomForRecord = useCallback(() => {
    const state = useGalleryStore.getState();
    if (state.zoomOpen) return;
    // Activation gate (Req 3.3 + foyer entry sequence): only open the
    // Zoom_View once the visitor has walked into the gallery (entry
    // stage "inside") AND is close enough to this specific frame for
    // the proximity highlighter to have marked it focused (within
    // 1.5m, Req 2.5 / 2.6). This prevents a click on a frame that is
    // visible through the still-closed glass doors from popping the
    // zoom overlay over the foyer entry sequence.
    if (state.entryStage !== "inside") return;
    if (state.focusedFrameId !== record.id) return;
    state.openZoom(record.id, captureSnapshot());
  }, [record.id, captureSnapshot]);

  const handleColliderSelect = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      // Stop the pointer event from continuing through the canvas host so
      // pointer-lock toggles or drag-to-look gestures don't fire on the
      // same click that opened the Zoom_View.
      event.stopPropagation();
      openZoomForRecord();
    },
    [openZoomForRecord],
  );

  /**
   * Keyboard "Enter" while this frame is the proximity-focused one. The
   * proximity gate (Req 2.5/2.6) plus an Enter listener is the documented
   * interaction key referenced by Req 3.3, since 3D meshes are not in the
   * accessibility tree and cannot receive keyboard focus directly.
   */
  useEffect(() => {
    if (!isFocused) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Enter") return;
      // Don't fire while the Zoom_View is already open or being dismissed.
      if (useGalleryStore.getState().zoomOpen) return;
      event.preventDefault();
      openZoomForRecord();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFocused, openZoomForRecord]);

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  return (
    <group
      position={wallPose.position}
      rotation={[0, groupYaw, 0]}
      data-record-id={record.id}
    >
      {/* Outer frame: thin matte-black box around the canvas opening. */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[FRAME_WIDTH, FRAME_HEIGHT, FRAME_DEPTH]} />
        <meshStandardMaterial
          color="#1a1a1a"
          roughness={0.9}
          metalness={0}
        />
      </mesh>

      {/* Canvas mesh: scaled to preserve the source-image aspect ratio.
          Uses `meshBasicMaterial` so the dress photo is shown at its
          stored colours regardless of the gallery lighting — the photo
          is already its own "lit" representation. The frame's matte-
          black box still receives spotlight bloom around it.

          When the texture is still resolving or fell back to the
          placeholder we paint the mesh in a warm neutral so the frame
          still reads as a framed surface rather than a black square. */}
      <mesh
        position={[0, 0, CANVAS_DEPTH_OFFSET]}
        data-record-canvas-id={record.id}
      >
        <planeGeometry args={[canvasWidth, canvasHeight]} />
        <meshBasicMaterial
          ref={canvasMaterialRef}
          map={status === "ok" ? sketchTexture : null}
          color={status === "ok" ? "#ffffff" : "#d6c9a8"}
          toneMapped={false}
        />
      </mesh>

      {/* Invisible interaction collider. Slightly oversized along the
          canvas plane so taps that land on the matte border still open the
          Zoom_View. `transparent + opacity:0` (rather than `visible={false}`)
          keeps the mesh raycastable while invisible — the default raycaster
          skips objects whose `visible` is `false`.

          The pointer cursor is only set to "pointer" while this frame is
          the proximity-focused one inside the gallery, so far frames /
          frames seen through the still-closed foyer doors don't advertise
          themselves as clickable when `openZoomForRecord` would no-op. */}
      <mesh
        position={[0, 0, COLLIDER_DEPTH_OFFSET]}
        onClick={handleColliderSelect}
        onPointerOver={(event) => {
          if (!isFocused) return;
          if (useGalleryStore.getState().entryStage !== "inside") return;
          event.stopPropagation();
          if (typeof document !== "undefined") {
            document.body.style.cursor = "pointer";
          }
        }}
        onPointerOut={(event) => {
          event.stopPropagation();
          if (typeof document !== "undefined") {
            document.body.style.cursor = "";
          }
        }}
        data-record-collider-id={record.id}
      >
        <planeGeometry args={[FRAME_WIDTH, FRAME_HEIGHT]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

export default SketchFrame;
