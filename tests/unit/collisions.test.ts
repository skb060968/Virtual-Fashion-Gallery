import { describe, it, expect } from "vitest";
import {
  CLEARANCE,
  resolveMotion,
  type AABB,
  type Vec3,
} from "@/features/walkthrough/Controls/Collisions";

// Unit coverage for the Collisions module (Requirement 1.6). Property-based
// coverage of the universal clearance invariant lives in task 10.2.

const ROOM_WALL_NEG_X: AABB = {
  min: [-7, -1, -7],
  max: [-6, 5, 7],
};

describe("resolveMotion", () => {
  it("returns next = current + velocity * dt when no colliders are present", () => {
    const cur: Vec3 = [0, 1.6, 0];
    const vel: Vec3 = [1, 0, -2];
    const out = resolveMotion(cur, vel, 0.5, []);
    expect(out).toEqual([0.5, 1.6, -1]);
  });

  it("does not mutate the inputs", () => {
    const cur: Vec3 = [0, 1.6, 0];
    const vel: Vec3 = [1, 0, -2];
    const curSnap = [...cur];
    const velSnap = [...vel];
    resolveMotion(cur, vel, 0.5, []);
    expect(cur).toEqual(curSnap);
    expect(vel).toEqual(velSnap);
  });

  it("snaps the camera to maintain CLEARANCE when moving into a wall along +x", () => {
    // Wall at x = -6 (the "+x face" of the negative-x wall collider).
    // Camera moves toward it from x = -8 with vx = +5 over dt = 1 → would
    // overshoot into the wall.
    const cur: Vec3 = [-8, 1.6, 0];
    const vel: Vec3 = [5, 0, 0];
    const out = resolveMotion(cur, vel, 1, [ROOM_WALL_NEG_X]);
    // Expected snap: camera point sits exactly CLEARANCE units from the
    // wall's +x face (box.max[0] = -6, so x = -6 + 0.3 = -5.7… wait,
    // we are approaching from the OUTSIDE on the -x side so the relevant
    // face is box.min[0] = -7, snap plane = -7 - 0.3 = -7.3).
    expect(out[0]).toBeCloseTo(-7 - CLEARANCE, 10);
    expect(out[1]).toBe(1.6);
    expect(out[2]).toBe(0);
  });

  it("does not snap backwards when the camera is moving away from a collider", () => {
    // Camera sits exactly on the clearance plane on the -x side of a wall
    // and moves further -x. The resolver must not pull it back toward the
    // wall.
    const cur: Vec3 = [-7 - CLEARANCE, 1.6, 0];
    const vel: Vec3 = [-1, 0, 0];
    const out = resolveMotion(cur, vel, 1, [ROOM_WALL_NEG_X]);
    expect(out[0]).toBeCloseTo(cur[0] + vel[0] * 1, 10);
  });

  it("only blocks the colliding axis (lateral motion is preserved)", () => {
    // Camera approaches the wall along +x but also strafes along +z; the
    // x component must be clamped while the z component is free to advance.
    const cur: Vec3 = [-8, 1.6, 0];
    const vel: Vec3 = [5, 0, 1];
    const out = resolveMotion(cur, vel, 1, [ROOM_WALL_NEG_X]);
    expect(out[0]).toBeCloseTo(-7 - CLEARANCE, 10);
    expect(out[2]).toBeCloseTo(1, 10);
  });

  it("ignores colliders the camera does not overlap on the other axes", () => {
    // Sketch_Frame collider hanging on a different wall; camera moves +x
    // but is at z = 100, far outside this frame's expanded range.
    const frame: AABB = {
      min: [-6, 1, -2],
      max: [-5.9, 3, 2],
    };
    const cur: Vec3 = [-8, 1.6, 100];
    const vel: Vec3 = [5, 0, 0];
    const out = resolveMotion(cur, vel, 1, [frame]);
    expect(out).toEqual([-3, 1.6, 100]);
  });

  it("picks the nearest blocking face when several would block the swept move", () => {
    const a: AABB = { min: [2, 0, -1], max: [3, 3, 1] };
    const b: AABB = { min: [5, 0, -1], max: [6, 3, 1] };
    const cur: Vec3 = [0, 1.6, 0];
    const vel: Vec3 = [10, 0, 0];
    const out = resolveMotion(cur, vel, 1, [a, b]);
    expect(out[0]).toBeCloseTo(2 - CLEARANCE, 10);
  });
});
