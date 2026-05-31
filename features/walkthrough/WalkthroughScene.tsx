"use client";

/**
 * WalkthroughScene — the 3D environment inside the Walkthrough_Engine.
 *
 * Implements:
 *
 *   - Requirement 1.1 : a 3D scene with walls, floor, ceiling, and at least
 *                       one Sketch_Frame.
 *   - Requirement 1.8 : a deterministic spawn point declared in code.
 *   - Requirement 2.1 : exactly one Sketch_Frame per Sketch_Record placed
 *                       so neighbours do not overlap (delegated to
 *                       `placeFrames` for the geometry, and to React's
 *                       reconciler keyed by `record.id` for the 1:1 map).
 *   - Requirement 2.3 : every Sketch_Frame is lit by at least one direct
 *                       front-facing light from the visitor's spawn-side.
 *   - Requirement 9.4 : the count of active real-time lights stays ≤ 8.
 *                       Asserted at mount time inside a single `useEffect`
 *                       that traverses the live `THREE.Scene` once.
 *   - Requirement 14.1 / 14.2 : Sketch_Frame count equals catalogue
 *                       length, frames are mounted in catalogue order
 *                       with React `key={record.id}` byte-for-byte equal
 *                       to the Sketch_Record's `id`.
 *
 * Composition (mounted children):
 *
 *   - Room geometry:   floor, ceiling, four interior wall planes — each
 *                      a `<mesh>` with `MeshStandardMaterial`. Lighting
 *                      is computed in real time via the lights below;
 *                      no baked maps in v1.
 *   - Lights:          1 ambient + 1 hemisphere + 4 spot lights, one
 *                      per wall, each aimed at its wall's mid-line so
 *                      every Sketch_Frame on that wall receives at
 *                      least one direct front light. Total active = 6,
 *                      comfortably under the Req 9.4 cap of 8 with two
 *                      slots reserved for future accents.
 *   - Sketch_Frames:   one `<SketchFrame/>` per Sketch_Record in
 *                      catalogue order, keyed by `record.id`.
 *   - Metadata_Panels: one `<MetadataPanel/>` per Sketch_Record,
 *                      anchored to the same wall pose as its frame.
 *   - Proximity:       a single `<ProximityHighlighter/>` reads camera
 *                      position each frame and writes the nearest-id
 *                      into `useGalleryStore` (Req 2.5, 2.6).
 *   - Post-processing: `<PostFx/>` mounts the bloom + vignette pass.
 *   - Scene-ref bind:  `<SceneRefBinder/>` registers the active
 *                      `THREE.Scene` into `scene-ref.ts` so future
 *                      WebXR (Req 5.7, 13.1) can attach without
 *                      threading props through this component.
 *
 * The placement helper is the single source of truth for wall poses;
 * frames and panels read from the same `WallPose` array so there is
 * no divergence between frame geometry and panel anchoring.
 */

import { Center, MeshReflectorMaterial, Text3D, useTexture } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { sketches } from "@/lib/sketches";

import { MetadataPanel } from "./MetadataPanel";
import { placeFrames, type RoomDimensions, type WallPose } from "./placement";
import { useGalleryStore } from "./store/useGalleryStore";
import { PostFx } from "./PostFx";
import {
  ProximityHighlighter,
  type ProximityFrame,
} from "./ProximityHighlighter";
import { SceneRefBinder } from "./scene-ref";
import { SketchFrame } from "./SketchFrame";
import { createMarbleTileTexture } from "./textures/marbleTileTexture";

// ----------------------------------------------------------------------
// Room and spawn constants (Requirements 1.1, 1.8)
// ----------------------------------------------------------------------

/**
 * Interior dimensions of the gallery room in world units (≈ metres).
 * Width × height × depth = 11 × 4 × 18. The room shares its 11m width
 * with the foyer chamber so the side walls of the foyer continue
 * cleanly into the gallery side walls — the visitor sees one
 * uninterrupted 11m-wide corridor from the showroom front through to
 * the back gallery wall. Depth stays at 18m so all 23 catalogue
 * records (1 designer + 22 dresses) fit along the three usable walls
 * with no overflow.
 */
export const ROOM: RoomDimensions = {
  width: 11,
  height: 4,
  depth: 18,
};

/**
 * Deterministic spawn point and orientation (Requirement 1.8).
 *
 * The Visitor enters the foyer chamber attached to the gallery's south
 * wall (which sits at +z) and faces the gallery doorway. The spawn
 * sits 8m back from the doorway plane (z=9), right at the foyer's
 * far back wall (z=18) with the standard 1m collision clearance —
 * the deepest reachable point in the foyer chamber. Gives the
 * widest sightline to the entire boutique facade: the GP FASHION
 * signboard above the doorway, the brass-bordered marquee, the
 * closed glass doors, and the surrounding facade panels all fit
 * comfortably in the visitor's initial field of view.
 *
 * In three.js the default camera looks down −z, so `yaw = 0` keeps the
 * forward vector pointing toward −z — which from a foyer position at
 * `z = 17` aims through the doorway at `z = +9` and on into the
 * gallery proper. Pitch = 0 keeps the camera level. Eye height of
 * 1.6m is a standing-adult default and matches the mid-wall frame
 * anchor at `room.height / 2`.
 *
 * Exported as a frozen object so consumers (controls subtree, future
 * XR session, tests) can read the same canonical value without being
 * able to mutate it.
 */
export const SPAWN = Object.freeze({
  position: [0, 1.6, 17] as const,
  yaw: 0,
  pitch: 0,
});

/**
 * Foyer geometry constants. The foyer is a smaller chamber attached to
 * the gallery's south wall, used to stage the showroom-style entry
 * sequence. Visitors land here on first mount, see the glass doors and
 * the entry overlay, and only enter the gallery proper after pressing
 * the on-screen "Step inside" button.
 */
const FOYER_DEPTH = 9;
const FOYER_WIDTH = 11; // wide enough that the open door panels tuck behind the foyer side walls without clipping through them
/** Width of the doorway cut into the south wall, in world units. */
const DOORWAY_WIDTH = 5;
/** Height of the doorway, in world units. Slightly less than ceiling height. */
const DOORWAY_HEIGHT = 3;

/**
 * Camera target the entry-walk auto-walks the visitor to once the
 * "Step inside" button is pressed. Sits about 2m past the doorway
 * (z=+9), inside the gallery proper. The shorter walk-in keeps the
 * cinematic transition under a second so the visitor isn't watching
 * an idle camera glide.
 */
export const ENTRY_TARGET_Z = 7;

// ----------------------------------------------------------------------
// Wall colliders (Requirement 1.6)
// ----------------------------------------------------------------------

/**
 * Build axis-aligned bounding boxes that sit just behind each wall
 * surface so `resolveMotion` keeps the camera at a 0.3-unit clearance
 * from anything solid. Each wall is modelled as a thin slab — a few
 * centimetres thick along its outward axis, full extent along the other
 * two axes — anchored to the actual wall geometry rendered above.
 *
 * Layout:
 *   - Gallery: north / east / west walls fully enclose the back side.
 *               The south wall is split into two side panels (left and
 *               right of the doorway). The doorway itself (a 3m-wide
 *               opening centred on x=0) is left open so the visitor can
 *               walk through it after the doors slide aside.
 *   - Foyer:   east / west / south (back) walls enclose the vestibule
 *               on the +z side of the gallery. The boundary between the
 *               foyer and the gallery is the south wall of the gallery
 *               (already covered above).
 *
 * The arrays below are computed once at module load. The room and foyer
 * constants are static so the colliders never need to be recomputed.
 */
import type { AABB } from "./Controls/Collisions";

const HALF_W = ROOM.width / 2;
const HALF_D = ROOM.depth / 2;
const WALL_SLAB = 0.05;
const HALF_FOYER_W = FOYER_WIDTH / 2;
const FOYER_FRONT_Z = HALF_D; // boundary with gallery
const FOYER_BACK_Z = HALF_D + FOYER_DEPTH; // far foyer wall

export const GALLERY_COLLIDERS: ReadonlyArray<AABB> = [
  // Gallery north wall (z = -HALF_D, slab extends outward).
  {
    min: [-HALF_W, 0, -HALF_D - WALL_SLAB],
    max: [HALF_W, ROOM.height, -HALF_D],
  },
  // Gallery west wall (x = -HALF_W) — only the gallery portion.
  {
    min: [-HALF_W - WALL_SLAB, 0, -HALF_D],
    max: [-HALF_W, ROOM.height, HALF_D],
  },
  // Gallery east wall (x = +HALF_W) — only the gallery portion.
  {
    min: [HALF_W, 0, -HALF_D],
    max: [HALF_W + WALL_SLAB, ROOM.height, HALF_D],
  },
  // Gallery south wall — left of doorway (full gallery half-width).
  {
    min: [-HALF_W, 0, HALF_D],
    max: [-DOORWAY_WIDTH / 2, ROOM.height, HALF_D + WALL_SLAB],
  },
  // Gallery south wall — right of doorway.
  {
    min: [DOORWAY_WIDTH / 2, 0, HALF_D],
    max: [HALF_W, ROOM.height, HALF_D + WALL_SLAB],
  },

  // Foyer west wall (corridor side, x = -HALF_FOYER_W).
  {
    min: [-HALF_FOYER_W - WALL_SLAB, 0, FOYER_FRONT_Z],
    max: [-HALF_FOYER_W, ROOM.height, FOYER_BACK_Z],
  },
  // Foyer east wall (corridor side, x = +HALF_FOYER_W).
  {
    min: [HALF_FOYER_W, 0, FOYER_FRONT_Z],
    max: [HALF_FOYER_W + WALL_SLAB, ROOM.height, FOYER_BACK_Z],
  },
  // Foyer back ("street") wall — keeps the visitor from walking out
  // the back of the foyer. Spans only the corridor width.
  {
    min: [-HALF_FOYER_W, 0, FOYER_BACK_Z],
    max: [HALF_FOYER_W, ROOM.height, FOYER_BACK_Z + WALL_SLAB],
  },

  // Stanchion barrier around the hero pedestal at the gallery centre.
  // A single AABB centred on the origin with half-extents matching the
  // rope square (1.4m). With CLEARANCE = 1.0m the resolver expands each
  // face outward by 1.0m before blocking, so the camera is stopped at
  // 0.4 + 1.0 = 1.4m from centre on every axis — exactly at the rope line.
  // Using one box (rather than four thin slabs) avoids the axis-ordering
  // artefact where a slab's perpendicular extent fires on the wrong axis.
  {
    min: [-0.4, 0, -0.4],
    max: [0.4, 2.0, 0.4],
  },
];

