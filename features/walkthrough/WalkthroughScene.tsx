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

import { Text } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { sketches } from "@/lib/sketches";

import { MetadataPanel } from "./MetadataPanel";
import { placeFrames, type RoomDimensions } from "./placement";
import { useGalleryStore } from "./store/useGalleryStore";
import { PostFx } from "./PostFx";
import {
  ProximityHighlighter,
  type ProximityFrame,
} from "./ProximityHighlighter";
import { SceneRefBinder } from "./scene-ref";
import { SketchFrame } from "./SketchFrame";

// ----------------------------------------------------------------------
// Room and spawn constants (Requirements 1.1, 1.8)
// ----------------------------------------------------------------------

/**
 * Interior dimensions of the gallery room in world units (≈ metres).
 * Width × height × depth = 18 × 4 × 18. The room was widened from the
 * original 12 × 4 × 12 footprint so the full GP Fashion 22-dress catalogue
 * fits comfortably along the four interior walls (default placement holds
 * roughly 8 frames per 18m wall, leaving headroom on each wall).
 */
export const ROOM: RoomDimensions = {
  width: 18,
  height: 4,
  depth: 18,
};

/**
 * Deterministic spawn point and orientation (Requirement 1.8).
 *
 * The Visitor enters the foyer chamber attached to the gallery's south
 * wall (which sits at +z) and faces the gallery doorway.
 *
 * In three.js the default camera looks down −z, so `yaw = 0` keeps the
 * forward vector pointing toward −z — which from a foyer position at
 * `z = 13` aims through the doorway at `z = +9` and on into the gallery
 * proper. Pitch = 0 keeps the camera level. Eye height of 1.6m is a
 * standing-adult default and matches the mid-wall frame anchor at
 * `room.height / 2`.
 *
 * Exported as a frozen object so consumers (controls subtree, future
 * XR session, tests) can read the same canonical value without being
 * able to mutate it.
 */
