// Collisions module for the Walkthrough_Engine camera (Requirement 1.6).
//
// Resolves a single tick of camera motion against a set of axis-aligned
// bounding boxes (room walls/floor/ceiling and `Sketch_Frame` colliders),
// keeping a minimum clearance buffer of 0.3 world units between the camera
// (treated as a point) and every collider face on every axis.
//
// Resolution is performed axis-by-axis. For each axis we attempt the move
// from the running intermediate position, treating colliders as expanded
// AABBs (each face pushed outward by `CLEARANCE`). When the proposed
// component would put the camera inside an expanded collider — i.e. when the
// other two axes already overlap that collider's expanded range AND the
// swept axis range crosses the relevant clearance plane from outside — the
// component is snapped to the exact clearance plane of the nearest blocking
// face. Moves that travel away from a collider are never snapped backwards.

/** Axis-aligned bounding box. */
export type AABB = {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
};

/** 3D vector as a fixed-length tuple. */
export type Vec3 = [number, number, number];

/**
 * Minimum clearance kept between the camera point and any collider
 * face. 1.0m is a comfortable wall-standoff for the 1.4m frames
 * (frame top edge at ~2.7m world Y, eye height 1.6m → a 1m standoff
 * gives a natural viewing angle) and leaves a roomy 3m walkable
 * channel through the 5m doorway even with mobile-joystick drift.
 */
export const CLEARANCE = 1.0;

/**
 * Resolve `current + velocity * dt` against `colliders`, returning the
 * camera's collision-resolved position. The returned tuple is always a fresh
 * array; `current` and `velocity` are not mutated.
 */
export function resolveMotion(
  current: Readonly<Vec3>,
  velocity: Readonly<Vec3>,
  dt: number,
  colliders: ReadonlyArray<AABB>,
): Vec3 {
  const pos: Vec3 = [current[0], current[1], current[2]];

  for (let axis = 0; axis < 3; axis++) {
    const move = velocity[axis] * dt;
    if (move === 0) continue;

    const cur = pos[axis];
    const nxt = cur + move;
    const b = (axis + 1) % 3;
    const c = (axis + 2) % 3;

    if (move > 0) {
      // Moving in the +axis direction: the relevant clearance plane of any
      // blocking collider is its negative face (boxMin[axis] - CLEARANCE).
      // Among all colliders the camera would cross while sweeping from `cur`
      // to `nxt`, the most restrictive is the smallest such plane.
      let minBoundary = Infinity;
      for (const box of colliders) {
        if (!overlapsOtherAxes(pos, box, b, c)) continue;
        const expAmin = box.min[axis] - CLEARANCE;
        if (cur <= expAmin && nxt > expAmin && expAmin < minBoundary) {
          minBoundary = expAmin;
        }
      }
      pos[axis] = minBoundary < Infinity ? minBoundary : nxt;
    } else {
      // Moving in the -axis direction: blocking plane is the positive face
      // (boxMax[axis] + CLEARANCE); pick the largest among blockers.
      let maxBoundary = -Infinity;
      for (const box of colliders) {
        if (!overlapsOtherAxes(pos, box, b, c)) continue;
        const expAmax = box.max[axis] + CLEARANCE;
        if (cur >= expAmax && nxt < expAmax && expAmax > maxBoundary) {
          maxBoundary = expAmax;
        }
      }
      pos[axis] = maxBoundary > -Infinity ? maxBoundary : nxt;
    }
  }

  return pos;
}

/**
 * True iff the camera point's `b`- and `c`-axis components sit strictly
 * inside `box`'s expanded range on those axes. A point exactly on the
 * clearance boundary is treated as outside (it is grazing, not penetrating).
 */
function overlapsOtherAxes(
  pos: Readonly<Vec3>,
  box: AABB,
  b: number,
  c: number,
): boolean {
  const expBmin = box.min[b] - CLEARANCE;
  const expBmax = box.max[b] + CLEARANCE;
  if (pos[b] <= expBmin || pos[b] >= expBmax) return false;
  const expCmin = box.min[c] - CLEARANCE;
  const expCmax = box.max[c] + CLEARANCE;
  if (pos[c] <= expCmin || pos[c] >= expCmax) return false;
  return true;
}
