"use client";

/**
 * Metadata_Panel — in-scene panel that displays a Sketch_Record's
 * `title`, `date`, `medium`, and `description` beside its Sketch_Frame
 * (Requirements 3.1, 3.2, 3.10, 11.4).
 *
 * Implementation notes:
 *
 *   - Uses `@react-three/drei`'s `<Html transform>` so the panel is a
 *     real DOM subtree mounted inside the 3D scene rather than text
 *     baked into a texture. That keeps the metadata in the
 *     accessibility tree (Requirement 10.1 et al.) and lets us style it
 *     with the same Tailwind utilities as the rest of the 2D surfaces
 *     instead of a parallel canvas-based text path.
 *
 *   - Anchors to the parent Sketch_Frame's `wallPose` and offsets the
 *     panel by `PANEL_OFFSET = 0.6` world units along the wall surface
 *     (the horizontal tangent of the wall normal). 0.6m sits well
 *     inside the 1.5m co-readability radius required by Requirement 3.2.
 *
 *   - Rotates the panel's facing direction by ±15° relative to the
 *     wall normal, alternating by even/odd `index`. Even-indexed
 *     frames take `+15°`, odd-indexed `-15°`, so neighbouring panels
 *     fan apart slightly and do not visually collide. The total
 *     deviation from the wall normal stays within ±15° as required by
 *     Requirement 3.2.
 *
 *   - Suppresses the description region entirely when
 *     `record.description.length === 0` (Requirement 3.10): the
 *     `<p data-vfg-metadata-description>` element is not rendered at
 *     all, so the panel collapses to title + date + medium with no
 *     empty whitespace gap.
 *
 *   - Typography (Requirement 11.4): the title caption uses the
 *     Space Grotesk display face (`font-display`); the date, medium,
 *     and description use the Inter body face (`font-body`). Both
 *     faces are wired in `app/layout.tsx` via `next/font/google`.
 */

import { Html } from "@react-three/drei";

import type { SketchRecord } from "@/lib/sketch-record";

/**
 * Pose of the wall slot a Sketch_Frame and its Metadata_Panel attach to.
 * `position` is the frame's anchor in world coordinates; `normal` is
 * the unit vector pointing from the wall surface into the room.
 *
 * Defined locally so this module does not depend on the placement
 * helper's import path (a separate task wires that up). The shape
 * matches the `WallPose` alias declared in design.md's data-models
 * section.
 */
export type WallPose = {
  position: [number, number, number];
  normal: [number, number, number];
};

/** Horizontal distance, in world units, from the frame anchor to the
 * panel anchor along the wall surface. Chosen well below the 1.5m
 * co-readability radius from Requirement 3.2. */
export const PANEL_OFFSET = 0.6;

/** Rotation offset applied to the panel's facing direction relative to
 * the wall normal. 15° in radians; sign alternates by even/odd index
 * so neighbouring panels do not collide visually. */
export const PANEL_ROTATION_OFFSET = Math.PI / 12;

export type MetadataPanelProps = {
  /** The Sketch_Record whose metadata this panel renders. */
  record: SketchRecord;
  /** Pose of the wall slot the parent Sketch_Frame is anchored to. */
  wallPose: WallPose;
  /**
   * Catalogue index of the parent Sketch_Frame. Used to alternate the
   * ±15° rotation offset by even/odd parity so adjacent panels fan
   * apart rather than overlapping their facing planes.
   */
  index: number;
};

/**
 * Metadata_Panel React component. See file header for behaviour notes.
 */
export function MetadataPanel({
  record,
  wallPose,
  index,
}: MetadataPanelProps) {
  const [fx, fy, fz] = wallPose.position;
  const [nx, , nz] = wallPose.normal;

  // Horizontal tangent of the wall surface — the wall normal rotated
  // 90° about world Y. A wall whose outward normal is (nx, 0, nz) has
  // an along-surface tangent of (-nz, 0, nx). The panel slides along
  // this tangent so it sits beside the frame rather than in front of
  // it.
  const tx = -nz;
  const tz = nx;

  const px = fx + tx * PANEL_OFFSET;
  const pz = fz + tz * PANEL_OFFSET;

  // Yaw aligning local +Z with the wall normal: a group with rotation
  // [0, y, 0] sends the local +Z basis vector to (sin y, 0, cos y),
  // so y = atan2(nx, nz) makes the panel's front face the room. We
  // then add ±15° based on parity to fan adjacent panels apart.
  const baseYaw = Math.atan2(nx, nz);
  const parity = index % 2 === 0 ? 1 : -1;
  const yaw = baseYaw + parity * PANEL_ROTATION_OFFSET;

  const hasDescription = record.description.length > 0;

  return (
    <group position={[px, fy, pz]} rotation={[0, yaw, 0]}>
      <Html
        transform
        // The panel is informational and does not respond to pointer
        // input; interaction is captured by the Sketch_Frame's own
        // collider. Disabling pointer events here also keeps the
        // panel from intercepting touch gestures aimed at the canvas.
        pointerEvents="none"
        wrapperClass="vfg-metadata-panel-wrapper"
        // `<Html transform>` renders DOM at world scale 1:1 — a
        // 176px-wide panel would otherwise occupy 176 world metres in
        // a 12m room. Scaling by 0.005 brings the rendered card down
        // to roughly 0.9m wide, which sits comfortably alongside a
        // 1.4m frame without dominating the wall.
        scale={0.005}
        // `transform` mode renders the HTML as a 3D plane facing the
        // group's local +Z, which we have aligned with the wall
        // normal above.
      >
        <div
          data-vfg-metadata-panel
          data-record-id={record.id}
          className="pointer-events-none w-[260px] select-none border border-white/10 bg-gallery-surface/85 px-5 py-4 text-gallery-fg shadow-lg backdrop-blur-sm"
        >
          <p
            data-vfg-metadata-title
            className="font-display text-[18px] font-medium uppercase tracking-[0.2em] text-gallery-accent leading-tight"
          >
            {record.title}
          </p>
          <dl className="mt-3 space-y-1 font-body text-[14px] text-gallery-muted">
            <div className="flex gap-2">
              <dt className="uppercase tracking-wider text-gallery-muted">
                Date
              </dt>
              <dd
                data-vfg-metadata-date
                className="text-gallery-fg"
              >
                {record.date}
              </dd>
            </div>
            {record.medium ? (
              <div className="flex gap-2">
                <dt className="uppercase tracking-wider text-gallery-muted">
                  Medium
                </dt>
                <dd
                  data-vfg-metadata-medium
                  className="text-gallery-fg"
                >
                  {record.medium}
                </dd>
              </div>
            ) : null}
          </dl>
          {hasDescription && (
            <p
              data-vfg-metadata-description
              className="mt-3 font-body text-[13px] leading-snug text-gallery-fg"
            >
              {record.description}
            </p>
          )}
        </div>
      </Html>
    </group>
  );
}

export default MetadataPanel;
