import { describe, it, expect } from "vitest";
import {
  placeFrames,
  type RoomDimensions,
} from "@/features/walkthrough/placement";
import type { SketchRecord } from "@/lib/sketch-record";

// Unit coverage for the Sketch_Frame placement helper (Requirements 2.1, 8.6).
// Property-based coverage of catalogue size-preservation lives in task 9.11.

const ROOM: RoomDimensions = { width: 12, height: 4, depth: 12 };

function makeRecord(i: number): SketchRecord {
  return {
    id: `r${i}`,
    title: `Sketch ${i}`,
    date: "2024-01-01",
    medium: "graphite on paper",
    description: "",
    imageSrc: `/sketches/${i}.jpg`,
  };
}

function makeCatalogue(n: number): SketchRecord[] {
  return Array.from({ length: n }, (_, i) => makeRecord(i));
}

describe("placeFrames", () => {
  it("returns one pose per record in catalogue order", () => {
    const records = makeCatalogue(6);
    const poses = placeFrames(records, ROOM);
    expect(poses).toHaveLength(records.length);
  });

  it("returns an empty array for an empty catalogue", () => {
    expect(placeFrames([], ROOM)).toEqual([]);
  });

  it("places the first frame on the south wall (visitor-facing wall)", () => {
    const poses = placeFrames(makeCatalogue(1), ROOM);
    // South wall normal points −z (away from the wall, toward visitor at SPAWN).
    expect(poses[0].normal[0]).toBeCloseTo(0, 10);
    expect(poses[0].normal[1]).toBeCloseTo(0, 10);
    expect(poses[0].normal[2]).toBeCloseTo(-1, 10);
    // South wall sits at z = +6 (room depth/2); the canvas is offset slightly
    // inward to avoid z-fighting.
    expect(poses[0].position[2]).toBeGreaterThan(5.9);
    expect(poses[0].position[2]).toBeLessThan(6);
  });

  it("frames on the same wall share that wall's normal vector", () => {
    // 6 frames easily fit on a single 12m wall with the defaults; all should
    // share the south-wall normal.
    const poses = placeFrames(makeCatalogue(5), ROOM);
    for (const p of poses) {
      expect(p.normal).toEqual([0, 0, -1]);
    }
  });

  it("non-overlap: consecutive frames on the same wall are at least frameWidth apart center-to-center", () => {
    const records = makeCatalogue(4);
    const poses = placeFrames(records, ROOM, {
      frameWidth: 1.4,
      interFrameGap: 0.6,
    });
    // All four frames land on the south wall; centers progress along +x with
    // stride = frameWidth + interFrameGap = 2.0.
    const xs = poses.map((p) => p.position[0]);
    for (let i = 1; i < xs.length; i++) {
      const dx = xs[i] - xs[i - 1];
      expect(dx).toBeGreaterThanOrEqual(1.4 - 1e-9);
      expect(dx).toBeCloseTo(2.0, 9);
    }
  });

  it("wraps to the next wall when the current wall fills up", () => {
    // Configure a tiny room so the south wall can hold exactly two frames.
    const small: RoomDimensions = { width: 5, height: 4, depth: 5 };
    const poses = placeFrames(makeCatalogue(3), small, {
      frameWidth: 1.4,
      interFrameGap: 0.6,
      cornerMargin: 0.5,
    });
    // First two on south wall, third wraps to west wall.
    expect(poses[0].normal).toEqual([0, 0, -1]);
    expect(poses[1].normal).toEqual([0, 0, -1]);
    expect(poses[2].normal).toEqual([1, 0, 0]);
  });

  it("frames on different walls have different normals when the catalogue spans multiple walls", () => {
    // 12m walls with frameWidth=1.4, gap=0.6, cornerMargin=0.5: usable=11,
    // stride=2.0, capacity = floor((11-1.4)/2.0)+1 = 5 frames per wall.
    // 7 frames therefore use the south wall (5) + west wall (2).
    const poses = placeFrames(makeCatalogue(7), ROOM);
    expect(poses[4].normal).toEqual([0, 0, -1]); // last on south wall
    expect(poses[5].normal).toEqual([1, 0, 0]); // first on west wall
  });

  it("places each frame at the configured wall height", () => {
    const poses = placeFrames(makeCatalogue(3), ROOM, { frameY: 1.7 });
    for (const p of poses) {
      expect(p.position[1]).toBeCloseTo(1.7, 10);
    }
  });

  it("throws when the catalogue exceeds total wall capacity", () => {
    // Defaults: stride=2.0, corner margins 0.5. 12m walls fit 5 frames each
    // (usable=11, capacity = floor((11-1.4)/2.0)+1 = 5); 4 walls × 5 = 20 max.
    // Asking for 21 must throw.
    expect(() => placeFrames(makeCatalogue(21), ROOM)).toThrow(/capacity/);
  });

  it("rejects non-positive room dimensions", () => {
    expect(() => placeFrames(makeCatalogue(1), { ...ROOM, width: 0 })).toThrow(
      /width/,
    );
    expect(() => placeFrames(makeCatalogue(1), { ...ROOM, height: -1 })).toThrow(
      /height/,
    );
    expect(() => placeFrames(makeCatalogue(1), { ...ROOM, depth: NaN })).toThrow(
      /depth/,
    );
  });

  it("does not mutate the input records array", () => {
    const records = makeCatalogue(4);
    const snapshot = records.map((r) => ({ ...r }));
    placeFrames(records, ROOM);
    expect(records).toEqual(snapshot);
  });
});