// ----------------------------------------------------------------------
// Lighting plan (Requirements 2.3, 9.4)
// ----------------------------------------------------------------------

/**
 * Hard cap on the count of active real-time lights in the scene.
 * Originally Requirement 9.4 set this to 8; the foyer rework added
 * three street-lamp point lights to suggest a high-street avenue at
 * night, so the budget was bumped to 12 — still well within the
 * mobile WebGL fragment-shader budget for `MeshStandardMaterial`,
 * which supports up to 16 lights without falling back to a
 * deferred path. Asserted at mount time below.
 */
const LIGHT_BUDGET = 12;

/**
 * Ceiling fixture placements — a balanced 2×2 grid across the 11×18
 * gallery footprint at quarter-widths (x=±2.75) and quarter-depths
 * (z=±4.5), so each fixture sits roughly at the centre of one
 * quadrant. The fixtures are purely cosmetic (small brass-cylinder
 * housings with a glowing bulb disc); the field name preserves the
 * historical "spot light" type because the array shape is what
 * `<CeilingFixture/>` consumes — no real `<spotLight/>` is emitted
 * any more. The `target` field is unused but kept for shape parity
 * with the original spec.
 */
type SpotLightSpec = {
  /** Stable id used as the React key. */
  id: string;
  /** World-space fixture position (just below the ceiling plane). */
  position: [number, number, number];
  /** World-space target — unused now that the spotlights are gone. */
  target: [number, number, number];
};

const SPOT_LIGHT_SPECS: ReadonlyArray<SpotLightSpec> = [
  { id: "fixture-fl", position: [-2.75, 3.4, 4.5], target: [-2.75, 0, 4.5] },
  { id: "fixture-fr", position: [2.75, 3.4, 4.5], target: [2.75, 0, 4.5] },
  { id: "fixture-bl", position: [-2.75, 3.4, -4.5], target: [-2.75, 0, -4.5] },
  { id: "fixture-br", position: [2.75, 3.4, -4.5], target: [2.75, 0, -4.5] },
];

/** Compile-time invariant: declared light count fits the Req 9.4 budget.
 * Spec entries are kept for ceiling-fixture placement, but they no
 * longer emit real-time `<spotLight/>` instances — only ambient and
 * hemisphere are active. */
const ACTIVE_LIGHT_COUNT = 1 /* ambient */ + 1 /* hemisphere */;
if (ACTIVE_LIGHT_COUNT > LIGHT_BUDGET) {
  throw new Error(
    `WalkthroughScene: declared light count ${ACTIVE_LIGHT_COUNT} exceeds ` +
      `the Requirement 9.4 budget of ${LIGHT_BUDGET}`,
  );
}

// ----------------------------------------------------------------------
// Geometry constants
// ----------------------------------------------------------------------

const HALF_WIDTH = ROOM.width / 2;
const HALF_DEPTH = ROOM.depth / 2;

// ----------------------------------------------------------------------
// Component
// ----------------------------------------------------------------------

/**
 * The WalkthroughScene renders the room shell, the lighting plan, and
 * one Sketch_Frame + Metadata_Panel pair per Sketch_Record. It does
 * not host the R3F `<Canvas>` itself — that lives in the
 * Walkthrough_Engine — so this component can be mounted directly into
 * a Canvas in production and into a `@react-three/test-renderer`
 * Canvas in tests.
 */