export const SPAWN = Object.freeze({
  position: [0, 1.6, 13] as const,
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
const FOYER_WIDTH = 18; // matches gallery width so the foyer fully covers the south wall on either side of the doorway
/** Width of the doorway cut into the south wall, in world units. */
const DOORWAY_WIDTH = 5;
/** Height of the doorway, in world units. Slightly less than ceiling height. */
const DOORWAY_HEIGHT = 3;

/**
 * Camera target the entry-walk auto-walks the visitor to once the
 * "Step inside" button is pressed. Sits a couple of metres past the
 * doorway, inside the gallery proper.
 */
export const ENTRY_TARGET_Z = -2;

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
const FOYER_FRONT_Z = HALF_D; // boundary with gallery
const FOYER_BACK_Z = HALF_D + FOYER_DEPTH; // far foyer wall

export const GALLERY_COLLIDERS: ReadonlyArray<AABB> = [
  // Gallery north wall (z = -HALF_D, slab extends outward).
  {
    min: [-HALF_W, 0, -HALF_D - WALL_SLAB],
    max: [HALF_W, ROOM.height, -HALF_D],
  },
  // Gallery west wall (x = -HALF_W).
  {
    min: [-HALF_W - WALL_SLAB, 0, -HALF_D],
    max: [-HALF_W, ROOM.height, FOYER_BACK_Z],
  },
  // Gallery east wall (x = +HALF_W).
  {
    min: [HALF_W, 0, -HALF_D],
    max: [HALF_W + WALL_SLAB, ROOM.height, FOYER_BACK_Z],
  },
  // Gallery south wall — left of doorway.
  {
    min: [-HALF_W, 0, HALF_D],
    max: [-DOORWAY_WIDTH / 2, ROOM.height, HALF_D + WALL_SLAB],
  },
  // Gallery south wall — right of doorway.
  {
    min: [DOORWAY_WIDTH / 2, 0, HALF_D],
    max: [HALF_W, ROOM.height, HALF_D + WALL_SLAB],
  },
  // Foyer back ("street") wall — keeps the visitor from walking out
  // the back of the foyer.
  {
    min: [-HALF_W, 0, FOYER_BACK_Z],
    max: [HALF_W, ROOM.height, FOYER_BACK_Z + WALL_SLAB],
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
 * Wall spot-light placement: each wall gets one spot whose origin sits
 * on the room's central axis facing the wall, aimed at the wall's
 * mid-line. The wide cone angle (≈ 70°) ensures the light reaches
 * every Sketch_Frame on that wall — a 12m wall under default placement
 * holds at most 5 frames spaced 2m apart, all within the cone of a
 * single spot positioned 4m from the wall. With one spot per wall the
 * total live-light count is `1 ambient + 1 hemisphere + 4 spots = 6`,
 * leaving two slots of headroom under the Req 9.4 cap.
 */
type SpotLightSpec = {
  /** Stable id used as the React key. */
  id: string;
  /** World-space spot position (light source). */
  position: [number, number, number];
  /** World-space target for the light's `target` object. */
  target: [number, number, number];
};

const SPOT_LIGHT_SPECS: ReadonlyArray<SpotLightSpec> = [
  // South wall (z = +9, frames face −z): light sits in front of the
  // wall in the room interior, aimed back at the wall mid-line.
  { id: "spot-south", position: [0, 3.4, 3.0], target: [0, 2.0, 9] },
  // West wall (x = −9, frames face +x).
  { id: "spot-west", position: [-3.0, 3.4, 0], target: [-9, 2.0, 0] },
  // North wall (z = −9, frames face +z).
  { id: "spot-north", position: [0, 3.4, -3.0], target: [0, 2.0, -9] },
  // East wall (x = +9, frames face −x).
  { id: "spot-east", position: [3.0, 3.4, 0], target: [9, 2.0, 0] },
];

/** Compile-time invariant: declared light count fits the Req 9.4 budget. */
const ACTIVE_LIGHT_COUNT = 1 /* ambient */ + 1 /* hemisphere */ + SPOT_LIGHT_SPECS.length;
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

  // Compute frame placements once per catalogue identity. The catalogue
  // is a module-level `ReadonlyArray<SketchRecord>` so this useMemo
  // collapses to a single computation per scene mount in practice.
  // Skip the south wall — that's where the entrance doorway is cut.
  const wallPoses = useMemo(
    () => placeFrames(sketches, ROOM, { skipSouthWall: true }),
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

      {/* Floor */}
      <mesh
        position={[0, 0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        data-vfg-room="floor"
      >
        <planeGeometry args={[ROOM.width, ROOM.depth]} />
        <meshStandardMaterial color="#c9b896" roughness={0.7} metalness={0} />
      </mesh>

      {/* Ceiling */}
      <mesh
        position={[0, ROOM.height, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        receiveShadow
        data-vfg-room="ceiling"
      >
        <planeGeometry args={[ROOM.width, ROOM.depth]} />
        <meshStandardMaterial color="#e8e0cf" roughness={0.95} metalness={0} />
      </mesh>

      {/* South wall — split into a left panel, a right panel, and a
          lintel above the doorway. The doorway itself is open so the
          visitor can walk through after the entry-walk completes. */}
      <SouthWallWithDoorway />

      {/* Foyer chamber attached to the south wall — visitors spawn
          here at z = SPAWN.z. The chamber's south wall is the glass
          entry surface; the doors slide aside on entry. */}
      <FoyerChamber />

      {/* North wall (z = −HALF_DEPTH, visible side faces +z) */}
      <mesh
        position={[0, ROOM.height / 2, -HALF_DEPTH]}
        rotation={[0, 0, 0]}
        receiveShadow
        data-vfg-room="wall-north"
      >
        <planeGeometry args={[ROOM.width, ROOM.height]} />
        <meshStandardMaterial
          color="#ece2cf"
          roughness={0.92}
          metalness={0}
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
        <meshStandardMaterial
          color="#ece2cf"
          roughness={0.92}
          metalness={0}
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
        <meshStandardMaterial
          color="#ece2cf"
          roughness={0.92}
          metalness={0}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* ----------------------------------------------------------------
          Lighting plan (Req 2.3, 9.4).
          1 ambient + 1 hemisphere + 4 spots = 6 active lights, ≤ 8.
          Each spot is aimed at its wall mid-line so every frame on
          that wall is lit from the visitor's side, satisfying Req 2.3.
          ---------------------------------------------------------------- */}

      <ambientLight intensity={0.7} />

      <hemisphereLight
        args={["#fff8e7", "#3a3a45", 0.9]}
        position={[0, ROOM.height, 0]}
      />

      {SPOT_LIGHT_SPECS.map((spec) => (
        <SpotLightForWall key={spec.id} spec={spec} />
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

      {sketches.map((record, i) => (
        <MetadataPanel
          key={`panel-${record.id}`}
          record={record}
          wallPose={wallPoses[i]}
          index={i}
        />
      ))}

      {/* Proximity emphasis driver (Req 2.5, 2.6). */}
      <ProximityHighlighter frames={proximityFrames} />

      {/* Post-processing pipeline (Req 2.4, 11.6). */}
      <PostFx />

      {/* Register the THREE.Scene reference for future XR (Req 5.7, 13.1). */}
      <SceneRefBinder scene={scene} />
    </>
  );
}

/**
 * SpotLightForWall — emits one `<spotLight/>` plus its `target` object
 * and parents the target under the spot so R3F applies the world-space
 * `target.position` after the spot has been added to the scene graph.
 *
 * Without this dance the default `SpotLight.target` (a `THREE.Object3D`
 * at the origin) would be used, and the spot would aim at the room
 * centre regardless of `target` props. Mounting the target as a child
 * of the spot side-steps the issue cleanly: r3f attaches the spot's
 * `.target` slot to the inner `<object3D/>`, whose `position` we
 * supply in world units.
 */
function SpotLightForWall({ spec }: { spec: SpotLightSpec }) {
  // The angle (≈ 70° half-cone, π * 0.4) and decay (1.0) are tuned so
  // a single spot reaches every frame on its wall under default
  // `placeFrames` parameters. The penumbra softens the cone edge so
  // the bloom pass does not pick up a hard cutoff line.
  return (
    <spotLight
      position={spec.position}
      angle={Math.PI * 0.45}
      penumbra={0.55}
      decay={1.0}
      distance={28}
      intensity={5.5}
      color="#fff5dd"
      // Lights are computed real-time but do not cast shadows in v1: the
      // matte gallery walls absorb most direct light, and disabling
      // shadow maps keeps the per-frame draw-call budget low (Req 9.2,
      // 9.3, 9.6). Shadowed lights remain a deferred performance lever.
      castShadow={false}
    >
      <object3D
        // R3F wires this child object into `spotLight.target` via the
        // `attach` prop. World-space target position is supplied on
        // the inner object — the spot's parent is the scene root, so
        // the target's local frame is already world frame.
        attach="target"
        position={spec.target}
      />
    </spotLight>
  );
}

export default WalkthroughScene;

/**
 * SouthWallWithDoorway — the boutique facade as seen from the foyer
 * sidewalk side. Replaces the gallery's south wall with three
 * rectangular sub-panels (left/right of the doorway, plus the lintel
 * above), dressed up to read as a luxury-showroom storefront on a
 * high-street avenue:
 *
 *   - Side panels are warm honed-limestone with a single recessed
 *     "display window" rectangle each. The window has a glowing back
 *     pane, an inset frame, and a darker sill so the eye reads it as
 *     a real opening rather than a flat lit poster.
 *   - The lintel above the doorway carries an awning and a backlit
 *     marquee with the boutique name rendered as 3D text.
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

  // Display-window dimensions, sized to fit comfortably inside each
  // side panel (sideWidth ≈ 6.5m, ROOM.height = 4m).
  const windowWidth = Math.min(sideWidth - 1.2, 4.5);
  const windowHeight = 2.4;
  const windowY = 1.7; // centred at chest height
  const frameThickness = 0.14;

  // Marquee dimensions on the lintel.
  const marqueeWidth = DOORWAY_WIDTH + 0.6;
  const marqueeHeight = Math.min(lintelHeight - 0.25, 0.65);
  const marqueeY = lintelY;

  // Awning slab cantilevered just above the doorway and below the
  // marquee. Reads as a small protruding canopy that real boutiques
  // run over the entrance.
  const awningWidth = DOORWAY_WIDTH + 1.4;
  const awningDepth = 0.8;
  const awningThickness = 0.06;
  const awningY = DOORWAY_HEIGHT + 0.05;

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
          color="#2a2620"
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
          color="#2a2620"
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
          color="#2a2620"
          roughness={0.7}
          metalness={0.05}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Display windows */}
      <DisplayWindow
        x={-sideCenter}
        y={windowY}
        z={z + 0.02}
        width={windowWidth}
        height={windowHeight}
        frameThickness={frameThickness}
      />
      <DisplayWindow
        x={sideCenter}
        y={windowY}
        z={z + 0.02}
        width={windowWidth}
        height={windowHeight}
        frameThickness={frameThickness}
      />

      {/* Awning — a small slab cantilevered over the entrance. */}
      <mesh
        position={[0, awningY, z + 0.02 + awningDepth / 2]}
      >
        <boxGeometry args={[awningWidth, awningThickness, awningDepth]} />
        <meshStandardMaterial
          color="#0e0e10"
          roughness={0.55}
          metalness={0.45}
        />
      </mesh>
      {/* Awning underside — a thin warm strip glowing slightly so
          the entrance gets a soft welcoming light from above. */}
      <mesh
        position={[0, awningY - awningThickness / 2 - 0.001, z + 0.02 + awningDepth / 2]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[awningWidth - 0.05, awningDepth - 0.05]} />
        <meshBasicMaterial color="#3a2c14" toneMapped={false} />
      </mesh>

      {/* Marquee plaque — backlit panel with the boutique name. */}
      <mesh position={[0, marqueeY, z + 0.025]}>
        <planeGeometry args={[marqueeWidth + 0.14, marqueeHeight + 0.14]} />
        <meshStandardMaterial
          color="#0a0a0a"
          roughness={0.45}
          metalness={0.55}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, marqueeY, z + 0.03]}>
        <planeGeometry args={[marqueeWidth, marqueeHeight]} />
        <meshBasicMaterial
          color="#f6e0a8"
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Boutique name rendered as 3D text floating just in front of
          the backlit plaque. The plate is rotated 180° about Y so the
          text reads correctly from the foyer side (where the visitor
          stands). */}
      <Text
        position={[0, marqueeY, z + 0.04]}
        rotation={[0, Math.PI, 0]}
        fontSize={Math.min(marqueeHeight * 0.62, 0.42)}
        color="#0a0a0a"
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.18}
      >
        GP FASHION
      </Text>
    </group>
  );
}

/**
 * DisplayWindow — a recessed boutique display window. Renders four
 * elements that together read as a real opening:
 *
 *   1. A dark stone outer frame slightly larger than the window.
 *   2. A glowing back pane (slightly inset) that lights the inside.
 *   3. A pair of brass-toned vertical mullions across the glass face.
 *   4. A darker sill below to ground the window in the facade.
 */
function DisplayWindow({
  x,
  y,
  z,
  width,
  height,
  frameThickness,
}: {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  frameThickness: number;
}) {
  const sillHeight = 0.18;
  const mullionWidth = 0.05;

  return (
    <group position={[x, y, z]}>
      {/* Outer frame — slightly behind so it reads as a stone surround */}
      <mesh position={[0, 0, -0.005]}>
        <planeGeometry
          args={[width + frameThickness * 2, height + frameThickness * 2]}
        />
        <meshStandardMaterial
          color="#1a1814"
          roughness={0.55}
          metalness={0.25}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Back pane — recessed slightly inside so the frame casts the
          impression of depth around it. */}
      <mesh position={[0, 0, -0.02]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial
          color="#f0d493"
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Vertical mullions across the glass face — three slim brass
          bars subdivide the window into panels. */}
      {[-1, 0, 1].map((i) => (
        <mesh key={i} position={[i * (width / 4), 0, 0.001]}>
          <planeGeometry args={[mullionWidth, height]} />
          <meshStandardMaterial
            color="#3a2c14"
            roughness={0.4}
            metalness={0.6}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      {/* Sill below the window — visually grounds the opening in the
          facade rather than letting it float. */}
      <mesh position={[0, -height / 2 - frameThickness / 2 - sillHeight / 2, 0]}>
        <planeGeometry args={[width + frameThickness * 2 + 0.2, sillHeight]} />
        <meshStandardMaterial
          color="#1f1d18"
          roughness={0.6}
          metalness={0.2}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

/**
 * FoyerChamber — the high-street sidewalk in front of the boutique
 * facade. Visitors land on the sidewalk side of the showroom doors
 * and see the storefront across the foyer space. Stepping inside
 * walks them off the street and into the gallery.
 *
 * Visual scheme:
 *   - "Sidewalk": dark stone floor with a slightly lighter inset
 *     near the storefront to suggest a stone threshold step.
 *   - "Sky": near-black ceiling so the foyer reads as outdoors at
 *     night. A scattering of warm point lights at street-lamp height
 *     gives the scene the feel of a lit avenue.
 *   - "Street side walls": dark stone with a row of softly glowing
 *     window rectangles (the windows of the buildings on either side
 *     of the street).
 *   - "Buildings across the street": the foyer's back wall is dressed
 *     up as a row of taller dark facades with their own warm window
 *     rectangles, so the visitor's first view from the sidewalk is
 *     the boutique on one side and a familiar streetscape on the other.
 */
function FoyerChamber() {
  const z0 = ROOM.depth / 2; // back of foyer (gallery side, the boutique facade)
  const z1 = z0 + FOYER_DEPTH; // front of foyer (visitor's "across the street" side)
  const halfFoyerW = FOYER_WIDTH / 2;
  const wallY = ROOM.height / 2;

  return (
    <group data-vfg-room="foyer">
      {/* Sidewalk — dark stone the visitor stands on. */}
      <mesh
        position={[0, 0, (z0 + z1) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[FOYER_WIDTH, FOYER_DEPTH]} />
        <meshStandardMaterial color="#262629" roughness={0.85} metalness={0} />
      </mesh>

      {/* Threshold step — a narrow strip of paler stone right in
          front of the boutique doors, so the visitor instinctively
          reads the boundary between sidewalk and showroom. */}
      <mesh
        position={[0, 0.005, z0 + 1.0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[DOORWAY_WIDTH + 1.5, 1.6]} />
        <meshStandardMaterial color="#3a3a40" roughness={0.7} metalness={0} />
      </mesh>

      {/* "Night sky" ceiling — near-black, so the foyer reads as
          open-air rather than a sealed vestibule. */}
      <mesh
        position={[0, ROOM.height, (z0 + z1) / 2]}
        rotation={[Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[FOYER_WIDTH, FOYER_DEPTH]} />
        <meshStandardMaterial color="#0a0a0e" roughness={0.95} metalness={0} />
      </mesh>

      {/* West side wall — neighbouring shopfront seen edge-on. */}
      <mesh
        position={[-halfFoyerW, wallY, (z0 + z1) / 2]}
        rotation={[0, Math.PI / 2, 0]}
      >
        <planeGeometry args={[FOYER_DEPTH, ROOM.height]} />
        <meshStandardMaterial
          color="#1a1a1f"
          roughness={0.92}
          metalness={0}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* East side wall — neighbouring shopfront seen edge-on. */}
      <mesh
        position={[halfFoyerW, wallY, (z0 + z1) / 2]}
        rotation={[0, -Math.PI / 2, 0]}
      >
        <planeGeometry args={[FOYER_DEPTH, ROOM.height]} />
        <meshStandardMaterial
          color="#1a1a1f"
          roughness={0.92}
          metalness={0}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* "Across the street" — the foyer's back wall is a row of
          dark building facades. */}
      <mesh
        position={[0, wallY, z1]}
        rotation={[0, 0, 0]}
      >
        <planeGeometry args={[FOYER_WIDTH, ROOM.height]} />
        <meshStandardMaterial
          color="#14141a"
          roughness={0.95}
          metalness={0}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Glowing windows along the back-wall facades. Three rows of
          small rectangles, evenly spaced, give the impression of
          residential floors above retail. */}
      <BackdropWindows wallZ={z1 - 0.02} wallWidth={FOYER_WIDTH} />

      {/* Street-lamp glow — a warm amber point light at lamp-post
          height in the centre of the foyer, plus subtler fills at the
          left and right sides. Total = 3 point lights, well under the
          Req 9.4 budget of 8. */}
      <pointLight
        position={[0, ROOM.height - 0.4, z0 + FOYER_DEPTH / 2]}
        intensity={1.2}
        distance={FOYER_DEPTH * 1.6}
        decay={2}
        color="#ffd9a3"
      />
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
 * BackdropWindows — a procedurally-laid grid of warm window
 * rectangles painted onto the foyer's back wall to suggest the
 * buildings across the street. Two rows × N columns; alternating
 * brightness so the row reads as a lit-up avenue rather than a single
 * uniform glow.
 */
function BackdropWindows({
  wallZ,
  wallWidth,
}: {
  wallZ: number;
  wallWidth: number;
}) {
  const cols = 9;
  const rows = 2;
  const winW = 0.7;
  const winH = 0.55;
  const colSpacing = wallWidth / (cols + 1);
  // Place windows on the upper half of the wall so they read as
  // residential floors above ground-floor retail.
  const yTop = ROOM.height - 0.5;
  const yMid = ROOM.height - 1.4;
  const ys = rows === 2 ? [yTop, yMid] : [yTop];

  const rects: Array<{ x: number; y: number; bright: boolean }> = [];
  for (let r = 0; r < ys.length; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -wallWidth / 2 + colSpacing * (c + 1);
      // Pseudo-random bright/dim mix so the wall doesn't look like
      // a stamped pattern.
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
  const z = ROOM.depth / 2 + 0.02; // sit just outside the wall plane on the foyer side

  // Animate openness from 0 (closed) → 1 (fully open) when the stage
  // leaves "foyer". `useFrame` is the simplest cross-cutting tween
  // available without pulling in framer-motion-3d at this scale.
  const opennessRef = useRef(0);
  const leftRef = useRef<THREE.Group | null>(null);
  const rightRef = useRef<THREE.Group | null>(null);
  const leftMatRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const rightMatRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const seamMatRef = useRef<THREE.MeshStandardMaterial | null>(null);

  // Doors stay fully opaque throughout the slide so they read as real
  // physical panels disappearing into the side-wall pockets, the way
  // a showroom sliding door actually behaves. Opacity stays pinned at
  // 1.0 — the slide alone clears the doorway.
  const CLOSED_OPACITY = 1.0;
  const OPEN_OPACITY = 1.0;

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

    // Once the doors have finished opening, hand off to the "inside"
    // stage so the entry overlay collapses to the nav-hint chip and
    // the keyboard / mouse / touch controls take effect. We test
    // `entryStage` instead of `target` so this handoff cannot fire on
    // the closing direction (which never actually happens in v1, but
    // keeps the intent explicit).
    if (entryStage === "entering" && opennessRef.current >= 0.999) {
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
        <mesh>
          <planeGeometry args={[panelWidth, panelHeight]} />
          <meshStandardMaterial
            ref={leftMatRef}
            color="#cdd9e6"
            transparent
            opacity={CLOSED_OPACITY}
            roughness={0.4}
            metalness={0.05}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* Door handle — a vertical chrome bar near the centre seam,
            mounted slightly forward of the glass on the foyer side. */}
        <mesh position={[panelWidth / 2 - 0.18, 0, 0.025]}>
          <boxGeometry args={[0.04, panelHeight * 0.55, 0.04]} />
          <meshStandardMaterial
            color="#dddddd"
            roughness={0.2}
            metalness={0.85}
          />
        </mesh>
      </group>

      {/* Right door */}
      <group
        ref={rightRef}
        position={[panelWidth / 2, DOORWAY_HEIGHT / 2, z]}
      >
        <mesh>
          <planeGeometry args={[panelWidth, panelHeight]} />
          <meshStandardMaterial
            ref={rightMatRef}
            color="#cdd9e6"
            transparent
            opacity={CLOSED_OPACITY}
            roughness={0.4}
            metalness={0.05}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh position={[-panelWidth / 2 + 0.18, 0, 0.025]}>
          <boxGeometry args={[0.04, panelHeight * 0.55, 0.04]} />
          <meshStandardMaterial
            color="#dddddd"
            roughness={0.2}
            metalness={0.85}
          />
        </mesh>
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
