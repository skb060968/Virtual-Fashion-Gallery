// placement.ts — Sketch_Frame placement helper for the Walkthrough_Scene.
//
// Pure function: given the Sketch_Catalog array and the room's interior
// dimensions, walk the room's interior wall-perimeter polyline and return one
// `WallPose = { position, normal }` per record in catalogue order. Frames are
// laid out along each wall with a fixed inter-frame gap chosen so neighbouring
// frames cannot visually overlap (Requirement 2.1), and the walk wraps to the
// next wall the moment the current wall fills up (Requirement 8.6 keeps the
// catalogue index → on-wall order mapping deterministic).
//
// World-space positions are derived purely from the catalogue index — no
// extra placement metadata is read off `Sketch_Record`. Adding, editing, or
// removing entries in `lib/sketches.ts` therefore reshuffles the wall layout
// without any further source change (Requirement 8.6).

import type { SketchRecord } from "@/lib/sketch-record";

/** 3D vector as a fixed-length tuple. */
export type Vec3 = [number, number, number];

/**
 * Pose of a single Sketch_Frame on the interior of a wall.
 *
 * `position` is the world-space center of the frame's canvas, `normal` is the
 * unit vector that points from the wall surface into the room (i.e. the
 * direction the frame faces toward visitors). All Sketch_Frames returned by
 * `placeFrames` lie on one of the four interior wall planes.
 */
export type WallPose = {
  position: Vec3;
  normal: Vec3;
};

/** Interior axis-aligned dimensions of the gallery room in world units. */
export type RoomDimensions = {
  /** X extent (left ↔ right). Default Walkthrough_Scene uses 12. */
  width: number;
  /** Y extent (floor ↔ ceiling). Default Walkthrough_Scene uses 4. */
  height: number;
  /** Z extent (front ↔ back). Default Walkthrough_Scene uses 12. */
  depth: number;
};

/** Tunable knobs for the placement walk. All fields optional. */
export type PlacementConfig = {
  /** Width of each Sketch_Frame canvas in world units. */
  frameWidth?: number;
  /** Vertical center of frames above the floor; defaults to mid-wall height. */
  frameY?: number;
  /** Inter-frame gap (edge-to-edge) along a wall; must be >= 0. */
  interFrameGap?: number;
  /** Clear distance kept from each wall corner. */
  cornerMargin?: number;
  /** Outward offset from the wall plane so canvases don't z-fight the wall. */
  wallOffset?: number;
  /**
   * If true, do not place any frames on the south wall. Used by the
   * gallery scene because the south wall hosts the entrance doorway,
   * and crowding it with framed art would interfere with the foyer
   * sightline. Default `false`.
   */
  skipSouthWall?: boolean;
};

const DEFAULT_FRAME_WIDTH = 1.4;
const DEFAULT_INTER_FRAME_GAP = 0.6;
const DEFAULT_CORNER_MARGIN = 0.5;
const DEFAULT_WALL_OFFSET = 0.02;

/**
 * Internal description of one interior wall: an origin point on the wall
 * plane (the start of the walk along that wall), a unit vector along the
 * walk direction, the inward-facing wall normal, and the wall's full length
 * along the walk axis.
 */
type Wall = {
  origin: Vec3;
  along: Vec3;
  normal: Vec3;
  length: number;
};

/**
 * Place Sketch_Frames along the interior wall-perimeter polyline.
 *
 * Visited in order:
 *   1. South wall (z = +depth/2; frames face −z) — the wall the visitor
 *      faces at SPAWN [0, 1.6, 4] with yaw = π.
 *   2. West wall  (x = −width/2; frames face +x).
 *   3. North wall (z = −depth/2; frames face +z).
 *   4. East wall  (x = +width/2; frames face −x).
 *
 * Each wall is filled left-to-right (along the walk direction) with
 * frames spaced evenly between the corner margins — the first and last
 * frame centres sit `cornerMargin + frameWidth/2` from each end of the
 * wall, and any remaining inner space is divided equally between the
 * frames so neighbouring gaps are uniform along the wall. Capacity is
 * still bounded by the minimum stride `frameWidth + interFrameGap`, so
 * frames never visually overlap (Requirement 2.1). When a wall is full,
 * placement wraps to the next wall in the sequence above. If the
 * catalogue cannot fit on the four walls under the current
 * configuration, the function throws an `Error` whose message names
 * the offending count and the room dimensions.
 *
 * @returns one `WallPose` per record, in catalogue order.
 */