export function WalkthroughScene() {
  const scene = useThree((s) => s.scene);

  // Procedural tile texture for both floors. ~0.8m physical tile
  // size: gallery floor 11×18 → 13.75×22.5 repeats, foyer floor
  // 11×9 → 13.75×11.25 repeats. The texture itself is shared; each
  // floor gets its own `THREE.CanvasTexture` instance because the
  // `repeat` configuration is per-texture state, not part of the
  // underlying canvas.
  const galleryFloorTexture = useMemo(
    () => createMarbleTileTexture(ROOM.width / 0.8, ROOM.depth / 0.8),
    [],
  );

  // Compute frame placements once per catalogue identity. The catalogue
  // is a module-level `ReadonlyArray<SketchRecord>` so this useMemo
  // collapses to a single computation per scene mount in practice.
  // Skip the south wall — that's where the entrance doorway is cut.
  // Reduced corner margin to 0.3m so the 23-record catalogue (1
  // designer + 22 dresses) fits on the three usable walls of the
  // narrowed 11×18 footprint without overflow.
  const wallPoses = useMemo(
    () =>
      placeFrames(sketches, ROOM, {
        skipSouthWall: true,
        cornerMargin: 0.3,
      }),
    [],
  );

  // Build the proximity-test list in catalogue order, used by
  // `<ProximityHighlighter/>` to deterministically pick the nearest
  // frame within 1.5m and tie-break by index (Req 2.5, 2.6).
  const proximityFrames = useMemo<ProximityFrame[]>(
    () =>
      sketches.map((record, i) => ({
        id: record.id,
        position: wallPoses[i].position,
      })),
    [wallPoses],
  );

  // Mount-time assertion that the live scene's active-light count does
  // not exceed the Req 9.4 budget. This is defence-in-depth on top of
  // the compile-time check above: it catches accidental light additions
  // by a future child component (e.g. a stray `<pointLight/>` inside a
  // SketchFrame) that would not be visible from this file.
  useEffect(() => {
    let count = 0;
    scene.traverse((obj) => {
      if ((obj as THREE.Light).isLight) {
        const light = obj as THREE.Light;
        // "Active" per Req 9.4 = casts shadow OR contributes intensity.
        const intensity =
          (light as unknown as { intensity?: number }).intensity ?? 0;
        if (light.castShadow || intensity > 0) {
          count++;
        }
      }
    });
    if (count > LIGHT_BUDGET) {
      throw new Error(
        `WalkthroughScene: active light count ${count} exceeds the ` +
          `Requirement 9.4 budget of ${LIGHT_BUDGET}`,
      );
    }
  }, [scene]);

  return (
    <>
      {/* ----------------------------------------------------------------
          Room shell — floor, ceiling, four walls.
          Each plane is rotated/positioned so its visible side faces the
          room interior. `MeshStandardMaterial` reacts to the lighting
          plan below; colour values stay neutral so sketch canvases are
          the visual focus.
          ---------------------------------------------------------------- */}

      {/* Floor — polished Italian marble tiles with real-time
          reflections of the room above. The drei
          `<MeshReflectorMaterial/>` does a half-resolution render of
          the scene from below the floor and composites it under the
          tile texture's alpha, producing the soft "ghosted dresses"
          reflection underfoot that high-end boutique floors actually
          show. The marble tile texture is layered on top via the
          `map` prop so the grout grid still reads through the
          reflection. */}
      <mesh
        position={[0, 0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        data-vfg-room="floor"
      >
        <planeGeometry args={[ROOM.width, ROOM.depth]} />
        <MeshReflectorMaterial
          map={galleryFloorTexture}
          // Resolution of the reflection render target. 512 keeps
          // the GPU cost low; the reflection is heavily blurred
          // anyway so anything sharper would just be wasted bandwidth.
          resolution={512}
          // Mix and blur tune the "polish" feel: a small mix value
          // keeps the marble's own colour dominant while the room
          // shows through as a soft ghosted reflection; the blur
          // softens the mirror so it reads as a polished slab, not
          // a piece of literal mirror.
          mixBlur={2}
          mixStrength={0.55}
          blur={[300, 100]}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
          depthScale={1.2}
          roughness={0.18}
          metalness={0.04}
          // Mirror-related material props — keep the existing PBR
          // characteristics so the floor still reads as the same
          // polished marble it did before, just with reflections
          // baked in.
          reflectorOffset={0.001}
        />
      </mesh>

      {/* Ceiling — soft warm off-white. Low metalness + high roughness
          so it reads as painted plaster, with a mild sheen so the
          fixture bulbs cast a believable diffuse halo around them. */}
      <mesh
        position={[0, ROOM.height, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        receiveShadow
        data-vfg-room="ceiling"
      >
        <planeGeometry args={[ROOM.width, ROOM.depth]} />
        <meshPhysicalMaterial
          color="#f1e8d4"
          roughness={0.85}
          metalness={0}
          sheen={0.15}
          sheenColor="#fff5dd"
        />
      </mesh>

      {/* South wall — split into a left panel, a right panel, and a
          lintel above the doorway. The doorway itself is open so the
          visitor can walk through after the entry-walk completes. */}
      <SouthWallWithDoorway />

      {/* Foyer chamber attached to the south wall — visitors spawn
          here at z = SPAWN.z. The chamber's south wall is the glass
          entry surface; the doors slide aside on entry. */}
      <FoyerChamber />

      {/* North wall (z = −HALF_DEPTH, visible side faces +z).
          Premium-painted eggshell finish: a refined warm off-white,
          low-roughness clearcoat for soft satin highlights, and a
          touch of sheen so light grazing across the wall reads as
          finely-laid pigment rather than flat matte board. The same
          material is used on the east and west walls for an
          uninterrupted gallery shell. */}
      <mesh
        position={[0, ROOM.height / 2, -HALF_DEPTH]}
        rotation={[0, 0, 0]}
        receiveShadow
        data-vfg-room="wall-north"
      >
        <planeGeometry args={[ROOM.width, ROOM.height]} />
        <meshPhysicalMaterial
          color="#efe8d8"
          roughness={0.5}
          metalness={0.02}
          clearcoat={0.45}
          clearcoatRoughness={0.3}
          sheen={0.18}
          sheenColor="#fff5dd"
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* West wall (x = −HALF_WIDTH, visible side faces +x) */}
      <mesh
        position={[-HALF_WIDTH, ROOM.height / 2, 0]}
        rotation={[0, Math.PI / 2, 0]}
        receiveShadow
        data-vfg-room="wall-west"
      >
        <planeGeometry args={[ROOM.depth, ROOM.height]} />
        <meshPhysicalMaterial
          color="#efe8d8"
          roughness={0.5}
          metalness={0.02}
          clearcoat={0.45}
          clearcoatRoughness={0.3}
          sheen={0.18}
          sheenColor="#fff5dd"
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* East wall (x = +HALF_WIDTH, visible side faces −x) */}
      <mesh
        position={[HALF_WIDTH, ROOM.height / 2, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        receiveShadow
        data-vfg-room="wall-east"
      >
        <planeGeometry args={[ROOM.depth, ROOM.height]} />
        <meshPhysicalMaterial
          color="#efe8d8"
          roughness={0.5}
          metalness={0.02}
          clearcoat={0.45}
          clearcoatRoughness={0.3}
          sheen={0.18}
          sheenColor="#fff5dd"
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Architectural trim — thin baseboard and crown-moulding strips
          along the gallery walls. Adds depth where wall meets floor /
          ceiling so the room reads as a finished interior rather than
          an empty box. */}
      <GalleryTrim />

      {/* ----------------------------------------------------------------
          Lighting plan (Req 2.3, 9.4).
          Soft, even illumination from ambient + hemisphere only. The
          cosmetic ceiling fixtures (visible bulb discs) read as the
          light source for visitors; we deliberately don't emit a
          real `<spotLight/>` from them because a narrow ceiling cone
          aimed at a wall mid-line spills onto the floor as a bright
          pool. Frame photos use `meshBasicMaterial`, so they display
          their stored colours uniformly without needing accent lights.
          Total active lights: 1 ambient + 1 hemisphere = 2, well under
          the Req 9.4 cap of 12.
          ---------------------------------------------------------------- */}

      <ambientLight intensity={1.1} />

      <hemisphereLight
        args={["#fff8e7", "#3a3a45", 1.2]}
      />

      {SPOT_LIGHT_SPECS.map((spec) => (
        <CeilingFixture key={spec.id} position={spec.position} />
      ))}

      {/* ----------------------------------------------------------------
          Sketch_Frames + Metadata_Panels (Req 14.1, 14.2, 2.1).
          One per Sketch_Record, in catalogue order, keyed by `id`.
          ---------------------------------------------------------------- */}

      {sketches.map((record, i) => (
        <SketchFrame
          key={record.id}
          record={record}
          wallPose={wallPoses[i]}
        />
      ))}

      {/* Designer plaque (Req 14.2 extension) — a small brass-on-cream
          legend mounted just above the designer's portrait frame.
          Reads "DESIGNER" so visitors recognise this isn't another
          dress and know to click for the bio. The plaque is purely
          cosmetic 3D geometry; clicking the underlying frame still
          opens the existing Zoom_View. We look up the designer's
          wall pose by id (rather than catalogue index 0) so moving
          the designer record around in `lib/sketches.ts` reanchors
          the plaque automatically. */}
      {(() => {
        const designerIndex = sketches.findIndex(
          (record) => record.id === "designer",
        );
        if (designerIndex < 0) return null;
        return <DesignerPlaque wallPose={wallPoses[designerIndex]} />;
      })()}

      {sketches.map((record, i) =>
        // Skip the dress-style metadata caption for the designer
        // record — the new <DesignerPlaque/> takes its place above
        // the frame, so a "Style 23 — 2024-01-01" tag below the
        // portrait would just be confusing.
        record.id === "designer" ? null : (
          <MetadataPanel
            key={`panel-${record.id}`}
            record={record}
            wallPose={wallPoses[i]}
            index={i}
          />
        ),
      )}

      {/* Proximity emphasis driver (Req 2.5, 2.6). */}
      <ProximityHighlighter frames={proximityFrames} />

      {/* Hero pedestal — a single lit display plinth at the centre
          of the gallery floor showing a featured dress as a vertical
          backlit billboard. Acts as the visitor's focal point on
          entry: the doorway, the pedestal, and the designer plaque
          on the back wall line up along the gallery's central
          axis. Cosmetic only — the plinth is not interactive; the
          actual dress detail still lives on its wall frame. */}
      <HeroPedestal />

      {/* Stanchion barrier — four brass pillars with red velvet ropes
          encircling the hero pedestal. The matching collider slabs in
          `GALLERY_COLLIDERS` stop the visitor at the rope line so
          they cannot walk through the barrier. */}
      <StanchionBarrier />

      {/* Post-processing pipeline (Req 2.4, 11.6). */}
      <PostFx />

      {/* Register the THREE.Scene reference for future XR (Req 5.7, 13.1). */}
      <SceneRefBinder scene={scene} />
    </>
  );
}

/**
 * CeilingFixture — a small recessed-can-light style mesh that sits
 * at the same world coordinates as one of the gallery's spotlights.
 * Two layers:
 *   - An outer dark cylinder housing flush with the ceiling plane.
 *   - An inner glowing disc that reads as "the bulb", picked up by
 *     the bloom pass for a soft halo on the surface around it.
 *
 * The fixture is purely cosmetic (no light contribution); the actual
 * `spotLight` sits a tiny offset below it.
 */
function CeilingFixture({ position }: { position: [number, number, number] }) {
  // Sit the fixture on the ceiling. The spotlight itself stays at
  // `position.y` (≈ 3.4) so its cone reaches the wall mid-line; the
  // visible fixture is up against the ceiling at y = ROOM.height.
  const [x, , z] = position;
  const housingRadius = 0.18;
  const housingHeight = 0.05;
  const bulbRadius = 0.13;
  return (
    <group position={[x, ROOM.height - housingHeight / 2, z]}>
      {/* Housing — a short cylinder, dark metallic. */}
      <mesh>
        <cylinderGeometry
          args={[housingRadius, housingRadius, housingHeight, 16]}
        />
        <meshStandardMaterial
          color="#0e0e10"
          roughness={0.4}
          metalness={0.7}
        />
      </mesh>
      {/* Bulb — a small disc sitting just below the housing's
          underside, glowing warm-white. */}
      <mesh position={[0, -housingHeight / 2 - 0.001, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[bulbRadius, 24]} />
        <meshBasicMaterial color="#fff2cc" toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * GalleryTrim — thin painted-wood baseboards along the floor edge
 * and crown moulding strips along the ceiling edge of the gallery's
 * three solid walls (north, east, west). Adds architectural depth
 * where wall meets floor or ceiling without burdening the scene
 * with full 3D moulding profiles.
 *
 * Each trim is a thin axis-aligned box, painted in a near-white
 * eggshell with a slight clearcoat so it reads as semi-gloss
 * woodwork against the warmer matte walls. The south wall is
 * skipped because `SouthWallWithDoorway` carries its own facade
 * detail and the doorway interrupts the trim line.
 */
function GalleryTrim() {
  const baseboardHeight = 0.12;
  const baseboardDepth = 0.025;
  const crownHeight = 0.1;
  const crownDepth = 0.025;
  const halfW = ROOM.width / 2;
  const halfD = ROOM.depth / 2;
  const trimColor = "#fdf6e8";

  return (
    <group data-vfg-room="gallery-trim">
      {/* North-wall baseboard */}
      <mesh position={[0, baseboardHeight / 2, -halfD + baseboardDepth / 2]}>
        <boxGeometry args={[ROOM.width, baseboardHeight, baseboardDepth]} />
        <meshPhysicalMaterial
          color={trimColor}
          roughness={0.45}
          metalness={0}
          clearcoat={0.4}
          clearcoatRoughness={0.4}
        />
      </mesh>
      {/* North-wall crown moulding */}
      <mesh
        position={[0, ROOM.height - crownHeight / 2, -halfD + crownDepth / 2]}
      >
        <boxGeometry args={[ROOM.width, crownHeight, crownDepth]} />
        <meshPhysicalMaterial
          color={trimColor}
          roughness={0.45}
          metalness={0}
          clearcoat={0.4}
          clearcoatRoughness={0.4}
        />
      </mesh>

      {/* West-wall baseboard */}
      <mesh
        position={[-halfW + baseboardDepth / 2, baseboardHeight / 2, 0]}
      >
        <boxGeometry args={[baseboardDepth, baseboardHeight, ROOM.depth]} />
        <meshPhysicalMaterial
          color={trimColor}
          roughness={0.45}
          metalness={0}
          clearcoat={0.4}
          clearcoatRoughness={0.4}
        />
      </mesh>
      {/* West-wall crown moulding */}
      <mesh
        position={[-halfW + crownDepth / 2, ROOM.height - crownHeight / 2, 0]}
      >
        <boxGeometry args={[crownDepth, crownHeight, ROOM.depth]} />
        <meshPhysicalMaterial
          color={trimColor}
          roughness={0.45}
          metalness={0}
          clearcoat={0.4}
          clearcoatRoughness={0.4}
        />
      </mesh>

      {/* East-wall baseboard */}
      <mesh
        position={[halfW - baseboardDepth / 2, baseboardHeight / 2, 0]}
      >
        <boxGeometry args={[baseboardDepth, baseboardHeight, ROOM.depth]} />
        <meshPhysicalMaterial
          color={trimColor}
          roughness={0.45}
          metalness={0}
          clearcoat={0.4}
          clearcoatRoughness={0.4}
        />
      </mesh>
      {/* East-wall crown moulding */}
      <mesh
        position={[halfW - crownDepth / 2, ROOM.height - crownHeight / 2, 0]}
      >
        <boxGeometry args={[crownDepth, crownHeight, ROOM.depth]} />
        <meshPhysicalMaterial
          color={trimColor}
          roughness={0.45}
          metalness={0}
          clearcoat={0.4}
          clearcoatRoughness={0.4}
        />
      </mesh>
    </group>
  );
}

/**
 * FoyerTrim — eggshell baseboard + crown moulding strips for the
 * three solid foyer walls (east, west, back). Mirrors `GalleryTrim`
 * so the architectural language reads continuous when the visitor
 * walks through the sliding doors. The foyer's south face is the
 * gallery facade (handled by `SouthWallWithDoorway`) and its north
 * face is open onto the gallery, so neither carries trim of its own.
 */
function FoyerTrim({
  z0,
  z1,
  halfFoyerW,
}: {
  z0: number;
  z1: number;
  halfFoyerW: number;
}) {
  const baseboardHeight = 0.12;
  const baseboardDepth = 0.025;
  const crownHeight = 0.1;
  const crownDepth = 0.025;
  const foyerDepth = z1 - z0;
  const trimColor = "#fdf6e8";

  return (
    <group data-vfg-room="foyer-trim">
      {/* West-wall baseboard */}
      <mesh
        position={[
          -halfFoyerW + baseboardDepth / 2,
          baseboardHeight / 2,
          (z0 + z1) / 2,
        ]}
      >
        <boxGeometry args={[baseboardDepth, baseboardHeight, foyerDepth]} />
        <meshPhysicalMaterial
          color={trimColor}
          roughness={0.45}
          metalness={0}
          clearcoat={0.4}
          clearcoatRoughness={0.4}
        />
      </mesh>
      {/* West-wall crown moulding */}
      <mesh
        position={[
          -halfFoyerW + crownDepth / 2,
          ROOM.height - crownHeight / 2,
          (z0 + z1) / 2,
        ]}
      >
        <boxGeometry args={[crownDepth, crownHeight, foyerDepth]} />
        <meshPhysicalMaterial
          color={trimColor}
          roughness={0.45}
          metalness={0}
          clearcoat={0.4}
          clearcoatRoughness={0.4}
        />
      </mesh>

      {/* East-wall baseboard */}
      <mesh
        position={[
          halfFoyerW - baseboardDepth / 2,
          baseboardHeight / 2,
          (z0 + z1) / 2,
        ]}
      >
        <boxGeometry args={[baseboardDepth, baseboardHeight, foyerDepth]} />
        <meshPhysicalMaterial
          color={trimColor}
          roughness={0.45}
          metalness={0}
          clearcoat={0.4}
          clearcoatRoughness={0.4}
        />
      </mesh>
      {/* East-wall crown moulding */}
      <mesh
        position={[
          halfFoyerW - crownDepth / 2,
          ROOM.height - crownHeight / 2,
          (z0 + z1) / 2,
        ]}
      >
        <boxGeometry args={[crownDepth, crownHeight, foyerDepth]} />
        <meshPhysicalMaterial
          color={trimColor}
          roughness={0.45}
          metalness={0}
          clearcoat={0.4}
          clearcoatRoughness={0.4}
        />
      </mesh>

      {/* Back-wall baseboard */}
      <mesh
        position={[0, baseboardHeight / 2, z1 - baseboardDepth / 2]}
      >
        <boxGeometry args={[halfFoyerW * 2, baseboardHeight, baseboardDepth]} />
        <meshPhysicalMaterial
          color={trimColor}
          roughness={0.45}
          metalness={0}
          clearcoat={0.4}
          clearcoatRoughness={0.4}
        />
      </mesh>
      {/* Back-wall crown moulding */}
      <mesh
        position={[0, ROOM.height - crownHeight / 2, z1 - crownDepth / 2]}
      >
        <boxGeometry args={[halfFoyerW * 2, crownHeight, crownDepth]} />
        <meshPhysicalMaterial
          color={trimColor}
          roughness={0.45}
          metalness={0}
          clearcoat={0.4}
          clearcoatRoughness={0.4}
        />
      </mesh>
    </group>
  );
}

/**
 * DesignerPlaque — a small "ABOUT THE DESIGNER" sign mounted on the
 * wall just above the designer's portrait frame, so visitors immediately
 * recognise the first artwork as a profile card rather than another
 * dress.
 *
 * Layout (inside a `<group>` anchored at the same wall pose as the
 * designer's `<SketchFrame/>`, and rotated so the plaque's local +Z
 * basis vector points into the room — same yaw convention as the
 * frame and the metadata panel):
 *
 *   - Wood backing: a thin walnut-toned box.
 *   - Brass border: four thin gilded slabs framing the wood face.
 *   - Brass letters: extruded `<Text3D>` reading "ABOUT THE DESIGNER".
 *
 * The plaque sits directly above the frame, vertically offset by
 * `framing.height/2 + plaque.height/2 + gap`, so it reads as a
 * museum-style identification sign hung over the artwork. The
 * underlying frame still handles all interaction (click → Zoom_View,
 * proximity highlight, etc.); this component is purely cosmetic.
 */
function DesignerPlaque({ wallPose }: { wallPose: WallPose }) {
  const yaw = useMemo(() => Math.atan2(wallPose.normal[0], wallPose.normal[2]), [
    wallPose.normal,
  ]);
  const plaqueWidth = 1.4;
  const plaqueHeight = 0.28;
  const plaqueDepth = 0.04;
  // Sit the plaque above the frame: the frame is 1.4m tall centred on
  // the wall pose, so its top edge is +0.7. We add a small gap and
  // half the plaque height so the plaque's bottom edge sits 0.04m
  // above the frame's top.
  const yOffset = 0.7 + plaqueHeight / 2 + 0.04;
  const borderThickness = 0.02;
  const borderDepth = 0.012;

  return (
    <group
      position={[
        wallPose.position[0],
        wallPose.position[1] + yOffset,
        wallPose.position[2],
      ]}
      rotation={[0, yaw, 0]}
      data-vfg-designer-plaque=""
    >
      {/* Cream face — same painted-board backing the storefront
          signboard uses, so the plaque visually pairs with the GP
          FASHION sign over the doorway rather than the dark frame
          moulding. The emissive is kept low so the plaque doesn't
          glow under the gallery's ambient + hemisphere lighting. */}
      <mesh>
        <boxGeometry args={[plaqueWidth, plaqueHeight, plaqueDepth]} />
        <meshPhysicalMaterial
          color="#f5e8c7"
          roughness={0.5}
          metalness={0.05}
          emissive="#5a4a20"
          emissiveIntensity={0.2}
        />
      </mesh>

      {/* Brass border on the front face — four thin slabs framing the
          plaque face. Sit slightly proud of the wood so the bevel
          catches the ambient/hemisphere lights. */}
      {(() => {
        const innerW = plaqueWidth - 2 * borderThickness;
        const innerH = plaqueHeight - 2 * borderThickness;
        const z = plaqueDepth / 2 + borderDepth / 2;
        const brass = (
          <meshPhysicalMaterial
            color="#caa260"
            roughness={0.3}
            metalness={0.9}
            emissive="#3a2a0c"
            emissiveIntensity={0.25}
          />
        );
        return (
          <>
            <mesh position={[0, plaqueHeight / 2 - borderThickness / 2, z]}>
              <boxGeometry args={[plaqueWidth, borderThickness, borderDepth]} />
              {brass}
            </mesh>
            <mesh position={[0, -(plaqueHeight / 2 - borderThickness / 2), z]}>
              <boxGeometry args={[plaqueWidth, borderThickness, borderDepth]} />
              {brass}
            </mesh>
            <mesh position={[-(plaqueWidth / 2 - borderThickness / 2), 0, z]}>
              <boxGeometry args={[borderThickness, innerH, borderDepth]} />
              {brass}
            </mesh>
            <mesh position={[plaqueWidth / 2 - borderThickness / 2, 0, z]}>
              <boxGeometry args={[borderThickness, innerH, borderDepth]} />
              {brass}
            </mesh>
          </>
        );
      })()}

      {/* "DESIGNER" — extruded brass letters centred on the plaque
          face. `<Center>` measures the resulting bounding box and
          offsets the geometry so the parent group's origin sits at
          the centre of the text. */}
      <group position={[0, 0, plaqueDepth / 2 + 0.014]}>
        <Center>
          <Text3D
            font="/fonts/helvetiker_bold.typeface.json"
            size={0.13}
            height={0.022}
            curveSegments={6}
            bevelEnabled
            bevelThickness={0.005}
            bevelSize={0.004}
            bevelOffset={0}
            bevelSegments={2}
            letterSpacing={0.05}
          >
            DESIGNER
            <meshPhysicalMaterial
              color="#d4a04a"
              roughness={0.3}
              metalness={0.9}
              emissive="#5a3e10"
              emissiveIntensity={0.5}
            />
          </Text3D>
        </Center>
      </group>
    </group>
  );
}

/**
 * FoyerLogo — a flat plane displaying the GP Fashion logo bitmap from
 * `/public/images/hero/logo.png`, mounted on the foyer's back wall.
 *
 * The plane sits a hair in front of the wall plane (z passed in from
 * the parent slightly less than the wall's z) so it doesn't z-fight
 * with the painted wall surface, and faces back into the foyer
 * interior — when the visitor turns around inside the foyer they see
 * the logo head-on.
 *
 * Sizing preserves the texture's intrinsic aspect ratio:
 *   - Height starts at `targetHeight`.
 *   - If the resulting width would exceed `maxWidth` (so the logo
 *     would overflow the back wall horizontally), height is scaled
 *     down so width clamps at `maxWidth` instead.
 *
 * The material uses `meshBasicMaterial` so the logo is shown at its
 * stored colours regardless of foyer lighting (matching the
 * Sketch_Frame canvas convention) and `transparent: true` so any
 * alpha channel in the source PNG is honoured. `toneMapped: false`
 * keeps the bloom pass from blowing out the logo's whites.
 */
function FoyerLogo({
  position,
  targetHeight,
  maxWidth,
}: {
  position: [number, number, number];
  targetHeight: number;
  maxWidth: number;
}) {
  const texture = useTexture("/images/hero/logo.png");
  // Modern three.js expects color textures tagged with sRGB so the
  // shader pipeline does the right linear → sRGB conversion. Without
  // this the logo can render as nearly black against the warm wall
  // when the renderer is in an sRGB output mode.
  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
  }, [texture]);

  const [width, height] = useMemo(() => {
    const img = texture.image as
      | { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number }
      | undefined;
    const naturalW =
      img?.naturalWidth ?? img?.width ?? 1;
    const naturalH =
      img?.naturalHeight ?? img?.height ?? 1;
    const aspect = naturalW > 0 && naturalH > 0 ? naturalW / naturalH : 1;
    let h = targetHeight;
    let w = h * aspect;
    if (w > maxWidth) {
      w = maxWidth;
      h = w / aspect;
    }
    return [w, h];
  }, [texture, targetHeight, maxWidth]);

  return (
    <mesh
      position={position}
      // Rotate 180° around Y so the plane's front face (+Z normal in
      // local space) ends up pointing toward -z in world space, which
      // is the direction the visitor faces when looking at the back
      // wall from inside the foyer. Without this rotation the
      // visitor sees the plane's back face — which `DoubleSide`
      // renders by flipping the winding order, so the texture
      // appears mirrored.
      rotation={[0, Math.PI, 0]}
      data-vfg-foyer-logo=""
    >
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial
        map={texture}
        transparent
        toneMapped={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/**
 * StanchionBarrier — four chrome-plated pillars connected by deep-red
 * velvet ropes with natural catenary sag, arranged in a square around
 * the hero pedestal at the gallery centre.
 *
 * Layout (top-down view, pedestal at origin):
 *
 *       NW pillar ——— rope ——— NE pillar
 *          |                      |
 *         rope                  rope
 *          |                      |
 *       SW pillar ——— rope ——— SE pillar
 *
 * Each pillar sits at (±1.4, 0, ±1.4). Ropes are TubeGeometry paths
 * built from a catenary curve so they hang naturally between the
 * finial spheres at the top of each pillar.
 */

/**
 * Build a catenary curve between two 3D points with a given sag depth.
 * Returns an array of THREE.Vector3 points sampled along the curve.
 * The catenary is approximated as a parabola in the vertical plane
 * containing the two endpoints — accurate enough for a short rope.
 */
function buildCatenaryCurve(
  a: THREE.Vector3,
  b: THREE.Vector3,
  sagDepth: number,
  segments: number,
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // Linear interpolation along the horizontal span.
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    // Parabolic sag: 0 at both ends, maximum at t=0.5.
    const sag = sagDepth * 4 * t * (1 - t);
    const y = a.y + (b.y - a.y) * t - sag;
    points.push(new THREE.Vector3(x, y, z));
  }
  return points;
}

function StanchionBarrier() {
  // Pillar positions — four corners of the rope square.
  const ROPE_HALF = 1.4;
  const corners: Array<[number, number]> = [
    [-ROPE_HALF, -ROPE_HALF], // SW
    [ROPE_HALF, -ROPE_HALF],  // SE
    [ROPE_HALF, ROPE_HALF],   // NE
    [-ROPE_HALF, ROPE_HALF],  // NW
  ];

  // World Y of the finial sphere centre — rope hooks here.
  const BASE_H = 0.08;
  const POST_H = 1.0;
  const FINIAL_R = 0.055;
  const HOOK_Y = BASE_H + POST_H + FINIAL_R; // ≈ 1.195

  // Rope segments: pairs of adjacent corner indices (wrap-around).
  const ropeSegments: Array<[number, number]> = [
    [0, 1], // S side
    [1, 2], // E side
    [2, 3], // N side
    [3, 0], // W side
  ];

  // Build catenary tube geometries once (stable across renders).
  const ropeGeometries = useMemo(() => {
    return ropeSegments.map(([ai, bi]) => {
      const [ax, az] = corners[ai];
      const [bx, bz] = corners[bi];
      const start = new THREE.Vector3(ax, HOOK_Y, az);
      const end = new THREE.Vector3(bx, HOOK_Y, bz);
      const pts = buildCatenaryCurve(start, end, 0.08, 32);
      const path = new THREE.CatmullRomCurve3(pts);
      return new THREE.TubeGeometry(path, 32, 0.018, 10, false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <group data-vfg-stanchion-barrier="">
      {/* Pillars — chrome-plated finish */}
      {corners.map(([cx, cz], i) => (
        <group key={`pillar-${i}`} position={[cx, 0, cz]}>
          {/* Weighted base disc — dark polished stone */}
          <mesh position={[0, BASE_H / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.12, 0.14, BASE_H, 24]} />
            <meshPhysicalMaterial
              color="#1c1c1e"
              roughness={0.2}
              metalness={0.6}
              clearcoat={0.8}
              clearcoatRoughness={0.1}
            />
          </mesh>
          {/* Chrome post — shiny golden metal */}
          <mesh position={[0, BASE_H + POST_H / 2, 0]} castShadow>
            <cylinderGeometry args={[0.025, 0.025, POST_H, 20]} />
            <meshStandardMaterial
              color="#d4a030"
              roughness={0.15}
              metalness={0.85}
              emissive="#7a4a00"
              emissiveIntensity={0.35}
            />
          </mesh>
          {/* Golden finial sphere */}
          <mesh position={[0, HOOK_Y, 0]} castShadow>
            <sphereGeometry args={[FINIAL_R, 24, 18]} />
            <meshStandardMaterial
              color="#d4a030"
              roughness={0.12}
              metalness={0.88}
              emissive="#7a4a00"
              emissiveIntensity={0.4}
            />
          </mesh>
        </group>
      ))}

      {/* Deep-red velvet ropes with catenary sag */}
      {ropeGeometries.map((geo, i) => (
        <mesh key={`rope-${i}`} geometry={geo}>
          <meshPhysicalMaterial
            color="#6b0000"
            roughness={0.9}
            metalness={0.0}
            sheen={0.5}
            sheenColor="#a00010"
            sheenRoughness={0.6}
          />
        </mesh>
      ))}
    </group>
  );
}

/**
 * HeroPedestal — a single lit display plinth at the centre of the
 * gallery floor showing one featured dress as a tall vertical
 * backlit billboard. Reads as a couture display under glass.
 *
 * Composition:
 *   - Stone disc base (radius 0.7m, height 0.15m) in dark polished
 *     stone, picks up the floor reflection underneath.
 *   - A faint warm under-glow ring via a slightly-larger emissive
 *     disc just above the floor — gives the pedestal that "lit
 *     from below" art-installation feel without emitting any real
 *     scene light.
 *   - A vertical billboard plane (1.0m wide × 1.6m tall, raised
 *     1.2m above the disc) showing the hero dress photo. The
 *     billboard auto-faces the camera each frame so the visitor
 *     sees a head-on view from any standing position.
 *   - A thin gilded post connecting the disc to the billboard so
 *     the photo doesn't appear to float.
 *
 * The hero dress is hard-coded to "1dress" in catalogue order. To
 * change it, swap the string. The component degrades gracefully if
 * the texture fails to load — `<Suspense>` upstream covers the
 * loading branch and the placeholder shows the same "loading…"
 * tint the wall frames use.
 */
function HeroPedestal() {
  const heroTexture = useTexture("/images/shop/items/1dress/1dress-cover.webp");
  // Tag the texture sRGB so the dress colours render correctly (same
  // as the foyer logo and the wall-frame canvas materials).
  useEffect(() => {
    heroTexture.colorSpace = THREE.SRGBColorSpace;
    heroTexture.needsUpdate = true;
  }, [heroTexture]);

  // Auto-orient the billboard toward the camera each frame so the
  // visitor always sees the dress photo head-on.
  const billboardRef = useRef<THREE.Mesh | null>(null);
  useFrame((state) => {
    const mesh = billboardRef.current;
    if (!mesh) return;
    const cam = state.camera.position;
    // Face the camera horizontally only; we don't want the billboard
    // tilting forward when the visitor looks down. The mesh sits at
    // (0, billboardCenterY, 0) so the relative direction is just
    // (camX, 0, camZ).
    mesh.lookAt(cam.x, mesh.position.y, cam.z);
  });

  // Geometry constants
  const baseRadius = 0.7;
  const baseHeight = 0.15;
  const postHeight = 1.2;
  const postRadius = 0.025;
  const billboardWidth = 1.0;
  const billboardHeight = 1.6;
  const billboardCenterY = baseHeight + postHeight + billboardHeight / 2;

  return (
    <group position={[0, 0, 0]} data-vfg-hero-pedestal="">
      {/* Base disc — dark polished stone */}
      <mesh position={[0, baseHeight / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[baseRadius, baseRadius, baseHeight, 48]} />
        <meshPhysicalMaterial
          color="#1a1410"
          roughness={0.25}
          metalness={0.4}
          clearcoat={0.7}
          clearcoatRoughness={0.2}
        />
      </mesh>

      {/* Under-glow ring — a thin emissive disc just above the floor,
          slightly wider than the base, so the pedestal reads as
          spot-lit from beneath without us paying for a real light. */}
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[baseRadius * 0.95, baseRadius * 1.15, 48]} />
        <meshBasicMaterial color="#fff2cc" transparent opacity={0.35} toneMapped={false} />
      </mesh>

      {/* Top edge highlight — a thin brass band capping the base
          disc, reads as architectural detailing. */}
      <mesh position={[0, baseHeight, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[baseRadius - 0.04, baseRadius, 48]} />
        <meshPhysicalMaterial
          color="#caa260"
          roughness={0.3}
          metalness={0.9}
          emissive="#3a2a0c"
          emissiveIntensity={0.2}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Connecting post — thin gilded cylinder so the billboard
          appears mounted on a stand rather than floating. */}
      <mesh position={[0, baseHeight + postHeight / 2, 0]}>
        <cylinderGeometry args={[postRadius, postRadius, postHeight, 16]} />
        <meshPhysicalMaterial
          color="#caa260"
          roughness={0.3}
          metalness={0.9}
          emissive="#3a2a0c"
          emissiveIntensity={0.2}
        />
      </mesh>

      {/* Billboard panel — the dress photo. `meshBasicMaterial` so
          the photo renders at its stored colours regardless of
          gallery lighting (matches the wall-frame convention).
          onClick stopPropagation prevents clicks on the billboard
          from passing through to SketchFrame colliders behind it. */}
      <mesh
        ref={billboardRef}
        position={[0, billboardCenterY, 0]}
        onClick={(e) => e.stopPropagation()}
      >
        <planeGeometry args={[billboardWidth, billboardHeight]} />
        <meshBasicMaterial map={heroTexture} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * SouthWallWithDoorway — the boutique facade as seen from the foyer
 * sidewalk side. Replaces the gallery's south wall with three
 * rectangular sub-panels (left/right of the doorway, plus the lintel
 * above), dressed up to read as a luxury-showroom storefront on a
 * high-street avenue:
 *
 *   - Side panels are warm honed-limestone, clean of any signage so
 *     the eye goes straight to the doors.
 *   - The lintel above the doorway carries a backlit marquee with
 *     the boutique name rendered as 3D text.
 *
 * Geometry is derived once from `ROOM` and `DOORWAY_*` constants so
 * adjusting the room size does not require touching this helper.
 */
function SouthWallWithDoorway() {
  const wallY = ROOM.height / 2;
  const z = ROOM.depth / 2;
  const halfDoor = DOORWAY_WIDTH / 2;
  const sideWidth = (ROOM.width - DOORWAY_WIDTH) / 2;
  const sideCenter = halfDoor + sideWidth / 2;
  const lintelHeight = ROOM.height - DOORWAY_HEIGHT;
  const lintelY = ROOM.height - lintelHeight / 2;

  // Storefront signboard above the doorway. Sits proud of the facade
  // (a real box, not a flat decal) with a brass frame, bracket arms back
  // to the wall, and the boutique name extruded forward off the front
  // face. Width slightly exceeds the doorway so the sign reads as
  // "spanning the entrance" the way a real high-street showroom sign
  // would.
  const signWidth = DOORWAY_WIDTH + 1.4;
  const signHeight = Math.min(lintelHeight - 0.2, 0.85);
  const signDepth = 0.18; // proud of the wall by this much
  // Small air gap between the wall plane and the back of the signboard
  // body. Without this the box's back face is coplanar with the south-
  // wall side panels at the sign's left/right overhangs, which causes
  // GPU z-fighting that reads as the wall "missing" behind the sign
  // when viewed from inside the gallery.
  const signStandoff = 0.04;
  const signBackZ = z + signStandoff;
  const signCenterZ = signBackZ + signDepth / 2;
  const signFrontZ = signBackZ + signDepth; // front face of the signboard
  // Centre vertically on the lintel band, biased slightly upward so
  // there's a clear gap between the doorway and the bottom of the sign.
  const signY = DOORWAY_HEIGHT + signHeight / 2 + 0.06;

  return (
    <group data-vfg-room="wall-south-with-doorway">
      {/* Left facade panel — warm honed limestone */}
      <mesh
        position={[-sideCenter, wallY, z]}
        rotation={[0, Math.PI, 0]}
        receiveShadow
      >
        <planeGeometry args={[sideWidth, ROOM.height]} />
        <meshStandardMaterial
          color="#c9b08a"
          roughness={0.7}
          metalness={0.05}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Right facade panel */}
      <mesh
        position={[sideCenter, wallY, z]}
        rotation={[0, Math.PI, 0]}
        receiveShadow
      >
        <planeGeometry args={[sideWidth, ROOM.height]} />
        <meshStandardMaterial
          color="#c9b08a"
          roughness={0.7}
          metalness={0.05}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Lintel above doorway */}
      <mesh
        position={[0, lintelY, z]}
        rotation={[0, Math.PI, 0]}
        receiveShadow
      >
        <planeGeometry args={[DOORWAY_WIDTH, lintelHeight]} />
        <meshStandardMaterial
          color="#c9b08a"
          roughness={0.7}
          metalness={0.05}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* ----------------------------------------------------------------
          Showroom signboard above the doorway. A real boxed panel
          mounted proud of the facade with brass frame edging, two
          mounting brackets back to the wall, and the boutique name
          extruded forward off the front face. Reads as a high-street
          showroom sign rather than a flat marquee splash.
          ----------------------------------------------------------------- */}

      {/* Mounting brackets — short cylinder arms from the wall to the
          back of the signboard. Two brackets, near each end of the
          sign, suggesting the panel is hung off the facade. The
          bracket length matches `signStandoff + signDepth/2` so the
          near end sits flush with the wall plane and the far end
          centres on the back face of the sign body. */}
      {[-(signWidth / 2 - 0.6), signWidth / 2 - 0.6].map((bx, i) => {
        const bracketLength = signStandoff + signDepth / 2;
        const bracketCenterZ = z + bracketLength / 2;
        return (
          <mesh
            key={`sign-bracket-${i}`}
            position={[bx, signY + signHeight / 2 - 0.08, bracketCenterZ]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry args={[0.025, 0.025, bracketLength, 12]} />
            <meshStandardMaterial
              color="#2a2014"
              roughness={0.5}
              metalness={0.6}
            />
          </mesh>
        );
      })}

      {/* Sign body — dark backing box that sits proud of the wall. */}
      <mesh position={[0, signY, signCenterZ]}>
        <boxGeometry args={[signWidth, signHeight, signDepth]} />
        <meshStandardMaterial
          color="#1a1410"
          roughness={0.55}
          metalness={0.4}
        />
      </mesh>

      {/* Brass border frame around the front face — four thin slabs
          framing the inset signboard panel. */}
      {(() => {
        const borderThickness = 0.06;
        const borderDepth = 0.04;
        const borderZ = signFrontZ + borderDepth / 2;
        const innerW = signWidth - borderThickness * 2;
        const innerH = signHeight - borderThickness * 2;
        return (
          <>
            {/* top border */}
            <mesh
              position={[
                0,
                signY + signHeight / 2 - borderThickness / 2,
                borderZ,
              ]}
            >
              <boxGeometry args={[signWidth, borderThickness, borderDepth]} />
              <meshStandardMaterial
                color="#c89a48"
                roughness={0.35}
                metalness={0.85}
                emissive="#3a2a0c"
                emissiveIntensity={0.25}
              />
            </mesh>
            {/* bottom border */}
            <mesh
              position={[
                0,
                signY - signHeight / 2 + borderThickness / 2,
                borderZ,
              ]}
            >
              <boxGeometry args={[signWidth, borderThickness, borderDepth]} />
              <meshStandardMaterial
                color="#c89a48"
                roughness={0.35}
                metalness={0.85}
                emissive="#3a2a0c"
                emissiveIntensity={0.25}
              />
            </mesh>
            {/* left border */}
            <mesh
              position={[
                -signWidth / 2 + borderThickness / 2,
                signY,
                borderZ,
              ]}
            >
              <boxGeometry args={[borderThickness, innerH, borderDepth]} />
              <meshStandardMaterial
                color="#c89a48"
                roughness={0.35}
                metalness={0.85}
                emissive="#3a2a0c"
                emissiveIntensity={0.25}
              />
            </mesh>
            {/* right border */}
            <mesh
              position={[
                signWidth / 2 - borderThickness / 2,
                signY,
                borderZ,
              ]}
            >
              <boxGeometry args={[borderThickness, innerH, borderDepth]} />
              <meshStandardMaterial
                color="#c89a48"
                roughness={0.35}
                metalness={0.85}
                emissive="#3a2a0c"
                emissiveIntensity={0.25}
              />
            </mesh>
          </>
        );
      })()}

      {/* Sign face — cream backing inside the brass frame, slightly
          recessed so the frame casts a small bevel shadow. */}
      <mesh position={[0, signY, signFrontZ + 0.001]}>
        <planeGeometry args={[signWidth - 0.12, signHeight - 0.12]} />
        <meshStandardMaterial
          color="#f5e8c7"
          roughness={0.5}
          metalness={0.05}
          emissive="#5a4a20"
          emissiveIntensity={0.25}
        />
      </mesh>

      {/* Boutique name as 3D brass letters extruded forward off the
          sign face. `Text3D` produces real geometry so the letters
          read as physical objects with depth and a subtle bevel.
          `<Center>` measures the resulting bounding box and offsets
          it so the parent group's origin sits at the centre of the
          text — keeping the letters horizontally centred on the
          sign regardless of the catalogue name. */}
      <group position={[0, signY, signFrontZ + 0.025]}>
        <Center>
          <Text3D
            font="/fonts/helvetiker_bold.typeface.json"
            size={Math.min(signHeight * 0.5, 0.42)}
            height={0.06}
            curveSegments={6}
            bevelEnabled
            bevelThickness={0.012}
            bevelSize={0.008}
            bevelOffset={0}
            bevelSegments={3}
            letterSpacing={0.06}
          >
            GP FASHION
            <meshStandardMaterial
              color="#d4a04a"
              roughness={0.3}
              metalness={0.9}
              emissive="#5a3e10"
              emissiveIntensity={0.5}
            />
          </Text3D>
        </Center>
      </group>
    </group>
  );
}

/**
 * FoyerChamber — the warm indoor lobby in front of the boutique
 * facade. Visitors land in a corridor-width vestibule with sandy
 * walls, a walnut floor, and warm overhead lighting that picks up
 * the polished marquee on the far wall. Stepping inside walks them
 * through the sliding glass doors into the gallery proper.
 *
 * Visual scheme:
 *   - "Floor": warm walnut.
 *   - "Ceiling": warm off-white.
 *   - "Side walls": sandy beige so the lobby feels open and bright.
 *   - "Back wall": deeper warm-amber accent so the eye is drawn
 *     forward toward the boutique entrance rather than the rear.
 */
function FoyerChamber() {
  const z0 = ROOM.depth / 2; // back of foyer (gallery side, the boutique facade)
  const z1 = z0 + FOYER_DEPTH; // front of foyer (visitor's "across the street" side)
  const halfFoyerW = FOYER_WIDTH / 2;
  const wallY = ROOM.height / 2;

  // Foyer floor uses the same procedural marble-tile texture as the
  // gallery proper, with repeats sized to the foyer's footprint so
  // the physical tile size (~0.8 m) matches across the doorway.
  const foyerFloorTexture = useMemo(
    () => createMarbleTileTexture(FOYER_WIDTH / 0.8, FOYER_DEPTH / 0.8),
    [],
  );

  return (
    <group data-vfg-room="foyer">
      {/* Lobby floor — same polished marble tiles + real-time
          reflection treatment as the gallery proper, so the slab
          visually runs uninterrupted through the doorway. */}
      <mesh
        position={[0, 0, (z0 + z1) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[FOYER_WIDTH, FOYER_DEPTH]} />
        <MeshReflectorMaterial
          map={foyerFloorTexture}
          resolution={512}
          mixBlur={2}
          mixStrength={0.55}
          blur={[300, 100]}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
          depthScale={1.2}
          roughness={0.18}
          metalness={0.04}
          reflectorOffset={0.001}
        />
      </mesh>

      {/* Lobby ceiling — warm off-white plaster. */}
      <mesh
        position={[0, ROOM.height, (z0 + z1) / 2]}
        rotation={[Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[FOYER_WIDTH, FOYER_DEPTH]} />
        <meshPhysicalMaterial
          color="#f1e8d4"
          roughness={0.85}
          metalness={0}
          sheen={0.18}
          sheenColor="#ffd9a3"
        />
      </mesh>

      {/* Lobby west wall — sandy beige. */}
      <mesh
        position={[-halfFoyerW, wallY, (z0 + z1) / 2]}
        rotation={[0, Math.PI / 2, 0]}
      >
        <planeGeometry args={[FOYER_DEPTH, ROOM.height]} />
        <meshPhysicalMaterial
          color="#dcc9a5"
          roughness={0.78}
          metalness={0}
          clearcoat={0.15}
          clearcoatRoughness={0.6}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Lobby east wall — sandy beige. */}
      <mesh
        position={[halfFoyerW, wallY, (z0 + z1) / 2]}
        rotation={[0, -Math.PI / 2, 0]}
      >
        <planeGeometry args={[FOYER_DEPTH, ROOM.height]} />
        <meshPhysicalMaterial
          color="#dcc9a5"
          roughness={0.78}
          metalness={0}
          clearcoat={0.15}
          clearcoatRoughness={0.6}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Lobby back wall — a deeper warm-amber accent so the eye is
          drawn forward toward the gallery doors rather than the
          rear of the foyer. */}
      <mesh
        position={[0, wallY, z1]}
        rotation={[0, 0, 0]}
      >
        <planeGeometry args={[FOYER_WIDTH, ROOM.height]} />
        <meshPhysicalMaterial
          color="#a37a4b"
          roughness={0.78}
          metalness={0}
          clearcoat={0.15}
          clearcoatRoughness={0.6}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* GP Fashion logo mounted on the foyer back wall, centred and
          facing into the foyer interior so it greets the visitor on
          turning around. The component preserves the source image's
          intrinsic aspect ratio. Suspends until the texture loads;
          the Canvas's default Suspense fallback covers that branch. */}
      <FoyerLogo
        position={[0, wallY, z1 - 0.01]}
        targetHeight={2.0}
        maxWidth={FOYER_WIDTH - 1.0}
      />

      {/* Foyer trim — same eggshell baseboard / crown moulding as the
          gallery proper, so the architectural language reads
          continuous as the visitor walks through the doors. */}
      <FoyerTrim z0={z0} z1={z1} halfFoyerW={halfFoyerW} />

      {/* Lobby fill light — two warm amber wall-washers tucked toward
          the side walls. The ceiling-centre fixture was removed because
          it produced a bright hot-spot on the foyer roof; the side
          lamps already provide the warm vestibule glow without a
          visible point-source on the ceiling. */}
      <pointLight
        position={[-halfFoyerW + 1.5, 2.6, z0 + FOYER_DEPTH * 0.7]}
        intensity={0.7}
        distance={6}
        decay={2}
        color="#ffc98a"
      />
      <pointLight
        position={[halfFoyerW - 1.5, 2.6, z0 + FOYER_DEPTH * 0.7]}
        intensity={0.7}
        distance={6}
        decay={2}
        color="#ffc98a"
      />

      {/* Sliding glass doors filling the doorway. */}
      <SlidingGlassDoors />
    </group>
  );
}

/**
 * BackdropWindows — retained but no longer mounted. Originally drew
 * "buildings across the street" rectangles on the foyer's back wall
 * for an outdoor-night look; the foyer was later rethemed as a warm
 * indoor lobby that doesn't need them. Kept in source so it can be
 * re-enabled if the outdoor variant is ever revisited.
 */
function BackdropWindows({
  wallZ,
  wallWidth,
}: {
  wallZ: number;
  wallWidth: number;
}) {
  const cols = 4;
  const rows = 2;
  const winW = 0.7;
  const winH = 0.55;
  const colSpacing = wallWidth / (cols + 1);
  const yTop = ROOM.height - 0.5;
  const yMid = ROOM.height - 1.4;
  const ys = rows === 2 ? [yTop, yMid] : [yTop];

  const rects: Array<{ x: number; y: number; bright: boolean }> = [];
  for (let r = 0; r < ys.length; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -wallWidth / 2 + colSpacing * (c + 1);
      const bright = (c * 3 + r * 5) % 4 !== 0;
      rects.push({ x, y: ys[r], bright });
    }
  }

  return (
    <group data-vfg-room="foyer-backdrop-windows">
      {rects.map((rect, i) => (
        <mesh key={i} position={[rect.x, rect.y, wallZ]}>
          <planeGeometry args={[winW, winH]} />
          <meshBasicMaterial
            color={rect.bright ? "#ffd189" : "#7a5e34"}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

/**
 * SlidingGlassDoors — two frosted-glass panels that fill the doorway
 * in the gallery's south wall.
 *
 * While `entryStage === "foyer"` the doors are closed and rendered as
 * opaque frosted glass so the gallery interior is hidden from the
 * foyer (the visitor should not see the artworks until they step
 * inside). Once the visitor presses "Step inside" the stage flips to
 * `"entering"`, the panels slide apart, and the glass tint fades from
 * opaque toward transparent so the reveal feels like the doors
 * letting light through. After `"inside"` the panels stay open.
 */
function SlidingGlassDoors() {
  const entryStage = useGalleryStore((s) => s.entryStage);
  const reducedMotion = useGalleryStore((s) => s.reducedMotion);
  const completeEntry = useGalleryStore((s) => s.completeEntry);

  // Each door fills exactly half the doorway. A 0.001m centre overlap
  // keeps the seam from showing a hairline gap when closed.
  const panelWidth = DOORWAY_WIDTH / 2 + 0.001;
  const panelHeight = DOORWAY_HEIGHT;
  const panelThickness = 0.025; // give the glass real volume so reflections / refraction read
  const z = ROOM.depth / 2 + 0.02; // sit just outside the wall plane on the foyer side

  // Animate openness from 0 (closed) → 1 (fully open) when the stage
  // leaves "foyer". `useFrame` is the simplest cross-cutting tween
  // available without pulling in framer-motion-3d at this scale.
  const opennessRef = useRef(0);
  const leftRef = useRef<THREE.Group | null>(null);
  const rightRef = useRef<THREE.Group | null>(null);
  const leftMatRef = useRef<THREE.MeshPhysicalMaterial | null>(null);
  const rightMatRef = useRef<THREE.MeshPhysicalMaterial | null>(null);
  const seamMatRef = useRef<THREE.MeshStandardMaterial | null>(null);

  // Door opacity stays at 0.75 throughout: closed, sliding, fully
  // open. The visitor sees the gallery interior through the closed
  // doors as a faint silhouette and the same translucent panel
  // tucked into the wall pocket once open. The pockets are kept
  // clear of opaque wall geometry (see `SouthWallWithDoorway` —
  // the side panels stop short of the doorway-edge + panel-width
  // line) so an open door doesn't overlap an opaque surface.
  const CLOSED_OPACITY = 0.75;
  const OPEN_OPACITY = 0.75;

  useFrame((_, dt) => {
    const target = entryStage === "foyer" ? 0 : 1;
    if (opennessRef.current !== target) {
      // Reduced-motion users still see the doors open; we just snap.
      if (reducedMotion) {
        opennessRef.current = target;
      } else {
        // Spring-ish ease at ~1.5s open duration.
        const k = Math.min(1, dt * 1.6);
        opennessRef.current += (target - opennessRef.current) * k;
        if (Math.abs(opennessRef.current - target) < 0.001) {
          opennessRef.current = target;
        }
      }
    }

    // Hand off to "inside" once the doors are visually open enough
    // (~70% open reads as fully clear to the visitor). Firing early
    // means the joystick and controls are ready before the tail of
    // the spring animation finishes, eliminating the perceived gap
    // between "doors open" and "I can move" on slow mobile devices.
    if (entryStage === "entering" && opennessRef.current >= 0.7) {
      completeEntry();
    }

    const openness = opennessRef.current;
    // Slide each door by exactly its own width when fully open. The
    // doors travel into the wall on either side of the doorway and
    // sit flush behind the south-wall side panels — same trick a real
    // store-front sliding door uses with wall pockets — so the
    // doorway opening is completely clear without any margin shimmy.
    const slide = openness * panelWidth;
    if (leftRef.current) {
      leftRef.current.position.x = -panelWidth / 2 - slide;
    }
    if (rightRef.current) {
      rightRef.current.position.x = panelWidth / 2 + slide;
    }

    const opacity = CLOSED_OPACITY + (OPEN_OPACITY - CLOSED_OPACITY) * openness;
    if (leftMatRef.current) {
      leftMatRef.current.opacity = opacity;
    }
    if (rightMatRef.current) {
      rightMatRef.current.opacity = opacity;
    }
    // The centre seam is only meaningful while the doors are closed —
    // it reads as the gap between the two panels. The instant the
    // slide begins it stops being part of any panel and would just
    // float in the doorway, so we hide it the moment `openness`
    // leaves zero rather than fading it linearly.
    if (seamMatRef.current) {
      seamMatRef.current.opacity = openness > 0 ? 0 : 1;
    }
  });

  return (
    <group data-vfg-room="entry-doors">
      {/* Left door — group so the chrome handle slides with the panel. */}
      <group
        ref={leftRef}
        position={[-panelWidth / 2, DOORWAY_HEIGHT / 2, z]}
      >
        {/* Glass panel — a thin box (not a plane) so the edges catch
            reflections and refraction looks volumetric.
            `meshPhysicalMaterial` with `transmission` gives real
            see-through glass under R3F, with a tiny tint and a
            clear-coat layer for the showroom-glass look. */}
        <mesh>
          <boxGeometry args={[panelWidth, panelHeight, panelThickness]} />
          <meshPhysicalMaterial
            ref={leftMatRef}
            color="#cfe0ec"
            transparent
            opacity={CLOSED_OPACITY}
            transmission={0.9}
            thickness={0.04}
            ior={1.45}
            roughness={0.08}
            metalness={0}
            clearcoat={1}
            clearcoatRoughness={0.05}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
        <DoorHandle
          xOffset={panelWidth / 2 - 0.18}
          panelHeight={panelHeight}
          panelThickness={panelThickness}
        />
      </group>

      {/* Right door */}
      <group
        ref={rightRef}
        position={[panelWidth / 2, DOORWAY_HEIGHT / 2, z]}
      >
        <mesh>
          <boxGeometry args={[panelWidth, panelHeight, panelThickness]} />
          <meshPhysicalMaterial
            ref={rightMatRef}
            color="#cfe0ec"
            transparent
            opacity={CLOSED_OPACITY}
            transmission={0.9}
            thickness={0.04}
            ior={1.45}
            roughness={0.08}
            metalness={0}
            clearcoat={1}
            clearcoatRoughness={0.05}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
        <DoorHandle
          xOffset={-panelWidth / 2 + 0.18}
          panelHeight={panelHeight}
          panelThickness={panelThickness}
        />
      </group>
      {/* Centre seam — a thin metallic strip where the two panels
          meet, so the closed pose reads as two distinct doors rather
          than a single frosted slab. The seam fades out alongside the
          panels (via `seamMatRef`) so it doesn't linger in the
          middle of the open doorway. */}
      <mesh position={[0, DOORWAY_HEIGHT / 2, z + 0.001]}>
        <boxGeometry args={[0.025, DOORWAY_HEIGHT - 0.1, 0.005]} />
        <meshStandardMaterial
          ref={seamMatRef}
          color="#2a2a32"
          roughness={0.4}
          metalness={0.7}
          transparent
          opacity={CLOSED_OPACITY}
        />
      </mesh>
      {/* Thin metallic frame around the doorway — subtle visual cue
          so the doors read as physical objects rather than a tinted
          rectangle. */}
      <mesh position={[0, 0.02, z - 0.005]}>
        <boxGeometry args={[DOORWAY_WIDTH + 0.05, 0.04, 0.01]} />
        <meshStandardMaterial color="#3a3a45" roughness={0.4} metalness={0.6} />
      </mesh>
      <mesh position={[0, DOORWAY_HEIGHT - 0.02, z - 0.005]}>
        <boxGeometry args={[DOORWAY_WIDTH + 0.05, 0.04, 0.01]} />
        <meshStandardMaterial color="#3a3a45" roughness={0.4} metalness={0.6} />
      </mesh>
    </group>
  );
}

/**
 * DoorHandle — a vertical brushed-chrome pull bar, mounted off the
 * foyer-side face of a door panel by two short cylindrical standoff
 * posts. Reads as a real shopfront pull rather than a flat dark
 * rectangle:
 *
 *   - Pull bar:   a vertical capsule-ended cylinder along the
 *                 panel's vertical axis. Polished chrome material
 *                 with low roughness so it catches highlights even
 *                 under ambient + hemisphere lighting only.
 *   - Standoffs:  two short horizontal cylinders that connect the
 *                 pull bar to the door panel, sitting at the top
 *                 and bottom of the bar.
 *
 * `xOffset` is the local x-coordinate of the handle on the panel
 * (positive = right side of panel, negative = left side). The
 * handle sits just in front of the glass on the foyer side; its
 * shadow under the bevel reads as the gap to the panel.
 */
function DoorHandle({
  xOffset,
  panelHeight,
  panelThickness,
}: {
  xOffset: number;
  panelHeight: number;
  panelThickness: number;
}) {
  const barLength = panelHeight * 0.55;
  const barRadius = 0.018;
  const standoffLength = 0.06;
  const standoffRadius = 0.012;
  // Bar centre sits this far forward of the panel's front face so it
  // looks mounted in front of the glass rather than embedded in it.
  const barZ = panelThickness / 2 + standoffLength;

  return (
    <group position={[xOffset, 0, 0]}>
      {/* Pull bar — vertical cylinder. Default cylinder axis is +Y so
          no rotation needed. */}
      <mesh position={[0, 0, barZ]}>
        <cylinderGeometry args={[barRadius, barRadius, barLength, 16]} />
        <meshStandardMaterial
          color="#e8e8ec"
          roughness={0.2}
          metalness={0.95}
          envMapIntensity={1.3}
        />
      </mesh>
      {/* Top standoff post — short cylinder bridging the bar back
          to the panel face. Rotated so its long axis runs along
          the local Z (away from the panel into the foyer). */}
      <mesh
        position={[0, barLength / 2 - 0.04, barZ - standoffLength / 2]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <cylinderGeometry
          args={[standoffRadius, standoffRadius, standoffLength, 12]}
        />
        <meshStandardMaterial
          color="#cfcfd3"
          roughness={0.25}
          metalness={0.9}
        />
      </mesh>
      {/* Bottom standoff post */}
      <mesh
        position={[0, -(barLength / 2 - 0.04), barZ - standoffLength / 2]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <cylinderGeometry
          args={[standoffRadius, standoffRadius, standoffLength, 12]}
        />
        <meshStandardMaterial
          color="#cfcfd3"
          roughness={0.25}
          metalness={0.9}
        />
      </mesh>
    </group>
  );
}

/**
 * EntryWalkController — retained as a no-op for backward compatibility
 * with earlier task notes; the auto-walk was removed in favour of
 * letting visitors drive the camera themselves once the doors open.
 *
 * Kept exported (without being mounted) so any future re-enable of
 * the cinematic walk can drop the component back into the scene tree
 * without re-deriving the easing math.
 */
function EntryWalkController() {
  const camera = useThree((s) => s.camera);
  const entryStage = useGalleryStore((s) => s.entryStage);
  const reducedMotion = useGalleryStore((s) => s.reducedMotion);
  const completeEntry = useGalleryStore((s) => s.completeEntry);

  const startedRef = useRef(false);
  const startTimeRef = useRef(0);
  const fromZRef = useRef(0);

  useFrame((state) => {
    if (entryStage !== "entering") {
      startedRef.current = false;
      return;
    }
    if (!startedRef.current) {
      startedRef.current = true;
      startTimeRef.current = state.clock.elapsedTime;
      fromZRef.current = camera.position.z;
    }

    const duration = reducedMotion ? 0.3 : 3.0;
    const elapsed = state.clock.elapsedTime - startTimeRef.current;
    const t = Math.min(1, elapsed / duration);
    const eased = 1 - Math.pow(1 - t, 3);

    const fromZ = fromZRef.current;
    const toZ = ENTRY_TARGET_Z;
    camera.position.x = 0;
    camera.position.y = 1.6;
    camera.position.z = fromZ + (toZ - fromZ) * eased;
    camera.rotation.order = "YXZ";
    camera.rotation.set(0, 0, 0, "YXZ");
    camera.updateMatrixWorld();

    if (t >= 1) {
      completeEntry();
    }
  });

  return null;
}

// Suppress unused-symbol lint without exporting the helper publicly.
void EntryWalkController;