export function placeFrames(
  records: ReadonlyArray<SketchRecord>,
  room: RoomDimensions,
  config: PlacementConfig = {},
): WallPose[] {
  const frameWidth = config.frameWidth ?? DEFAULT_FRAME_WIDTH;
  const interFrameGap = config.interFrameGap ?? DEFAULT_INTER_FRAME_GAP;
  const cornerMargin = config.cornerMargin ?? DEFAULT_CORNER_MARGIN;
  const wallOffset = config.wallOffset ?? DEFAULT_WALL_OFFSET;
  const frameY = config.frameY ?? room.height / 2;

  if (!isFinite(room.width) || room.width <= 0) {
    throw new Error("placeFrames: room.width must be a positive finite number");
  }
  if (!isFinite(room.height) || room.height <= 0) {
    throw new Error(
      "placeFrames: room.height must be a positive finite number",
    );
  }
  if (!isFinite(room.depth) || room.depth <= 0) {
    throw new Error("placeFrames: room.depth must be a positive finite number");
  }
  if (frameWidth <= 0) {
    throw new Error("placeFrames: frameWidth must be > 0");
  }
  if (interFrameGap < 0) {
    throw new Error("placeFrames: interFrameGap must be >= 0");
  }
  if (cornerMargin < 0) {
    throw new Error("placeFrames: cornerMargin must be >= 0");
  }

  const halfW = room.width / 2;
  const halfD = room.depth / 2;

  const allWalls: ReadonlyArray<Wall & { kind: "south" | "west" | "north" | "east" }> = [
    // South wall: z = +halfD, walk along +x, frames face −z.
    {
      kind: "south",
      origin: [-halfW, frameY, halfD - wallOffset],
      along: [1, 0, 0],
      normal: [0, 0, -1],
      length: room.width,
    },
    // West wall: x = −halfW, walk along −z, frames face +x.
    {
      kind: "west",
      origin: [-halfW + wallOffset, frameY, halfD],
      along: [0, 0, -1],
      normal: [1, 0, 0],
      length: room.depth,
    },
    // North wall: z = −halfD, walk along −x, frames face +z.
    {
      kind: "north",
      origin: [halfW, frameY, -halfD + wallOffset],
      along: [-1, 0, 0],
      normal: [0, 0, 1],
      length: room.width,
    },
    // East wall: x = +halfW, walk along +z, frames face −x.
    {
      kind: "east",
      origin: [halfW - wallOffset, frameY, -halfD],
      along: [0, 0, 1],
      normal: [-1, 0, 0],
      length: room.depth,
    },
  ];

  const walls: ReadonlyArray<Wall> = config.skipSouthWall
    ? allWalls.filter((w) => w.kind !== "south")
    : allWalls;

  const poses: WallPose[] = [];
  let recordIndex = 0;

  for (const wall of walls) {
    if (recordIndex >= records.length) break;

    const usable = wall.length - 2 * cornerMargin;
    if (usable < frameWidth) continue; // wall is too short for any frame

    // Capacity = how many frames fit while keeping the last frame's outer
    // edge clear of the far-corner margin. Solving
    //   cornerMargin + N*frameWidth + (N-1)*interFrameGap <= length-cornerMargin
    // for N gives N <= (usable - frameWidth) / stride + 1.
    const minStride = frameWidth + interFrameGap;
    const capacity =
      Math.floor((usable - frameWidth) / minStride + 1e-9) + 1;
    const fitsHere = Math.min(capacity, records.length - recordIndex);

    // Distribute the `fitsHere` frames evenly along the usable wall
    // length. The frame centres are equally spaced, with the first
    // and last centres positioned cornerMargin + frameWidth/2 from
    // each end of the wall — so the gaps between neighbouring frames
    // are uniform regardless of how much wall length is left over
    // after a fixed-stride packing. When `fitsHere === 1` we centre
    // the single frame on the wall.
    const span = usable - frameWidth; // distance the centre of the last frame travels
    const stride = fitsHere > 1 ? span / (fitsHere - 1) : 0;

    for (let i = 0; i < fitsHere; i++) {
      const offset = cornerMargin + frameWidth / 2 + i * stride;
      poses.push({
        position: [
          wall.origin[0] + wall.along[0] * offset,
          wall.origin[1] + wall.along[1] * offset,
          wall.origin[2] + wall.along[2] * offset,
        ],
        normal: [wall.normal[0], wall.normal[1], wall.normal[2]],
      });
      recordIndex++;
    }
  }

  if (recordIndex < records.length) {
    throw new Error(
      `placeFrames: catalogue of ${records.length} record(s) exceeds wall ` +
        `capacity for a ${room.width}×${room.height}×${room.depth} room ` +
        `(frameWidth=${frameWidth}, interFrameGap=${interFrameGap}, ` +
        `cornerMargin=${cornerMargin})`,
    );
  }

  return poses;
}
